import { readFile, writeFile } from 'node:fs/promises'

const path = 'src/renderer/src/components/TerminalDock.tsx'
const source = await readFile(path, 'utf8')
const before = '<Layout layout={state.layout} sessionId={sessionId} byId={byId}'
const after = '<Layout key={sessionId} layout={state.layout} sessionId={sessionId} byId={byId}'
if (!source.includes(before)) throw new Error('Terminal root layout render not found')
if (source.includes(after)) throw new Error('Terminal root layout already keyed')
await writeFile(path, source.replace(before, after), 'utf8')
console.log('Terminal layout session remount fix applied')
