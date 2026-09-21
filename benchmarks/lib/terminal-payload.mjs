import { once } from 'node:events'

/**
 * Shared payload contract for the terminal throughput benchmark.
 *
 * A PTY is not a byte pipe. Windows ConPTY re-renders the child's VT stream
 * before handing it to the terminal client: it translates LF to CRLF, and once
 * a line reaches the right margin it emits its own wrap sequence
 * (`\r\n` + cursor reposition) and re-emits the margin character. A raw byte
 * blob therefore cannot be expected back verbatim - measured on Windows with
 * `ESC[6n` answered, a 64 KiB blob of `A` came back as 66 332 payload bytes
 * with 796 injected wrap sequences. That re-rendering belongs to the console
 * host, not to nd-core, so the benchmark must not confuse it with a lost byte.
 *
 * The payload is therefore emitted as records that stay well inside the
 * terminal width, and each record identifies its own position. Record 0 starts
 * with `00000000`, record 1 with `00000001`, and so on; the remaining bytes are
 * `A` (0x41). Every record is terminated by a single LF, which the console host
 * may render as CRLF - line endings are transport, not payload.
 *
 * The integrity assertion is exact rather than statistical: the payload bytes
 * of the whole stream must equal {@link expectedPayload} byte for byte. That
 * proves length, content and order together, and stays identical on POSIX
 * (where the same bytes arrive without any translation).
 */
export const RECORD_BYTES = 64
export const RECORD_TERMINATOR_BYTES = 1
export const PAYLOAD_FILL = 0x41
const RECORD_STAMP_BYTES = 8
const DEFAULT_CHUNK_BYTES = 4096
const LF = 0x0a
const CR = 0x0d
const ESC = 0x1b
const BEL = 0x07

/**
 * The exact payload a terminal-flood fixture emits for `totalBytes`.
 * @param {number} totalBytes - payload bytes the fixture was asked to write.
 * @returns {Buffer} the expected payload, without line terminators.
 */
export function expectedPayload(totalBytes) {
  const payload = Buffer.alloc(totalBytes)
  let offset = 0
  let recordIndex = 0
  while (offset < totalBytes) {
    const size = Math.min(RECORD_BYTES, totalBytes - offset)
    const stamp = Buffer.from(recordStamp(recordIndex), 'utf8')
    const stampBytes = Math.min(stamp.length, size)
    stamp.copy(payload, offset, 0, stampBytes)
    payload.fill(PAYLOAD_FILL, offset + stampBytes, offset + size)
    offset += size
    recordIndex += 1
  }
  return payload
}

/**
 * The fixture's write plan: whole records with their terminators, grouped into
 * chunk-sized writes so the benchmark still measures the console host pushing
 * large writes rather than one syscall per record.
 * @param {number} totalBytes - payload bytes to emit.
 * @param {number} [chunkBytes] - approximate bytes per stdout write.
 * @returns {Buffer[]} buffers to write in order.
 */
export function terminalChunks(totalBytes, chunkBytes = DEFAULT_CHUNK_BYTES) {
  const payload = expectedPayload(totalBytes)
  const chunks = []
  let pending = []
  let pendingBytes = 0
  let offset = 0
  while (offset < payload.length) {
    const end = Math.min(offset + RECORD_BYTES, payload.length)
    pending.push(payload.subarray(offset, end), Buffer.from([LF]))
    pendingBytes += (end - offset) + RECORD_TERMINATOR_BYTES
    offset = end
    if (pendingBytes >= chunkBytes) {
      chunks.push(Buffer.concat(pending, pendingBytes))
      pending = []
      pendingBytes = 0
    }
  }
  if (pendingBytes > 0) chunks.push(Buffer.concat(pending, pendingBytes))
  return chunks
}

