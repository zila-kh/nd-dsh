import { describe, expect, it } from 'vitest'
import { wallpaperCommands } from '../src/main/os/wallpaper.js'

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
})
