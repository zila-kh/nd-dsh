/**
 * Standard 6 traditional Kla-Klok symbols
 */
export type SymbolId = 'tiger' | 'gourd' | 'shrimp' | 'fish' | 'crab' | 'rooster'

export interface SymbolColorPalette {
  primary: string
  secondary: string
  accent: string
  bgClass: string
  borderClass: string
  textClass: string
  glowClass: string
}

export interface SymbolInfo {
  id: SymbolId
  englishName: string
  khmerName: string
  ipa: string
  meaning: string
  description: string
  colorPalette: SymbolColorPalette
  gridOrder: number // 0-5 for 2x3 board layout
}
