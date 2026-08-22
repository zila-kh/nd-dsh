/**
 * IPC channels for the sandboxed ND Pencil child view's host bridge. Kept in
 * its own module so the two preload entry points (product shell and pencil
 * host) share no runtime module: Electron's sandboxed preload require cannot
 * load rollup chunk files, so each preload must bundle to a single file.
 */
export const ND_PENCIL_HOST_IPC = {
  pageMessage: 'design:nd-pencil-host-page-message',
  hostMessage: 'design:nd-pencil-host-message',
} as const
