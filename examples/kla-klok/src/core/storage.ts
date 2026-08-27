import type { WalletState, RoundSettlement, Language } from '../types/index.js'
import { GAME_CONFIG } from '../constants/index.js'

export const DEFAULT_WALLET_STATE: WalletState = {
  balance: GAME_CONFIG.INITIAL_WALLET_BALANCE,
  startingBalance: GAME_CONFIG.INITIAL_WALLET_BALANCE,
  totalWagered: 0,
  totalWon: 0,
  totalLost: 0,
  netEarnings: 0,
}

export function loadWalletState(): WalletState {
  try {
    const raw = localStorage.getItem(GAME_CONFIG.STORAGE_KEYS.WALLET)
    if (!raw) return { ...DEFAULT_WALLET_STATE }
    const parsed = JSON.parse(raw) as Partial<WalletState>
    if (typeof parsed.balance === 'number' && !isNaN(parsed.balance)) {
      return {
        balance: Math.max(0, parsed.balance),
        startingBalance: parsed.startingBalance ?? GAME_CONFIG.INITIAL_WALLET_BALANCE,
        totalWagered: parsed.totalWagered ?? 0,
        totalWon: parsed.totalWon ?? 0,
        totalLost: parsed.totalLost ?? 0,
        netEarnings: parsed.netEarnings ?? 0,
      }
    }
  } catch {
    // LocalStorage corrupted or disabled, fallback cleanly
  }
  return { ...DEFAULT_WALLET_STATE }
}

export function saveWalletState(wallet: WalletState): void {
  try {
    localStorage.setItem(GAME_CONFIG.STORAGE_KEYS.WALLET, JSON.stringify(wallet))
  } catch {
    // Ignore storage quota or disabled errors
  }
}

export function loadHistory(): RoundSettlement[] {
  try {
    const raw = localStorage.getItem(GAME_CONFIG.STORAGE_KEYS.HISTORY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.slice(0, GAME_CONFIG.MAX_HISTORY_ENTRIES)
    }
  } catch {
    // corrupted history
  }
  return []
}

export function saveHistory(history: RoundSettlement[]): void {
  try {
    const capped = history.slice(0, GAME_CONFIG.MAX_HISTORY_ENTRIES)
    localStorage.setItem(GAME_CONFIG.STORAGE_KEYS.HISTORY, JSON.stringify(capped))
  } catch {
    // Ignore quota errors
  }
}

export interface UserSettings {
  soundEnabled: boolean
  language: Language
  highContrast: boolean
}

export function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(GAME_CONFIG.STORAGE_KEYS.SETTINGS)
    if (!raw) return { soundEnabled: true, language: 'km', highContrast: false }
    const parsed = JSON.parse(raw) as Partial<UserSettings>
    return {
      soundEnabled: parsed.soundEnabled ?? true,
      language: parsed.language === 'en' ? 'en' : 'km',
      highContrast: parsed.highContrast ?? false,
    }
  } catch {
    return { soundEnabled: true, language: 'km', highContrast: false }
  }
}

export function saveSettings(settings: UserSettings): void {
  try {
    localStorage.setItem(GAME_CONFIG.STORAGE_KEYS.SETTINGS, JSON.stringify(settings))
  } catch {
    // Ignore
  }
}
