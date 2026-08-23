import { desktopCapturer, screen, type BrowserWindow } from 'electron'

/**
 * Cross-application UI capture. The browser pane has DOM-level inspection
 * (ui-inspector); every other target — Electron, React Native, Flutter, or
 * native apps — shares one honest mechanism: a screenshot of the primary
 * display. The image is bridged straight from this trusted main process into
 * the ND chat session, so its bytes never cross renderer IPC.
 */

export interface AppCaptureImage {
  /** Base64 PNG bytes. */
  data: string
  mediaType: 'image/png'
  name: string
  width: number
  height: number
  /** Physical display size at capture time. */
  displayLabel: string
}

/** Keep prompt payloads sane on high-DPI displays. */
const MAX_CAPTURE_WIDTH = 1_600

export async function capturePrimaryDisplay(): Promise<AppCaptureImage> {
  const primary = screen.getPrimaryDisplay()
  const scale = Math.min(1, MAX_CAPTURE_WIDTH / Math.max(1, primary.size.width))
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.max(1, Math.round(primary.size.width * scale)),
      height: Math.max(1, Math.round(primary.size.height * scale)),
    },
  })
  const source = sources.find((item) => item.display_id === String(primary.id)) ?? sources[0]
  if (!source) throw new Error('No capturable display was available')
  const png = source.thumbnail.toPNG()
  if (png.length === 0) throw new Error('The display capture returned an empty image')
  const size = source.thumbnail.getSize()
  return {
    data: png.toString('base64'),
    mediaType: 'image/png',
    name: `app-capture-${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
    width: size.width,
    height: size.height,
    displayLabel: `${primary.size.width}x${primary.size.height}`,
  }
}

/** Self-inspect: render this ND-DSH window's own contents, no screen capture. */
export async function captureSelfWindow(window: BrowserWindow): Promise<AppCaptureImage> {
  if (window.isDestroyed() || window.webContents.isDestroyed()) throw new Error('The ND-DSH window is no longer available')
  const image = await window.webContents.capturePage()
  if (image.isEmpty()) throw new Error('The window capture returned an empty image')
  const full = image.getSize()
  const scale = Math.min(1, MAX_CAPTURE_WIDTH / Math.max(1, full.width))
  const scaled = scale < 1 ? image.resize({ width: Math.round(full.width * scale) }) : image
  const png = scaled.toPNG()
  if (png.length === 0) throw new Error('The window capture returned an empty image')
  const size = scaled.getSize()
  return {
    data: png.toString('base64'),
    mediaType: 'image/png',
    name: `self-capture-${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
    width: size.width,
    height: size.height,
    displayLabel: `${full.width}x${full.height}`,
  }
}
