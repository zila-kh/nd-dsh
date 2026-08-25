import { promises as fs } from 'node:fs'

const path = 'src/main/terminal/terminal-manager.ts'
let source = await fs.readFile(path, 'utf8')
source = source.replace('const require = createRequire(import.meta.url)', 'const nodeRequire = createRequire(import.meta.url)')
source = source.replaceAll("require('node-pty')", "nodeRequire('node-pty')")
source = source.replaceAll('require.resolve(', 'nodeRequire.resolve(')
source = source.replaceAll("require('node:fs')", "nodeRequire('node:fs')")
if (source.includes('const require = createRequire') || source.includes(" require('node-pty')") || source.includes(' require.resolve(')) {
  throw new Error('Terminal createRequire collision patch was incomplete')
}
await fs.writeFile(path, source, 'utf8')
console.log('Terminal createRequire binding made bundle-safe')
