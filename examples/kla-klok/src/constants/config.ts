export const GAME_CONFIG = {
  INITIAL_WALLET_BALANCE: 1000,
  MIN_BET: 1,
  MAX_BET_PER_SYMBOL: 1000,
  MAX_TOTAL_BET: 5000,
  ROLL_ANIMATION_DURATION_MS: 1600,
  REVEAL_ANIMATION_DURATION_MS: 800,
  MAX_HISTORY_ENTRIES: 50,
  STORAGE_KEYS: {
    WALLET: 'kla_klok_wallet_state_v1',
    HISTORY: 'kla_klok_history_v1',
    SETTINGS: 'kla_klok_settings_v1',
  },
} as const
