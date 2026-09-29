use crate::session::{Message, ToolCall};
use anyhow::{Context, Result, bail};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader};
use std::time::Duration;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRoute {
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub api_key: String,
    pub format: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelTurn {
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

pub const MAX_TOOL_ROUNDS: usize = 24;
pub const MAX_TOOL_RESULT_CHARS: usize = 16_384;

const TOOLS: &[(&str, &str, &str)] = &[
    (
        "nd_workspace_read",
        "Read a UTF-8 file in the session workspace",
        r#"{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}"#,
    ),
    (
        "nd_workspace_list",
        "List a directory in the session workspace",
        r#"{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}"#,
    ),
    (
        "nd_browser_call",
        "Use ND's visible browser through its governed browser platform",
        r#"{"type":"object","properties":{"method":{"type":"string"},"params":{"type":"object"}},"required":["method","params"]}"#,
    ),
];

pub fn tool_names() -> Vec<&'static str> {
    TOOLS.iter().map(|tool| tool.0).collect()
}

fn tool_specs_openai() -> Vec<Value> {
    TOOLS
        .iter()
        .map(|(name, description, schema)| {
            json!({
                "type": "function", "function": { "name": name, "description": description,
                    "parameters": serde_json::from_str::<Value>(schema).unwrap_or(json!({})) }
            })
        })
        .collect()
}

fn tool_specs_responses() -> Vec<Value> {
    TOOLS
        .iter()
        .map(|(name, description, schema)| {
            json!({
                "type": "function", "name": name, "description": description,
                "parameters": serde_json::from_str::<Value>(schema).unwrap_or(json!({}))
            })
        })
        .collect()
}

fn tool_specs_anthropic() -> Vec<Value> {
    TOOLS
        .iter()
        .map(|(name, description, schema)| {
            json!({
                "name": name, "description": description,
                "input_schema": serde_json::from_str::<Value>(schema).unwrap_or(json!({}))
            })
        })
        .collect()
}

pub fn request_body(route: &ModelRoute, messages: &[Message]) -> Result<Value> {
    match route.format.as_str() {
        "openai-completions" | "deepseek" => Ok(json!({
            "model": route.model, "messages": openai_messages(messages),
            "tools": tool_specs_openai(), "stream": true,
        })),
        "openai-responses" => Ok(json!({
            "model": route.model, "input": responses_input(messages),
            "tools": tool_specs_responses(), "stream": true,
        })),
        "anthropic-messages" => {
            let system = messages
                .iter()
                .filter(|message| message.role == "system")
                .map(|message| message.content.as_str())
                .collect::<Vec<_>>()
                .join("\n\n");
            Ok(json!({ "model": route.model, "system": system,
                "messages": anthropic_messages(messages), "tools": tool_specs_anthropic(),
                "max_tokens": 8192, "stream": true }))
        }
        _ => bail!("unsupported ND agent provider format: {}", route.format),
    }
}

fn openai_messages(messages: &[Message]) -> Vec<Value> {
    messages.iter().map(|message| {
        if message.role == "tool" {
            json!({ "role": "tool", "tool_call_id": message.tool_call_id, "content": message.content })
        } else if !message.tool_calls.is_empty() {
            let calls: Vec<Value> = message.tool_calls.iter().map(|call| json!({
                "id": call.id, "type": "function", "function": { "name": call.name,
                    "arguments": call.arguments.to_string() }
            })).collect();
            json!({ "role": "assistant", "content": message.content, "tool_calls": calls })
        } else {
            json!({ "role": message.role, "content": message.content })
        }
    }).collect()
}

fn responses_input(messages: &[Message]) -> Vec<Value> {
    let mut result = Vec::new();
    for message in messages {
        if message.role == "tool" {
            result.push(
                json!({ "type": "function_call_output", "call_id": message.tool_call_id,
                "output": message.content }),
            );
        } else {
            if !message.content.is_empty() {
                result.push(json!({ "role": message.role, "content": message.content }));
            }
            for call in &message.tool_calls {
                result.push(json!({ "type": "function_call", "call_id": call.id,
                    "name": call.name, "arguments": call.arguments.to_string() }));
            }
        }
    }
    result
}

fn anthropic_messages(messages: &[Message]) -> Vec<Value> {
    let mut result = Vec::new();
    for message in messages {
        if message.role == "system" {
            continue;
        }
        if message.role == "tool" {
            result.push(json!({ "role": "user", "content": [{ "type": "tool_result",
                "tool_use_id": message.tool_call_id, "content": message.content }] }));
        } else if !message.tool_calls.is_empty() {
            let mut content = Vec::new();
            if !message.content.is_empty() {
                content.push(json!({ "type": "text", "text": message.content }));
            }
            for call in &message.tool_calls {
                content.push(json!({ "type": "tool_use", "id": call.id,
                    "name": call.name, "input": call.arguments }));
            }
            result.push(json!({ "role": "assistant", "content": content }));
        } else {
            result.push(json!({ "role": message.role, "content": message.content }));
        }
    }
    result
}

fn endpoint(route: &ModelRoute) -> Result<String> {
    let base = route.base_url.trim_end_matches('/');
    if !(base.starts_with("https://") || base.starts_with("http://")) {
        bail!("provider base URL must be HTTP or HTTPS");
    }
    let suffix = match route.format.as_str() {
        "openai-completions" | "deepseek" => "/chat/completions",
        "openai-responses" => "/responses",
        "anthropic-messages" => "/v1/messages",
        _ => bail!("unsupported provider format"),
    };
    if base.ends_with(suffix) {
        return Ok(base.to_owned());
    }
    if route.format == "anthropic-messages" {
        return Ok(if base.ends_with("/v1") {
            format!("{base}/messages")
        } else {
            format!("{base}{suffix}")
        });
    }
    let prefix = if base.ends_with("/v1") { "" } else { "/v1" };
    Ok(format!("{base}{prefix}{suffix}"))
}

/// A model request is retried only before any streamed output has been emitted.
/// Tool effects are never retried by this layer.
pub fn complete(
    route: &ModelRoute,
    messages: &[Message],
    mut on_text: impl FnMut(&str),
) -> Result<ModelTurn> {
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(180))
        .build()?;
    let url = endpoint(route)?;
    let body = request_body(route, messages)?;
    let mut last_error = None;
    for attempt in 0..3 {
        let mut request = client.post(&url).json(&body);
        if !route.api_key.is_empty() {
            if route.format == "anthropic-messages" {
                request = request
                    .header("x-api-key", &route.api_key)
                    .header("anthropic-version", "2023-06-01");
            } else {
                request = request.bearer_auth(&route.api_key);
            }
        }
        for (name, value) in &route.headers {
            request = request.header(name.as_str(), value.as_str());
        }
        match request.send() {
            Ok(response) if response.status().is_success() => {
                let mut parser = StreamParser::new(&route.format);
                let mut reader = BufReader::new(response);
                let mut line = String::new();
                loop {
                    line.clear();
                    if reader.read_line(&mut line)? == 0 {
                        break;
                    }
                    if let Some(data) = line.trim_end().strip_prefix("data: ") {
                        if data == "[DONE]" {
                            break;
                        }
                        let value: Value =
                            serde_json::from_str(data).context("invalid model SSE data")?;
                        if value.get("error").is_some() || value["type"] == "error" {
                            bail!("model provider reported a streaming error");
                        }
                        if let Some(delta) = parser.push(&value)? {
                            on_text(&delta);
                        }
                    }
                }
                return parser.finish();
            }
            Ok(response) => {
                let status = response.status();
                let retryable = status.as_u16() == 429 || status.is_server_error();
                last_error = Some(format!("model provider returned HTTP {}", status.as_u16()));
                if !retryable {
                    break;
                }
            }
            Err(_error) => {
                // reqwest errors can include the full provider URL, including
                // credentials that a user placed in its query string.
                last_error = Some("model transport request failed".to_owned());
            }
        }
        if attempt < 2 {
            std::thread::sleep(Duration::from_millis(250 * (1 << attempt)));
        }
    }
    bail!(
        "{}",
        last_error.unwrap_or_else(|| "model request failed".to_owned())
    )
}

