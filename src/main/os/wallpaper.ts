import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { win32 } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface WallpaperCommand {
  file: string
  args: string[]
  env?: NodeJS.ProcessEnv
  optional?: boolean
}

const WINDOWS_SCRIPT = String.raw`
$path = [Environment]::GetEnvironmentVariable('ND_WALLPAPER_PATH', 'Process')
if ([string]::IsNullOrWhiteSpace($path)) { throw 'ND_WALLPAPER_PATH is empty' }
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NdWallpaper {
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool SystemParametersInfo(int action, int param, string path, int flags);
}
'@
if (-not [NdWallpaper]::SystemParametersInfo(20, 0, $path, 3)) {
  throw ('SystemParametersInfo failed: ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
}
`

/**
 * Build fixed-binary, no-shell commands for a wallpaper update.
 *
 * The user-selected path is never interpolated into PowerShell/AppleScript.
 * Windows and macOS receive it through a process environment variable; Linux
 * passes a file:// URI as a plain execFile argument.
 */
export function wallpaperCommands(
  platform: NodeJS.Platform,
  imagePath: string,
  env: NodeJS.ProcessEnv = process.env,
): WallpaperCommand[] {
  if (platform === 'win32') {
    const systemRoot = env.SystemRoot || env.WINDIR || 'C:\\Windows'
    return [{
      file: win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_SCRIPT],
      env: { ...env, ND_WALLPAPER_PATH: imagePath },
    }]
  }

  if (platform === 'darwin') {
    return [{
      file: '/usr/bin/osascript',
      args: [
        '-e', 'set p to system attribute "ND_WALLPAPER_PATH"',
        '-e', 'tell application "System Events" to tell every desktop to set picture to POSIX file p',
      ],
      env: { ...env, ND_WALLPAPER_PATH: imagePath },
    }]
  }

  if (platform === 'linux') {
    const uri = pathToFileURL(imagePath).href
    return [
      {
        file: 'gsettings',
        args: ['set', 'org.gnome.desktop.background', 'picture-uri', uri],
      },
      {
        file: 'gsettings',
        args: ['set', 'org.gnome.desktop.background', 'picture-uri-dark', uri],
        optional: true,
      },
    ]
  }

  throw new Error(`Changing wallpaper is not supported on ${platform}`)
}

export async function setDesktopWallpaper(imagePath: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  await access(imagePath)
  for (const command of wallpaperCommands(platform, imagePath)) {
    try {
      await execFileAsync(command.file, command.args, {
        ...(command.env ? { env: command.env } : {}),
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 512 * 1024,
      })
    } catch (error) {
      if (command.optional) continue
      if (platform === 'linux') {
        throw new Error(`Could not change wallpaper through GNOME gsettings: ${message(error)}`)
      }
      throw new Error(`Could not change desktop wallpaper: ${message(error)}`)
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
