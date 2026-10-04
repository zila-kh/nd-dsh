import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getActiveWallpaperState,
  listWallpapersInFolder,
  normalizeWallpaperPath,
  setActiveWallpaperState,
  wallpaperCommands,
} from '../src/main/os/wallpaper.js'

describe('desktop wallpaper adapter', () => {
  it('does not interpolate a Windows path into the PowerShell program', () => {
    const path = 'C:\\Users\\ND User\\Pictures\\quote " dangerous.png'
    const [command] = wallpaperCommands('win32', path, { SystemRoot: 'C:\\Windows' })

    expect(command?.file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(command?.env?.ND_WALLPAPER_PATH).toBe(path)
    expect(command?.args.join(' ')).not.toContain(path)
    expect(command?.args).toContain('-NonInteractive')
  })

  it('passes the macOS path through the environment instead of AppleScript text', () => {
    const path = '/Users/nd/Pictures/a "quoted" image.png'
    const [command] = wallpaperCommands('darwin', path, {})

    expect(command?.file).toBe('/usr/bin/osascript')
    expect(command?.env?.ND_WALLPAPER_PATH).toBe(path)
    expect(command?.args.join(' ')).not.toContain(path)
  })

  it('uses execFile arguments and file URIs for the GNOME adapter', () => {
    const path = '/home/nd/My Wallpapers/one.png'
    const commands = wallpaperCommands('linux', path, {})

    expect(commands).toHaveLength(2)
    expect(commands[0]?.file).toBe('gsettings')
    expect(commands[0]?.args.at(-1)).toBe('file:///home/nd/My%20Wallpapers/one.png')
    expect(commands[1]?.optional).toBe(true)
  })

  it('fails closed on unsupported platforms', () => {
    expect(() => wallpaperCommands('aix', '/tmp/a.png')).toThrow(/not supported/)
  })

  it('lists only supported image formats in a folder and sorts them naturally', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-wp-'))
    try {
      await writeFile(join(dir, 'wall-2.jpg'), 'fake-image-2')
      await writeFile(join(dir, 'wall-1.png'), 'fake-image-1')
      await writeFile(join(dir, 'notes.txt'), 'not-an-image')
      await writeFile(join(dir, 'wall-10.webp'), 'fake-image-10')

      const items = await listWallpapersInFolder(dir)
      expect(items.map((item) => item.filename)).toEqual(['wall-1.png', 'wall-2.jpg', 'wall-10.webp'])
      expect(items[0]?.size).toBeGreaterThan(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('scans direct subfolders when the root folder has no direct images', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-wp-sub-'))
    try {
      const sub = join(dir, 'Wallpapers_4K')
      await mkdir(sub)
      await writeFile(join(sub, '01_nature.jpg'), 'fake-1')
      await writeFile(join(sub, '02_mountain.png'), 'fake-2')
      const items = await listWallpapersInFolder(dir)
      expect(items.map((i) => i.filename)).toEqual(['01_nature.jpg', '02_mountain.png'])
      expect(items[0]?.path).toBe(join(sub, '01_nature.jpg'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('normalizes quoted and messy folder paths correctly', async () => {
    expect(normalizeWallpaperPath('"C:\\Users\\Pictures"')).toBe('C:\\Users\\Pictures')
    expect(normalizeWallpaperPath("'C:\\Users\\Pictures'")).toBe('C:\\Users\\Pictures')
    expect(normalizeWallpaperPath('  "D:\\wallpapers"  ')).toBe('D:\\wallpapers')
    expect(normalizeWallpaperPath(undefined)).toBe('')

    const dir = await mkdtemp(join(tmpdir(), 'nd-wp-quoted-'))
    try {
      await writeFile(join(dir, 'photo.jpg'), 'fake')
      const items = await listWallpapersInFolder(`"${dir}"`)
      expect(items).toHaveLength(1)
      expect(items[0]?.filename).toBe('photo.jpg')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('manages wallpaper active state safely', () => {
    setActiveWallpaperState('/tmp/test-wallpaper.png', '/tmp')
    expect(getActiveWallpaperState()).toEqual({
      path: '/tmp/test-wallpaper.png',
      folder: '/tmp',
    })
  })
})
