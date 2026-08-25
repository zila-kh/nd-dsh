# Agent Capabilities Manual QA

Branch: `feat/universal-extension-router`

Use this after launching the desktop build. The goal is to verify the product behavior users see, not only the internal resolver.

## 1. Surface smoke test

Open **Settings → Agent capabilities**.

Expected left navigation:

- Memory
- Subagents
- Plugins
- MCP Servers
- Skills
- Commands
- Hooks

For every surface:

1. Select the built-in Counter demo.
2. Confirm it starts **Off** for real runs.
3. Choose an available coding engine in **Run demo**.
4. Click **Run demo**.
5. Confirm a route adapter and deterministic Counter result are shown.

The demo action must not silently enable the extension for normal agent runs.

## 2. Counter MCP on ND Harness

1. Open **MCP Servers → Counter MCP Demo**.
2. Enable it for real runs.
3. Leave the ND Harness route on `auto`.
4. Start a normal Harness chat and ask:
   `Reset the Counter MCP demo, add 3, add 4, then read the final value.`
5. Inspect the agent trace.

Expected:

- ND extension context identifies the MCP route.
- The agent uses `mcp__nd-extensions__nd_extension_list` and `mcp__nd-extensions__nd_extension_call`.
- Final tool value is `7`.
- No second browser or unrelated MCP runtime is started.

Then set the ND Harness route to **disabled** and repeat. The extension must not be callable through the Harness gateway.

## 3. Counter MCP on direct Codex CLI

Prerequisite: direct Codex CLI engine is available/authenticated.

1. Enable **Counter MCP Demo**.
2. Leave the `codex-cli` route on `auto`.
3. Run a task using direct Codex CLI asking for the same reset/+3/+4/get sequence.

Expected:

- Route resolves to `nd-proxy`.
- Trusted context includes the `$ND_EXTENSION_NODE` / `$ND_EXTENSION_PROXY` commands with `codex-cli` as the target engine id.
- Final value is `7`.

Set only the `codex-cli` route to **disabled**. The Harness route should remain usable while direct Codex is blocked.

## 4. Provider scope is independent

For any portable extension:

1. Leave all engine routes on `auto`.
2. In Model provider scope, deny one enabled provider while leaving another allowed.
3. Run the same Harness task once with each provider.

Expected:

- Allowed provider receives extension context.
- Denied provider does not receive that extension binding.
- Changing provider scope does not mutate coding-engine routing.

Use **Allow all** to restore the default provider-neutral behavior.

## 5. Custom instruction-only Plugin

1. Open **Plugins** and click **Add Plugin**.
2. Name it `Manual QA Plugin`.
3. Add portable instructions, for example: `When asked for the QA marker, answer ND-PLUGIN-QA.`
4. Leave MCP command empty.
5. Enable it.
6. Run a normal agent task asking for the QA marker.

Expected:

- Plugin auto route is portable prompt/context, not a fake native plugin.
- Agent receives the trusted plugin instructions.
- No MCP command is spawned.

Navigate away from Settings, return, and confirm the custom plugin remains configured.

## 6. Custom executable MCP Server

The repo includes `examples/extension-counter/mcp-server.mjs`.

1. Open **MCP Servers** and click **Add MCP Server**.
2. Configure:
   - name: `Manual Counter MCP`
   - command: the Node executable available to the desktop process
   - arguments: absolute path to `examples/extension-counter/mcp-server.mjs`
3. Leave environment references empty.
4. Save and enable it.
5. Run a normal Harness task and use the extension list/call gateway.
6. Repeat using direct Codex if available.

Expected:

- Harness route uses the stable MCP gateway.
- Direct Codex route uses the portable shell proxy.
- The raw MCP tools are `counter_get`, `counter_add`, and `counter_reset`.
- No model/provider credential is written into the extension definition.

Only configure executable MCP commands you trust.

## 7. Environment reference safety

Create a custom MCP extension that requires a test variable.

Example Settings entry:

```text
Environment references:
CHILD_TOKEN=MANUAL_QA_TOKEN
```

Set `MANUAL_QA_TOKEN` in the parent desktop environment before launch.

Expected:

- Extension catalog stores only `CHILD_TOKEN=MANUAL_QA_TOKEN` semantics.
- Secret value itself is absent from `agent-extensions.json`.
- The MCP child receives `CHILD_TOKEN` when invoked.
- An unrelated parent secret not listed in the extension env references is not inherited by the MCP child.

## 8. Impossible mapping fails closed

For **Counter MCP Demo** on direct Codex, manually select `mcp` instead of `auto`.

Expected:

- UI marks the route unsupported/off because direct Codex does not expose the Harness MCP surface.
- ND does not claim the extension is natively available.

For a Hook, select reserved `cordis` explicitly.

Expected: unsupported until a real generic Cordis projector exists.

## 9. Portable Skill / Command / Hook behavior

Run these individually:

- **Counter Skill Demo**: ask for an accessible counter app with increment/decrement/reset and deterministic tests.
- **Counter Command Demo**: send `/counter create --framework react --tests`.
- **Counter Hook Demo**: ask for the counter operation and pre/post lifecycle validation.

Expected:

- Skill is delivered through `skill-bridge` trusted context.
- Command is delivered through portable command translation/trusted context.
- Hook is delivered through portable `hook-bridge` lifecycle policy.
- ND does not claim a dynamic native Harness skill/command/hook package was mounted when it was not.

## 10. Subagent behavior

Enable **Counter Subagent Demo**.

- On ND Harness, confirm routing reports native delegation policy and the Harness subagent tools remain available.
- On a non-Harness engine, confirm ND preserves worker/reviewer delegation instructions in trusted context rather than inventing a nonexistent native subagent API.

## 11. Reset behavior

1. Create at least one custom extension.
2. Modify routes on two built-in Counter demos.
3. Click **Reset demo pack**.

Expected:

- All built-in demos return to default Off + automatic route state.
- Custom extensions remain.
- Custom extension configuration is not replaced by demo reset.

## 12. Restart persistence

1. Enable a built-in demo.
2. Add a custom extension.
3. Change an engine route and provider scope.
4. Quit ND completely and relaunch.

Expected: all saved choices survive the restart from trusted main-process persistence.

## Pass criteria

A beta pass requires:

- no renderer crash;
- all seven surfaces visible;
- all seven Counter demos executable from the UI;
- real Harness MCP gateway route works for enabled MCP/plugin tools;
- direct Codex portable proxy route works when Codex is available;
- per-engine disable cannot be bypassed by the other engine;
- provider scope remains independent;
- custom extension persistence works;
- secrets are referenced, not persisted;
- impossible mappings fail closed;
- reset preserves custom extensions.
