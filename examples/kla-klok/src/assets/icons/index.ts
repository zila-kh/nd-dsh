export * from './TigerIcon.js'
export * from './GourdIcon.js'
export * from './ShrimpIcon.js'
export * from './FishIcon.js'
export * from './CrabIcon.js'
export * from './RoosterIcon.js'
export * from './ChipIcon.js'
export * from './KbachBorder.js'

import React from 'react'
import type { SymbolId } from '../../types/index.js'
import { TigerIcon } from './TigerIcon.js'
import { GourdIcon } from './GourdIcon.js'
import { ShrimpIcon } from './ShrimpIcon.js'
import { FishIcon } from './FishIcon.js'
import { CrabIcon } from './CrabIcon.js'
import { RoosterIcon } from './RoosterIcon.js'

export const SYMBOL_ICON_COMPONENTS: Record<
  SymbolId,
  React.FC<{ className?: string; size?: number }>
> = {
  tiger: TigerIcon,
  gourd: GourdIcon,
  shrimp: ShrimpIcon,
  fish: FishIcon,
  crab: CrabIcon,
  rooster: RoosterIcon,
}

export function renderSymbolIcon(
  symbolId: SymbolId,
  props: { className?: string; size?: number } = {},
) {
  const IconComponent = SYMBOL_ICON_COMPONENTS[symbolId]
  if (!IconComponent) return null
  return React.createElement(IconComponent, props)
}
