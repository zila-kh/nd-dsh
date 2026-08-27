export type ChipValue = 1 | 5 | 10 | 25 | 50 | 100 | 500 | 1000

export interface ChipConfig {
  value: ChipValue
  label: string
  color: {
    bg: string
    border: string
    text: string
    accent: string
    glow: string
  }
}

export interface WalletState {
  balance: number
  startingBalance: number
  totalWagered: number
  totalWon: number
  totalLost: number
  netEarnings: number
}
