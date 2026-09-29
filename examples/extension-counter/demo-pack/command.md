# `/counter` Command Demo

Portable command contract:

```text
/counter create --framework react --tests
```

ND translation rules:

1. Preserve the user's arguments.
2. Create or update a small accessible Counter sample.
3. Include increment, decrement, and reset.
4. Add deterministic validation when `--tests` is present.
5. Verify `reset -> +3 -> +4 -> 7`.
6. Report changed files and validation evidence.

The command is delivered through trusted engine context. ND must not claim a vendor-native slash-command package exists unless an engine adapter actually exposes one.
