import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getActiveWallpaperState,
  listWallpapersInFolder,
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

  it('manages wallpaper active state safely', () => {
    setActiveWallpaperState('/tmp/test-wallpaper.png', '/tmp')
    expect(getActiveWallpaperState()).toEqual({
      path: '/tmp/test-wallpaper.png',
      folder: '/tmp',
    })
  })
})
