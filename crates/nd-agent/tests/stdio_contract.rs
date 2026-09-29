use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

#[test]
fn headless_binary_serves_versioned_session_rpc() {
    let dir = tempfile::tempdir().unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_nd-agent"))
        .args([
            "serve",
            "--stdio",
            "--data-dir",
            dir.path().to_str().unwrap(),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    writeln!(
        stdin,
        "{}",
        json!({ "jsonrpc": "2.0", "id": "init", "method": "initialize",
        "params": { "protocolVersion": 1, "models": [{ "id": "deepseek/test" }] } })
    )
    .unwrap();
    let mut line = String::new();
    output.read_line(&mut line).unwrap();
    let initialized: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(initialized["id"], "init");
    assert_eq!(initialized["result"]["protocolVersion"], 1);

    writeln!(
        stdin,
        "{}",
        json!({ "jsonrpc": "2.0", "id": "create", "method": "session.create",
        "params": { "cwd": dir.path().to_str().unwrap() } })
    )
    .unwrap();
    let created = loop {
        line.clear();
        assert!(output.read_line(&mut line).unwrap() > 0);
        let frame: Value = serde_json::from_str(&line).unwrap();
        if frame["id"] == "create" {
            break frame;
        }
    };
    assert!(
        created["result"]["sessionId"]
            .as_str()
            .unwrap()
            .starts_with("nd-native-")
    );
    drop(stdin);
    assert!(child.wait().unwrap().success());
}