#[derive(Default)]
struct PartialCall {
    id: String,
    name: String,
    arguments: String,
}

pub struct StreamParser {
    format: String,
    text: String,
    calls: BTreeMap<usize, PartialCall>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

impl StreamParser {
    pub fn new(format: &str) -> Self {
        Self {
            format: format.to_owned(),
            text: String::new(),
            calls: BTreeMap::new(),
            input_tokens: None,
            output_tokens: None,
        }
    }

    pub fn push(&mut self, value: &Value) -> Result<Option<String>> {
        let delta = match self.format.as_str() {
            "openai-completions" | "deepseek" => self.push_openai(value),
            "openai-responses" => self.push_responses(value),
            "anthropic-messages" => self.push_anthropic(value),
            _ => bail!("unsupported provider format"),
        };
        if let Some(ref text) = delta {
            self.text.push_str(text);
        }
        Ok(delta)
    }

    fn push_openai(&mut self, value: &Value) -> Option<String> {
        self.input_tokens = value
            .pointer("/usage/prompt_tokens")
            .as_u64_or(self.input_tokens);
        self.output_tokens = value
            .pointer("/usage/completion_tokens")
            .as_u64_or(self.output_tokens);
        let delta = value.pointer("/choices/0/delta")?;
        if let Some(calls) = delta["tool_calls"].as_array() {
            for call in calls {
                let index = call["index"].as_u64().unwrap_or(0) as usize;
                let partial = self.calls.entry(index).or_default();
                if let Some(id) = call["id"].as_str() {
                    partial.id.push_str(id);
                }
                if let Some(name) = call.pointer("/function/name").and_then(Value::as_str) {
                    partial.name.push_str(name);
                }
                if let Some(args) = call.pointer("/function/arguments").and_then(Value::as_str) {
                    partial.arguments.push_str(args);
                }
            }
        }
        delta["content"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
    }

    fn push_responses(&mut self, value: &Value) -> Option<String> {
        match value["type"].as_str().unwrap_or("") {
            "response.output_item.added" => {
                let item = &value["item"];
                if item["type"] == "function_call" {
                    let index = value["output_index"].as_u64().unwrap_or(0) as usize;
                    let partial = self.calls.entry(index).or_default();
                    partial.id = item["call_id"].as_str().unwrap_or("").to_owned();
                    partial.name = item["name"].as_str().unwrap_or("").to_owned();
                }
                None
            }
            "response.function_call_arguments.delta" => {
                let index = value["output_index"].as_u64().unwrap_or(0) as usize;
                self.calls
                    .entry(index)
                    .or_default()
                    .arguments
                    .push_str(value["delta"].as_str().unwrap_or(""));
                None
            }
            "response.output_item.done" => {
                let item = &value["item"];
                if item["type"] == "function_call" {
                    let index = value["output_index"].as_u64().unwrap_or(0) as usize;
                    let partial = self.calls.entry(index).or_default();
                    if partial.id.is_empty() {
                        partial.id = item["call_id"].as_str().unwrap_or("").to_owned();
                    }
                    if partial.name.is_empty() {
                        partial.name = item["name"].as_str().unwrap_or("").to_owned();
                    }
                    if partial.arguments.is_empty() {
                        partial.arguments = item["arguments"].as_str().unwrap_or("").to_owned();
                    }
                }
                None
            }
            "response.output_text.delta" => value["delta"].as_str().map(str::to_owned),
            "response.completed" => {
                self.input_tokens = value
                    .pointer("/response/usage/input_tokens")
                    .as_u64_or(self.input_tokens);
                self.output_tokens = value
                    .pointer("/response/usage/output_tokens")
                    .as_u64_or(self.output_tokens);
                None
            }
            _ => None,
        }
    }

    fn push_anthropic(&mut self, value: &Value) -> Option<String> {
        let index = value["index"].as_u64().unwrap_or(0) as usize;
        match value["type"].as_str().unwrap_or("") {
            "message_start" => {
                self.input_tokens = value
                    .pointer("/message/usage/input_tokens")
                    .as_u64_or(self.input_tokens);
                None
            }
            "content_block_start" => {
                let block = &value["content_block"];
                if block["type"] == "tool_use" {
                    let partial = self.calls.entry(index).or_default();
                    partial.id = block["id"].as_str().unwrap_or("").to_owned();
                    partial.name = block["name"].as_str().unwrap_or("").to_owned();
                }
                None
            }
            "content_block_delta" => {
                let delta = &value["delta"];
                if delta["type"] == "input_json_delta" {
                    self.calls
                        .entry(index)
                        .or_default()
                        .arguments
                        .push_str(delta["partial_json"].as_str().unwrap_or(""));
                    None
                } else if delta["type"] == "text_delta" {
                    delta["text"].as_str().map(str::to_owned)
                } else {
                    None
                }
            }
            "message_delta" => {
                self.output_tokens = value
                    .pointer("/usage/output_tokens")
                    .as_u64_or(self.output_tokens);
                None
            }
            _ => None,
        }
    }

    pub fn finish(self) -> Result<ModelTurn> {
        let mut calls = Vec::new();
        for partial in self.calls.into_values() {
            if partial.name.is_empty() || partial.id.is_empty() {
                bail!("model returned an incomplete tool call");
            }
            let arguments = serde_json::from_str(&partial.arguments)
                .context("model returned malformed tool arguments")?;
            calls.push(ToolCall {
                id: partial.id,
                name: partial.name,
                arguments,
            });
        }
        if self.text.is_empty() && calls.is_empty() {
            bail!("model provider returned no assistant output");
        }
        Ok(ModelTurn {
            text: self.text,
            tool_calls: calls,
            input_tokens: self.input_tokens,
            output_tokens: self.output_tokens,
        })
    }
}

trait JsonNumber {
    fn as_u64_or(&self, fallback: Option<u64>) -> Option<u64>;
}

impl JsonNumber for Option<&Value> {
    fn as_u64_or(&self, fallback: Option<u64>) -> Option<u64> {
        self.and_then(Value::as_u64).or(fallback)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn parses_openai_streamed_tool_arguments() {
        let mut parser = StreamParser::new("openai-completions");
        parser.push(&json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"nd_workspace_read","arguments":"{\"path\":"}}]}}]})).unwrap();
        parser.push(&json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"a.txt\"}"}}]}}]})).unwrap();
        let turn = parser.finish().unwrap();
        assert_eq!(turn.tool_calls[0].arguments["path"], "a.txt");
    }

    #[test]
    fn rejects_malformed_model_tool_arguments() {
        let mut parser = StreamParser::new("anthropic-messages");
        parser.push(&json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"one","name":"nd_shell"}})).unwrap();
        parser.push(&json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{"}})).unwrap();
        assert!(parser.finish().is_err());
    }

    #[test]
    fn parses_responses_tool_calls_and_usage() {
        let mut parser = StreamParser::new("openai-responses");
        parser.push(&json!({"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"call-1","name":"nd_workspace_list"}})).unwrap();
        parser.push(&json!({"type":"response.function_call_arguments.delta","output_index":0,"delta":"{\"path\":\".\"}"})).unwrap();
        parser.push(&json!({"type":"response.completed","response":{"usage":{"input_tokens":12,"output_tokens":4}}})).unwrap();
        let turn = parser.finish().unwrap();
        assert_eq!(turn.tool_calls[0].arguments["path"], ".");
        assert_eq!(turn.input_tokens, Some(12));
        assert_eq!(turn.output_tokens, Some(4));
    }

    #[test]
    fn parses_anthropic_text_and_tool_use() {
        let mut parser = StreamParser::new("anthropic-messages");
        parser.push(&json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}})).unwrap();
        assert_eq!(parser.push(&json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"checking"}})).unwrap(), Some("checking".to_owned()));
        parser.push(&json!({"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool-1","name":"nd_workspace_read"}})).unwrap();
        parser.push(&json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"a.txt\"}"}})).unwrap();
        let turn = parser.finish().unwrap();
        assert_eq!(turn.text, "checking");
        assert_eq!(turn.tool_calls[0].arguments["path"], "a.txt");
    }

    #[test]
    fn uses_one_v1_segment_for_anthropic_routes() {
        let route = ModelRoute {
            provider: "test".to_owned(),
            model: "test-model".to_owned(),
            base_url: "https://example.invalid/v1".to_owned(),
            api_key: String::new(),
            format: "anthropic-messages".to_owned(),
            headers: BTreeMap::new(),
        };
        assert_eq!(
            endpoint(&route).unwrap(),
            "https://example.invalid/v1/messages"
        );
    }

    #[test]
    fn streams_a_deterministic_openai_compatible_provider() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut buffer = [0_u8; 8192];
            let count = socket.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..count]).into_owned();
            let body = concat!(
                "data: {\"choices\":[{\"delta\":{\"content\":\"hello \"}}]}\n\n",
                "data: {\"choices\":[{\"delta\":{\"content\":\"world\"}}]}\n\n",
                "data: [DONE]\n\n"
            );
            write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
            request
        });
        let route = ModelRoute {
            provider: "test".to_owned(),
            model: "test-model".to_owned(),
            base_url: format!("http://{address}"),
            api_key: "sk-test-placeholder".to_owned(),
            format: "openai-completions".to_owned(),
            headers: BTreeMap::new(),
        };
        let mut chunks = Vec::new();
        let turn = complete(&route, &[Message::text("user", "say hello")], |chunk| {
            chunks.push(chunk.to_owned())
        })
        .unwrap();
        let request = server.join().unwrap();
        assert!(request.contains("POST /v1/chat/completions"));
        assert!(
            request
                .to_ascii_lowercase()
                .contains("authorization: bearer sk-test-placeholder")
        );
        assert_eq!(turn.text, "hello world");
        assert_eq!(chunks, ["hello ", "world"]);
    }
}
