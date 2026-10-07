# ND YouTube Mini

**Status: M1 scaffold.** An ND extension package (`nd.extension/1`, id
`nd.youtube-mini`) for playing and managing YouTube in the ND browser with
background playback and ad blocking on by default. It follows the ND Translate
pattern: the package contributes validated manifest data — launcher commands and
a schema-driven view — and ND renders and executes everything through its
invocation broker. The package ships no renderer code.

## What this milestone declares

| Contribution | Kind | Host | Permission | What it does |
| --- | --- | --- | --- | --- |
| `youtube-mini-open` | command | `browser.openUrl` | `browser.navigate` | Launcher command **ND YouTube Mini**; opens the queue view (`openViewId`) without navigating |
| `youtube-mini-save` | command | `note.create` | `notes.write` | Saves the typed video link as a queue entry |
| `youtube-mini-queue` | view (list) | `note.search` | `notes.read` | Lists saved entries; action **Open entry** (`note.open`) shows one |

Contexts: personal, company, and project. The package declares no
`executable` (nothing to trust at activation) and no `settings` — the platform
guide requires a setting only when a host method consumes it, so an ad-block
toggle would be an inert field until the M3 ad-blocking work lands.

## What is deliberately not here yet

- **M2 — player state contract, now-playing view, transport controls.** The ND
  host-method allowlist has no player methods yet; this package only references
  allowlisted hosts (`browser.openUrl`, `note.create`, `note.search`,
  `note.open`).
- **M3 — ad blocking on by default.** Platform-level behavior consumed through
  the ND browser; documented here rather than faked with an unused setting.
- **M4 — queue/session persistence, accessibility, i18n.** The M1 queue view
  loads through `note.search`, so it shows saved note entries (the same pattern
  the ND hello-notes sample uses); filtering to YouTube entries arrives with M4.

Behavior notes for reviewers: both launchers short-circuit commands that carry
`openViewId`, so running **ND YouTube Mini** opens the view and never invokes
the host; an agent invoking that command directly runs `browser.openUrl`, which
opens the ND browser default page when no URL is supplied.

## Layout

```
nd-youtube-player-mini/
├── nd-extension.json        # nd.extension/1 manifest (id nd.youtube-mini)
├── package.json             # verification chain: verify → typecheck, test, build
├── README.md
├── scripts/
│   ├── nd-contract.mjs      # shared manifest contract + credential-shape patterns
│   ├── typecheck.mjs        # JSON/contract checks + verification-wiring checks
│   └── build.mjs            # install-readiness checks (no artifacts: ND installs folders prebuilt)
└── test/
    └── smoke.test.mjs       # independent node:test assertions (the executable spec)
```

## Verification

Zero dependencies, Node 21+, no install step:

```bash
npm run verify     # or: pnpm verify
```

`verify` chains three scripts, each also runnable alone:

- `typecheck` — parses every JSON file, validates the manifest against the
  `nd.extension/1` contract this package relies on, and proves `package.json`
  wiring stays complete (all four scripts exist, `verify` chains them, every
  `scripts/*.mjs` file is reachable from a script).
- `test` — `node --test "test/*.test.mjs"`: the smoke test asserts protocol and
  id, declared command/view contributions, unique contribution ids, host
  allowlisting with permission coverage, context narrowing, the verification
  wiring itself, and that no shipped file contains a credential-shaped value.
- `build` — install readiness: required files present, no symlinks (the ND
  installer rejects them), no credential files, no secret-shaped values.

The authoritative check is the ND-DSH runtime validator; run it from the
repository root:

```bash
node scripts/validate-nd-extension.mjs extensions/nd-youtube-player-mini
```

## Security

No credentials, API keys, passwords, or environment files are present in this
package, and verification fails if any shipped file starts to contain one.
