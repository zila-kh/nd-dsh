import type { SymbolId } from './symbol.js'
import type { BetMap } from './bet.js'
import type { DiceOutcome, RoundSettlement } from './dice.js'
import type { WalletState, ChipValue } from './wallet.js'
import type { Language } from './i18n.js'

export type GamePhase = 'betting' | 'rolling' | 'revealing' | 'settled'

export interface GameAnnouncement {
  message: string
  politeness: 'polite' | 'assertive'
  id: string
}

export interface GameState {
  phase: GamePhase
  roundNumber: number
  currentBets: BetMap
  selectedChip: ChipValue
  lastBets: BetMap | null
  lastOutcome: DiceOutcome | null
  lastSettlement: RoundSettlement | null
  wallet: WalletState
  history: RoundSettlement[]
  soundEnabled: boolean
  language: Language
  highContrast: boolean
  announcement: GameAnnouncement | null
}

export type GameAction =
  | { type: 'PLACE_BET'; symbolId: SymbolId; amount: number }
  | { type: 'REMOVE_BET'; symbolId: SymbolId; amount?: number }
  | { type: 'CLEAR_BETS' }
  | { type: 'DOUBLE_BETS' }
  | { type: 'REBET_LAST' }
  | { type: 'SELECT_CHIP'; chip: ChipValue }
  | { type: 'START_ROLL' }
  | { type: 'REVEAL_DICE'; outcome: DiceOutcome }
  | { type: 'SETTLE_ROUND' }
  | { type: 'NEXT_ROUND' }
  | { type: 'RESET_GAME'; initialBalance?: number }
  | { type: 'TOP_UP_WALLET'; amount: number }
  | { type: 'TOGGLE_SOUND' }
  | { type: 'SET_LANGUAGE'; language: Language }
  | { type: 'TOGGLE_HIGH_CONTRAST' }
  | { type: 'SET_HIGH_CONTRAST'; enabled: boolean }
  | { type: 'SET_ANNOUNCEMENT'; message: string; politeness?: 'polite' | 'assertive' }
  | { type: 'CLEAR_HISTORY' }
