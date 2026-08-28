# speed-round-v3

Minimal plain Node.js CLI script that prints a random tip of the day. Built with zero external dependencies using native Node.js ESM and `node:test`.

## Requirements

- Node.js >= 18.x (with support for ESM and native `node:test`)

## Usage

Run CLI directly with Node:

```bash
node index.js
```

Or run via npm script:

```bash
npm start
```

## Running Tests

Run unit tests directly with Node:

```bash
node test.js
```

Or run via npm script:

```bash
npm test
```

> **Note:** Running `node test.js` directly executes the `node:test` harness in-process without spawning child processes.
