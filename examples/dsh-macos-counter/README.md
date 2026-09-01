# macOS-Style Counter

A standalone, dependency-free counter app styled like a macOS window: frosted-glass card, traffic-light controls, SF-style typography, and a large count display.

## Features

- Increment, decrement, and reset controls
- Keyboard shortcuts: `↑` / `ArrowUp` increments, `↓` / `ArrowDown` decrements, `R` resets
- Responsive layout, accessible labels and focus states, `prefers-reduced-motion` support
- Zero dependencies — plain HTML, CSS, and JavaScript

## Run

Serve this folder from any static server, then open the printed URL:

```bash
# Python 3
python -m http.server 8080

# Node
npx --yes serve .
```

Then open <http://localhost:8080>.

## Verify

```bash
node --check app.js   # JS syntax check
node verify.mjs       # structure + accessibility smoke checks
```

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Window markup and controls |
| `styles.css` | macOS styling, focus states, reduced motion |
| `app.js` | Counter logic and keyboard shortcuts |
| `verify.mjs` | Dependency-free automated checks (Node only) |
