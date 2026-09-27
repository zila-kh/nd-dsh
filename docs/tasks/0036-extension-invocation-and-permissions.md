# TODO 0036 — Extension invocation broker and scoped permissions

> Priority: P1
> Owner: ND extensions
> Status: implemented locally 2026-09-27 (broker, grants, run credentials, audit); the external MCP-child bridge is deferred — see the QA gate's recorded limitations
> Depends on: 0035
> PRD: [0006 — ND Extensions and Personal Home](../prd/0006-nd-extensions-and-personal-home.md)

## Objective

Give user commands and agent tools one trusted execution boundary with context-bound grants and revocation.

## Scope

- Implement one invocation service for launcher/views and the existing MCP/shell gateways, validating contribution, context, actor, engine/provider, and current activation.
- Issue opaque run credentials bound to trusted session identity; expire at completion and reject caller-supplied authority.
- Persist extension/action/context/resource grants. Apply ND policy and engine restrictions as ceilings, with deny taking precedence.
- Recognize explicit user gestures as authorization for their exact action/target; require per-action approval for agent-initiated screen/clipboard reads.
- Expose narrow native host methods; migrate daily clipboard reads behind the broker. Extensions cannot invoke arbitrary IPC methods.
- Require separate trust for external executables; supervise deadlines, output caps, cancellation, environment references, and late-result rejection after revocation.
- Record content-free decision/outcome diagnostics and redact tokens/secrets. Personal engine file/process operations must be disabled when policy cannot be enforced.

## Acceptance

- UI and agent calls to one contribution receive equivalent checks; missing/stale credentials and cross-context calls fail closed.
- Global installation or personal grants cannot authorize company/project data.
- Disable/revoke blocks new calls immediately and cancels supervised calls where possible without claiming reversal of completed effects.
- Explicit capture/clipboard commands authorize one action; agent reads ask each time.
- External MCP processes are not represented as OS-sandboxed, and executable trust does not imply native API grants.
- Tests cover denied policy, unsupported engine restrictions, timeouts, cancellation, environment isolation, and redacted logging.

## Validation

Run broker/IPC, extension gateway/proxy, and engine routing tests plus pnpm typecheck.

Use environment references or explicit dummy tokens in fixtures. Record actual evidence when implemented; this planning document does not establish validation.

## Starting points

- `src/main/extensions/extension-router.ts`
- `scripts/nd-extension-runtime.mjs`
- `src/main/engines/engine-session-router.ts`

Reinspect current code and applicable contributor guidance before implementation. Preserve unrelated work and keep ND's provider/engine, organization, browser, and ND Pencil boundaries intact.
