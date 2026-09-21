import process from 'node:process'
import { terminalChunks, writeChunks } from '../lib/terminal-payload.mjs'

const requested = Math.max(1, Number(process.argv[2] || 65536))
await writeChunks(terminalChunks(requested))
