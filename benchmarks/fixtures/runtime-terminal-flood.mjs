import process from 'node:process'

const bytes = Math.max(1, Number(process.argv[2] || 2 * 1024 * 1024))
const chunk = Buffer.alloc(Math.min(16 * 1024, bytes), 120)
let written = 0

function writeMore() {
  while (written < bytes) {
    const size = Math.min(chunk.length, bytes - written)
    const ok = process.stdout.write(chunk.subarray(0, size))
    written += size
    if (!ok) {
      process.stdout.once('drain', writeMore)
      return
    }
  }
  process.stdout.write('\nND_RUNTIME_STRESS_DONE\n')
}
writeMore()
