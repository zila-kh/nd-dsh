import process from 'node:process'

// A terminal handshake probe: one short marker, then exit. Used by
// benchmarks/terminal-handshake-proof.mjs to tell "the console host released
// the child's output" from "the client never answered the cursor-position
// query".
process.stdout.write('ND_HANDSHAKE_PROOF')
