import React from 'react'
import type { ChipValue } from '../../types/index.js'

interface ChipIconProps {
  value: ChipValue
  size?: number | string
  className?: string
  isSelected?: boolean
  onClick?: () => void
  disabled?: boolean
  asButton?: boolean
}

export const ChipIcon: React.FC<ChipIconProps> = ({
  value,
  size = 48,
  className = '',
  isSelected = false,
  onClick,
  disabled = false,
  asButton = true,
}) => {
  const getChipBaseFill = (val: ChipValue): string => {
    switch (val) {
      case 1:
        return '#F5F5F4'
      case 5:
        return '#DC2626'
      case 10:
        return '#2563EB'
      case 25:
        return '#16A34A'
      case 50:
        return '#9333EA'
      case 100:
        return '#1C1917'
      case 500:
        return '#D97706'
      case 1000:
        return 'url(#goldChipGrad)'
      default:
        return '#2563EB'
    }
  }

  const getTextFill = (val: ChipValue): string => {
    switch (val) {
      case 1:
        return '#1C1917'
      case 100:
        return '#FBBF24'
      case 500:
        return '#FEF08A'
      case 1000:
        return '#FDE047'
      default:
        return '#FFFFFF'
    }
  }

  const svgElement = (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full drop-shadow-md select-none pointer-events-none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="goldChipGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FDE047" />
          <stop offset="40%" stopColor="#EAB308" />
          <stop offset="80%" stopColor="#CA8A04" />
          <stop offset="100%" stopColor="#854D0E" />
        </linearGradient>
        <radialGradient id="chipCenterShadow" cx="50%" cy="50%" r="50%">
          <stop offset="70%" stopColor="#0C0A09" />
          <stop offset="100%" stopColor="#000000" />
        </radialGradient>
      </defs>

      {/* Outer Ring */}
      <circle cx="50" cy="50" r="48" fill="#1C1917" stroke={value === 1000 ? '#FDE047' : '#44403C'} strokeWidth="2.5" />

      {/* Main Base Color Circle */}
      <circle cx="50" cy="50" r="45" fill={getChipBaseFill(value)} />

      {/* Casino Chip Rim Dashes (8 radial notches) */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <rect
          key={angle}
          x="46"
          y="5"
          width="8"
          height="11"
          rx="2"
          fill={value === 1 ? '#78716C' : '#FFFFFF'}
          opacity="0.9"
          transform={`rotate(${angle} 50 50)`}
        />
      ))}

      {/* Inner Ring with Dashed Line */}
      <circle
        cx="50"
        cy="50"
        r="32"
        fill="#1C1917"
        stroke={value === 1000 ? '#FBBF24' : value === 100 ? '#F59E0B' : '#78716C'}
        strokeWidth="2"
        strokeDasharray="3 3"
      />

      {/* Center Disc */}
      <circle cx="50" cy="50" r="26" fill="url(#chipCenterShadow)" />

      {/* Value Text */}
      <text
        x="50"
        y={value >= 1000 ? '56' : '57'}
        textAnchor="middle"
        fontSize={value >= 1000 ? '18' : value >= 100 ? '22' : '25'}
        fontWeight="bold"
        fill={getTextFill(value)}
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {value >= 1000 ? '1K' : value}
      </text>
    </svg>
  )

  if (!asButton) {
    return (
      <div
        className={`relative inline-flex items-center justify-center rounded-full ${className}`}
        style={{ width: size, height: size }}
      >
        {svgElement}
      </div>
    )
  }

  return (
    <button
      type="button"
      role="radio"
      onClick={onClick}
      disabled={disabled}
      tabIndex={disabled ? -1 : isSelected ? 0 : -1}
      aria-label={`Bet chip $${value}`}
      aria-checked={isSelected}
      aria-pressed={isSelected}
      data-testid={`chip-button-${value}`}
      className={`group relative inline-flex items-center justify-center rounded-full transition-all duration-200 select-none cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-900 ${
        isSelected
          ? 'scale-110 -translate-y-1.5 shadow-xl ring-2 ring-amber-400 z-10'
          : 'hover:scale-105 hover:-translate-y-1 shadow-md opacity-90 hover:opacity-100 active:scale-95'
      } ${disabled ? 'opacity-35 cursor-not-allowed hover:scale-100 hover:translate-y-0 active:scale-100' : ''} ${className}`}
      style={{ width: size, height: size }}
    >
      {svgElement}
    </button>
  )
}
export default ChipIcon
