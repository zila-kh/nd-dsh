# Counter Agent Capabilities Demo Pack

This directory gives every Agent Capabilities surface a concrete, account-free fixture around the same tiny Counter domain.

| Surface | Fixture | Expected result |
| --- | --- | --- |
| Memory | `memory.json` | recall `7` |
| Subagents | `subagent.md` | worker `+3`, reviewer `+4`, final `7` |
| Plugins | `plugin.json` | reset, +3, +4, get `7` |
| MCP Servers | `../mcp-server.mjs` + `../nd-extension.example.json` | real stdio tools |
| Skills | `skill/SKILL.md` | accessible Counter + deterministic validation |
| Commands | `command.md` | translate `/counter create --framework react --tests` |
| Hooks | `hooks.json` | pre-run observation + post-run finite/7 validation |

The built-in UI demos are defined in `src/shared/extensions.ts` and execute through the shared route resolver. These files are developer/manual-QA references so each product surface has a tangible sample in the repository as well as an in-app **Run demo** action.

For real MCP transport QA, enable a Counter MCP extension in ND and use the stable Harness gateway or the shell proxy documented in `../README.md`.
