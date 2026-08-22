# ND-DSH Provider Architecture

ND-DSH is an AI company/coding product. A model vendor is a replaceable execution dependency, not a product identity.

## Finding

The pinned Harness runtime is already provider-routed. Its core LLM service selects an adapter by `provider` and a model within that route by `model`. The base runtime also mounts the generic `llm-pi-ai` adapter dormant; provider profiles can activate it without changing the agent loop or session format.

ND-DSH therefore should not fork or replace the agent runtime just to support more model vendors. The correct seam is:

```text
ND company / agent configuration
        ↓
ND ProviderStore (metadata + secure credentials)
        ↓
ProviderRuntime compiler
        ↓
Harness provider + model routes
        ↓
LlmRuntime
   ├── native compatibility adapters
   └── generic pi-ai provider adapter
        ↓
provider API / gateway / ambient auth
```

## Current compatibility posture

For the coding beta, the existing `deepseek-official` adapter remains the compatibility driver for the seeded DeepSeek provider. This avoids changing the proven beta model path while additional providers are introduced.

Every other enabled ND provider is compiled into a route owned by the generic pi-ai adapter. New sessions use the first enabled provider with a configured model as their default. Existing durable sessions retain their logged provider/model selection.

Provider changes are staged while the app is running. The next prompt/session restarts only the hidden Harness process, not ND-DSH, and durable sessions survive the restart.

## Supported generic route shapes

The pinned generic adapter can explicitly describe these protocols:

- `openai-completions`
- `openai-responses`
- `anthropic-messages`

A provider route can also use provider-native/catalog mode. In that mode the installed pi-ai catalog owns the endpoint, protocol, compatibility behavior, model metadata, and provider-native authentication. This is the path for providers that need OAuth, AWS/Google ambient credentials, or other auth that cannot be represented as a simple API key.

A hand-declared route can point at a custom/private gateway. For a custom route, ND supplies the route id, endpoint, protocol, credential reference, and configured model ids. This covers OpenAI-compatible gateways and other deployments without adding vendor-specific code to ND.

## Credential rule

Provider metadata and API keys have separate lifecycles:

```text
providers.json              provider-secrets.json
-------------               ---------------------
id                          OS-encrypted key bytes
name
endpoint
protocol
models
```

At runtime ND creates a stable temporary environment-variable name for each provider key and gives the generic Harness profile only that reference. The key value is inherited by the child process environment and never serialized into the Cordis patch or provider JSON.

If OS-backed encryption is unavailable, keys remain memory-only instead of being persisted insecurely.

## Provider identity

Provider ids are route keys, not brand labels. A session target is always:

```text
provider route + model id + optional reasoning effort
```

The same model id may exist behind multiple provider routes. This matters for gateways, enterprise proxies, local inference servers, and multi-region deployments.

Examples:

```text
openai-prod / gpt-next
openai-proxy / gpt-next
anthropic / claude-sonnet
openrouter / vendor/model
local-lab / company-code-model
```

No code should infer vendor behavior from a model name.

## Next extensions

The provider compiler is intentionally a boundary. Future work should extend that boundary instead of adding provider conditionals across the app:

1. Provider templates for common vendors and local gateways.
2. Harness model discovery from a provider endpoint.
3. Per-agent provider/model/reasoning configuration in the organization schema.
4. Company defaults with agent overrides and task-specific routing.
5. Cost, token, latency, context-window, and capability metadata for routing decisions.
6. Credential modes beyond API key: ambient, OAuth/account connection, cloud identity, and managed enterprise credentials.
7. Fallback/routing policy such as primary model → cheaper retry model → backup provider.
8. Provider health checks and rate-limit/circuit-breaker state.

## Non-negotiable rules

- ND-DSH must remain usable if the seeded DeepSeek provider is disabled.
- Product code depends on ND provider abstractions, not vendor SDKs.
- Provider/model are separate fields everywhere.
- Secrets never enter prompts, logs, organization memory, provider metadata, or patch JSON.
- A provider must be removable without rewriting company/project/task data.
- Agent skills and tools are independent from model vendor.
- The runtime may add direct vendor adapters for quality, but they live behind the same provider route contract.
