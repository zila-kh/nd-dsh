export type ElectronTargetIdentity =
  | { kind: 'source' }
  | { kind: 'packaged'; executable: string; sha256: string; artifact: string; executableSha256?: string; extraction?: { receipt: string; payloadSha256: string } }

export function electronTargetIdentity(env?: NodeJS.ProcessEnv): ElectronTargetIdentity
export function electronLaunchOptions(profileDir: string, cwd?: string, env?: NodeJS.ProcessEnv): {
  executablePath?: string
  args: string[]
  cwd: string
  env: Record<string, string>
}
