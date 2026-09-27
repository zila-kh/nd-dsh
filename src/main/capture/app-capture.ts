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

export interface AppCaptureArea {
  x: number
  y: number
  width: number
  height: number
}

export async function capturePrimaryDisplay(rect?: AppCaptureArea): Promise<AppCaptureImage> {
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
  let image = source.thumbnail
  if (rect && rect.width > 0 && rect.height > 0) {
    const thumbSize = image.getSize()
    const scaleX = thumbSize.width / Math.max(1, primary.size.width)
    const scaleY = thumbSize.height / Math.max(1, primary.size.height)
    const cropX = Math.max(0, Math.min(thumbSize.width - 1, Math.round(rect.x * scaleX)))
    const cropY = Math.max(0, Math.min(thumbSize.height - 1, Math.round(rect.y * scaleY)))
    const cropW = Math.max(1, Math.min(thumbSize.width - cropX, Math.round(rect.width * scaleX)))
    const cropH = Math.max(1, Math.min(thumbSize.height - cropY, Math.round(rect.height * scaleY)))
    if (cropW > 0 && cropH > 0) {
      image = image.crop({ x: cropX, y: cropY, width: cropW, height: cropH })
    }
  }
  const png = image.toPNG()
  if (png.length === 0) throw new Error('The display capture returned an empty image')
  const size = image.getSize()
  return {
    data: png.toString('base64'),
    mediaType: 'image/png',
    name: `app-capture-${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
    width: size.width,
    height: size.height,
    displayLabel: rect && rect.width > 0 && rect.height > 0
      ? `${Math.round(rect.width)}x${Math.round(rect.height)}`
      : `${primary.size.width}x${primary.size.height}`,
  }
}

/**
 * Whole-display capture for Daily Essentials: the display under the pointer by
 * default, or an explicitly chosen display. Displays may sit at negative
 * coordinates and use different scale factors; everything here is resolved in
 * physical screen coordinates and converted per display.
 */
export async function captureDisplayUnderPointer(displayId?: number): Promise<AppCaptureImage> {
  const display = displayId === undefined
    ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    : screen.getAllDisplays().find((item) => item.id === displayId) ?? screen.getPrimaryDisplay()
  return captureDisplay(display)
}

/** Capture the region of the screen under a rect given in desktop coordinates. */
export async function captureScreenRegion(rect: AppCaptureArea): Promise<AppCaptureImage> {
  const displays = screen.getAllDisplays()
  let best: { display: Electron.Display; width: number; height: number } | undefined
  for (const display of displays) {
    const intersection = intersect(rect, display.bounds)
    if (!intersection) continue
    const area = intersection.width * intersection.height
    if (!best || area > best.width * best.height) best = { display, width: intersection.width, height: intersection.height }
  }
  if (!best) throw new Error('The selected area is not on any connected display')
  const local = intersect(rect, best.display.bounds)!
  // Crop coordinates are display-local; negative display origins already
  // cancelled out in the intersection above.
  return captureDisplay(best.display, {
    x: local.x - best.display.bounds.x,
    y: local.y - best.display.bounds.y,
    width: local.width,
    height: local.height,
  })
}

async function captureDisplay(display: Electron.Display, rect?: AppCaptureArea): Promise<AppCaptureImage> {
  const scale = Math.min(1, MAX_CAPTURE_WIDTH / Math.max(1, display.size.width))
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.max(1, Math.round(display.size.width * scale)),
      height: Math.max(1, Math.round(display.size.height * scale)),
    },
  })
  const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[0]
  if (!source) throw new Error('No capturable display was available')
  let image = source.thumbnail
  if (rect && rect.width > 0 && rect.height > 0) {
    const thumbSize = image.getSize()
    const scaleX = thumbSize.width / Math.max(1, display.size.width)
    const scaleY = thumbSize.height / Math.max(1, display.size.height)
    const crop = {
      x: Math.max(0, Math.min(thumbSize.width - 1, Math.round(rect.x * scaleX))),
      y: Math.max(0, Math.min(thumbSize.height - 1, Math.round(rect.y * scaleY))),
      width: Math.max(1, Math.round(rect.width * scaleX)),
      height: Math.max(1, Math.round(rect.height * scaleY)),
    }
    crop.width = Math.max(1, Math.min(crop.width, thumbSize.width - crop.x))
    crop.height = Math.max(1, Math.min(crop.height, thumbSize.height - crop.y))
    image = image.crop(crop)
  }
  const png = image.toPNG()
  if (png.length === 0) throw new Error('The display capture returned an empty image')
  const size = image.getSize()
  return {
    data: png.toString('base64'),
    mediaType: 'image/png',
    name: `nd-capture-${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
    width: size.width,
    height: size.height,
    displayLabel: rect && rect.width > 0 && rect.height > 0
      ? `${Math.round(rect.width)}x${Math.round(rect.height)}`
      : `${display.size.width}x${display.size.height}`,
  }
}

function intersect(rect: AppCaptureArea, bounds: { x: number; y: number; width: number; height: number }): AppCaptureArea | undefined {
  const x = Math.max(rect.x, bounds.x)
  const y = Math.max(rect.y, bounds.y)
  const right = Math.min(rect.x + rect.width, bounds.x + bounds.width)
  const bottom = Math.min(rect.y + rect.height, bounds.y + bounds.height)
  if (right <= x || bottom <= y) return undefined
  return { x, y, width: right - x, height: bottom - y }
}

/** Self-inspect: render this ND-DSH window's own contents, no screen capture. */
export async function captureSelfWindow(window: BrowserWindow, rect?: AppCaptureArea): Promise<AppCaptureImage> {
  if (window.isDestroyed() || window.webContents.isDestroyed()) throw new Error('The ND-DSH window is no longer available')
  const bounds = rect && rect.width > 0 && rect.height > 0 ? {
    x: Math.max(0, Math.round(rect.x)),
    y: Math.max(0, Math.round(rect.y)),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  } : undefined
  const image = bounds ? await window.webContents.capturePage(bounds) : await window.webContents.capturePage()
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
    displayLabel: bounds ? `${bounds.width}x${bounds.height}` : `${full.width}x${full.height}`,
  }
}
