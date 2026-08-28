# Beta v1 QA Handoff

Branch: `feat/improve-beta-v1`
PR: #12
Date: 2026-08-28

Use `docs/improve-beta-v1.md` as the authoritative beta acceptance plan.

CI baseline for the implementation commit (`8064f144`):

- repository invariants: passed
- strict TypeScript: passed
- unit tests: 325 passed, 2 skipped live tests
- production desktop build: passed
- Playwright desktop smoke: 12 passed

QA priority scenarios:

1. Cancel one of two active isolated task runs and verify the other continues.
2. Force a transient provider/server failure and verify rollback occurs before a distinct fallback route starts.
3. Verify auth/configuration failures stop instead of cycling providers.
4. Force a stalled execution and verify targeted cancel, rollback, and bounded recovery.
5. Configure a failing project test command and verify the task cannot complete or enter a passing review state.
6. Verify successful machine checks leave the task worktree at its checkpoint with no test-generated workspace drift.
7. Exercise parallel Autopilot with the default two-worker cap and with an explicit higher cap.
8. Verify invalid/unknown/cyclic task dependencies are rejected.
9. Verify dirty human changes in the base checkout are never reset or overwritten by task retry/integration.
10. Restart the desktop app with persisted organization runs and verify recovery does not leave permanent capacity locks.

P2 project bootstrap/design/demo workflow work remains post-beta and is not part of this handoff.
