# ND performance benchmarks

These benchmarks are release evidence for PRD 0002. They use deterministic local fixtures and the real nd-core binary/protocol; they do not call model providers.

- \`pnpm bench:smoke\` — short CI correctness/performance harness smoke.
- \`pnpm bench:record\` — full release-profile core benchmark bundle under \`benchmark-results/\`.
- \`pnpm bench:compare <baseline> <candidate>\` — same-machine comparison.
- \`pnpm bench:check <summary.json>\` — hard budget checker.
- \`pnpm bench:app\` — packaged Electron startup; requires \`ND_DSH_BENCH_PACKAGED_APP\`.

Full release comparisons use the same machine, fixture version, build profile, and run counts. Raw samples remain in JSON; performance percentage claims without matching JSON are not accepted.
