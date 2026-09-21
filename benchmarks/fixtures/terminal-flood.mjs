import process from 'node:process'
const requested = Math.max(1, Number(process.argv[2] || 65536))
const chunk = Buffer.alloc(4096, 65)
let remaining = requested
while (remaining > 0) {
  const size = Math.min(remaining, chunk.length)
  const ok = process.stdout.write(chunk.subarray(0, size))
  remaining -= size
  if (!ok) await new Promise((resolvePromise) => process.stdout.once('drain', resolvePromise))
}
