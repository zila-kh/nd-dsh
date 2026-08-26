# ND Gateway — External Apps

Status: implemented foundation on `feat/nd-gateway-external-apps`.

## Product rule

Normal users configure this only inside ND Desktop. ND must never require Terminal commands, environment variables, manual port selection, certificate installation, machine proxy changes, or hand-edited config files.

A real model-provider API key is required before an external app can use ND model routing. The provider key remains in ND's trusted main process and OS-backed secure storage. External apps receive only an ND-generated local credential.

## Modes

- **LLM Only** — route the request without changing prompt/input content.
- **ND Enhanced** — route through ND and apply safe ND middleware such as Token Saver.
- **Full ND** — reserved for supported app connectors that can enter the complete ND capability/orchestration surface. The mode is part of the contract now; ChatGPT model interception is not falsely advertised as supporting it.

## Security boundary

- gateway binds to `127.0.0.1` only;
- operating system chooses an ephemeral port;
- each app binding receives a cryptographically random `nd_local_*` bearer credential;
- provider API keys never leave trusted Electron main;
- provider keys are never returned by renderer IPC;
- no root CA, TLS interception, DNS override, global proxy, or credential scraping;
- request body is bounded before parsing;
- unsupported endpoints fail closed;
- current provider state is reloaded from ND secure storage before routing;
- response streaming is preserved.

## ChatGPT Desktop boundary

ChatGPT Desktop is the first visible target because it is easy for nontechnical users to recognize. ND detects it and shows the three desired modes/provider requirement, but the Connect action stays disabled while the official ChatGPT client does not expose a supported custom LLM base URL.

ND deliberately does **not** force ChatGPT traffic through a machine-level MITM proxy. When OpenAI exposes a supported model endpoint or app-configuration seam, the existing `prepareLocalBinding()` contract can supply the app with an ND-local endpoint and credential without changing the provider-key security model.

ChatGPT MCP/Apps SDK integration is a different integration class: it can expose ND tools/ecosystem to ChatGPT, but it does not replace ChatGPT's private model transport and therefore cannot provide LLM-level Token Saver for ChatGPT's own model calls.

## Current implementation

- `src/shared/gateway.ts` — product contracts and IPC names.
- `src/main/gateway/gateway-service.ts` — secure loopback OpenAI-compatible gateway core.
- `src/main/gateway/ipc.ts` — trusted renderer control boundary.
- `src/preload/terminal.ts` — exposes the narrow gateway API beside Token Saver.
- `src/renderer/src/components/GatewaySettings.tsx` — zero-terminal UI.
- `tests/gateway.test.ts` — API-key, loopback, local-auth, and honest-capability tests.

## Acceptance criteria

- user never needs Terminal or OS networking configuration;
- provider API key is mandatory before gateway startup;
- external app never receives the real provider key;
- LLM Only does not run Token Saver;
- ND Enhanced runs safe Token Saver prompt optimization;
- local gateway is inaccessible without its generated per-app credential;
- ChatGPT is not marked supported until an official safe connection method exists;
- disabling/disconnecting stops the local gateway;
- unsupported setup fails without changing machine networking.
