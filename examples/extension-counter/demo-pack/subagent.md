# Counter Subagent Demo

Goal: verify delegation policy without requiring a large project.

Worker assignment:

- Start from counter value `0`.
- Propose adding `3`.
- Return the proposed value and evidence.

Reviewer assignment:

- Independently inspect the worker result.
- Add the remaining `4` only after the worker result is accepted.
- Final expected value: `7`.

On ND Harness the extension may use native Harness subagent delegation. On engines without an ND-native subagent API, this same worker/reviewer contract is delivered as trusted extension policy rather than pretending a native subagent tool exists.
