import { randomBytes } from 'node:crypto'

export class BrowserAccessTokenStore {
  private readonly sessionByToken = new Map<string, string>()
  private readonly tokenBySession = new Map<string, string>()

  issue(sessionId: string): string {
    const clean = sessionId.trim()
    if (!clean) throw new Error('Browser session id is required')
    const existing = this.tokenBySession.get(clean)
    if (existing) return existing
    const token = randomBytes(32).toString('base64url')
    this.tokenBySession.set(clean, token)
    this.sessionByToken.set(token, clean)
    return token
  }

  session(token: string | undefined): string | undefined {
    if (!token) return undefined
    return this.sessionByToken.get(token)
  }

  revokeSession(sessionId: string): boolean {
    const token = this.tokenBySession.get(sessionId)
    if (!token) return false
    this.tokenBySession.delete(sessionId)
    this.sessionByToken.delete(token)
    return true
  }

  clear(): void {
    this.tokenBySession.clear()
    this.sessionByToken.clear()
  }
}