/**
 * Split one terminal stream into the fixture's payload and the transport bytes
 * the console host added around it.
 *
 * Payload is every byte outside a complete escape sequence that is not a C0
 * control byte, DEL, CR or LF; everything else is reported as transport. A
 * trailing escape sequence that never completes is counted as transport and
 * surfaced through `unterminatedEscapeBytes` rather than silently dropped.
 * @param {Buffer} buffer - the terminal stream in arrival order.
 * @returns {{payload: Buffer, escapeSequences: number, carriageReturns: number, lineFeeds: number, otherControlBytes: number, unterminatedEscapeBytes: number, transportBytes: number}}
 */
export function classifyTerminalStream(buffer) {
  const payload = []
  let escapeSequences = 0
  let carriageReturns = 0
  let lineFeeds = 0
  let otherControlBytes = 0
  let unterminatedEscapeBytes = 0
  let index = 0
  while (index < buffer.length) {
    const byte = buffer[index]
    if (byte === ESC) {
      const end = escapeSequenceEnd(buffer, index)
      if (end === -1) {
        unterminatedEscapeBytes = buffer.length - index
        break
      }
      escapeSequences += 1
      index = end
      continue
    }
    if (byte === CR) {
      carriageReturns += 1
      index += 1
      continue
    }
    if (byte === LF) {
      lineFeeds += 1
      index += 1
      continue
    }
    if (byte < 0x20 || byte === 0x7f) {
      otherControlBytes += 1
      index += 1
      continue
    }
    payload.push(byte)
    index += 1
  }
  const classified = {
    payload: Buffer.from(payload),
    escapeSequences,
    carriageReturns,
    lineFeeds,
    otherControlBytes,
    unterminatedEscapeBytes,
    transportBytes: buffer.length - payload.length,
  }
  return classified
}

/**
 * Describe the first byte where an observed payload diverges from the expected
 * one, so a failure names the corruption instead of only a count.
 * @param {Buffer} expected - payload the fixture emitted.
 * @param {Buffer} observed - payload the terminal stream delivered.
 * @returns {string} a one-line mismatch description.
 */
export function payloadMismatch(expected, observed) {
  const limit = Math.min(expected.length, observed.length)
  let offset = -1
  for (let index = 0; index < limit; index += 1) {
    if (expected[index] !== observed[index]) {
      offset = index
      break
    }
  }
  if (offset === -1) {
    return 'length expected=' + expected.length + ' observed=' + observed.length
  }
  return 'firstDifference=' + offset
    + ' expected=0x' + expected[offset].toString(16).padStart(2, '0')
    + ' observed=0x' + observed[offset].toString(16).padStart(2, '0')
    + ' (expectedLength=' + expected.length + ' observedLength=' + observed.length + ')'
}

/** The 8-digit position stamp that starts every record. */
function recordStamp(recordIndex) {
  return recordIndex.toString(16).padStart(RECORD_STAMP_BYTES, '0').slice(-RECORD_STAMP_BYTES)
}

/**
 * Return the index just past the escape sequence starting at `start`, or -1
 * when the buffer ends inside it. Handles CSI, OSC (BEL- or ST-terminated) and
 * single-character escapes - the shapes ConPTY emits.
 */
function escapeSequenceEnd(buffer, start) {
  const introducer = buffer[start + 1]
  if (introducer === undefined) return -1
  if (introducer === 0x5b) {
    for (let index = start + 2; index < buffer.length; index += 1) {
      const byte = buffer[index]
      if (byte >= 0x40 && byte <= 0x7e) return index + 1
    }
    return -1
  }
  if (introducer === 0x5d) {
    for (let index = start + 2; index < buffer.length; index += 1) {
      if (buffer[index] === BEL) return index + 1
      if (buffer[index] === ESC && buffer[index + 1] === 0x5c) return index + 2
    }
    return -1
  }
  return start + 2
}

/** Write every chunk in order, waiting for backpressure before the next one. */
export async function writeChunks(chunks, stream = process.stdout) {
  for (const chunk of chunks) {
    if (!stream.write(chunk)) await once(stream, 'drain')
  }
}
