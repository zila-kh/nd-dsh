import React from 'react'
import type { GamePhase } from '../../types/index.js'
import { Sparkles } from 'lucide-react'

interface ShakerCupProps {
  phase?: GamePhase
  isRolling?: boolean
  isRevealing?: boolean
  canRoll?: boolean
  onClick?: () => void
  disabled?: boolean
  t?: (key: any, params?: Record<string, string | number>) => string
}

export const ShakerCup: React.FC<ShakerCupProps> = ({
  phase = 'betting',
  isRolling = false,
  isRevealing = false,
  canRoll = false,
  onClick,
  disabled = false,
  t,
}) => {
  const rolling = isRolling || phase === 'rolling'
  const revealing = isRevealing || phase === 'revealing'
  const isClickable = canRoll && !rolling && !revealing && !disabled && !!onClick

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && isClickable && onClick) {
      e.preventDefault()
      onClick()
    }
  }

  return (
    <div
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={isClickable ? onClick : undefined}
      onKeyDown={handleKeyDown}
      aria-label={
        t
          ? rolling
            ? t('status.rolling')
            : t('action.shake')
          : 'Khmer traditional dice cup'
      }
      aria-disabled={disabled || rolling || revealing}
      data-testid="shaker-cup"
      className={`relative w-40 h-40 sm:w-48 sm:h-48 flex items-center justify-center select-none transition-all duration-300 ${
        rolling
          ? 'animate-cup-shake cursor-wait'
          : revealing
            ? 'animate-cup-lift pointer-events-none'
            : isClickable
              ? 'cursor-pointer hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 rounded-full'
              : 'cursor-default'
      }`}
    >
      {/* Vibration Wave Arcs / Ripples during active shaking */}
      {rolling && (
        <>
          <div
            className="absolute inset-0 rounded-full border-2 border-amber-400/40 animate-vibration-ring pointer-events-none"
            style={{ animationDelay: '0s' }}
          />
          <div
            className="absolute inset-2 rounded-full border-2 border-amber-500/30 animate-vibration-ring pointer-events-none"
            style={{ animationDelay: '0.25s' }}
          />
          <div
            className="absolute -inset-2 rounded-full border border-yellow-300/20 animate-vibration-ring pointer-events-none"
            style={{ animationDelay: '0.45s' }}
          />
        </>
      )}

      {/* Floating Gold Sparkle Particles during shaking */}
      {rolling && (
        <div className="absolute inset-0 pointer-events-none overflow-visible">
          <Sparkles
            className="absolute -top-3 left-4 w-5 h-5 text-amber-300 animate-particle"
            style={{ animationDelay: '0.1s' }}
          />
          <Sparkles
            className="absolute top-2 right-2 w-4 h-4 text-yellow-200 animate-particle"
            style={{ animationDelay: '0.35s' }}
          />
          <Sparkles
            className="absolute -bottom-2 left-6 w-4 h-4 text-amber-400 animate-particle"
            style={{ animationDelay: '0.6s' }}
          />
          <Sparkles
            className="absolute bottom-4 right-4 w-5 h-5 text-yellow-300 animate-particle"
            style={{ animationDelay: '0.2s' }}
          />
        </div>
      )}

      {/* Traditional Khmer Lacquer & Gold Tror-laok (ត្រឡោក) SVG */}
      <svg
        viewBox="0 0 160 160"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full drop-shadow-2xl overflow-visible"
        aria-hidden="true"
      >
        <defs>
          {/* Lacquered Coconut Shell Wood Gradient */}
          <radialGradient id="cupGrad" cx="45%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#D97706" />
            <stop offset="35%" stopColor="#92400E" />
            <stop offset="70%" stopColor="#451A03" />
            <stop offset="100%" stopColor="#1C0A00" />
          </radialGradient>

          {/* Polished Gold Trim Gradient */}
          <linearGradient id="goldTrimGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#F59E0B" />
            <stop offset="30%" stopColor="#FDE68A" />
            <stop offset="60%" stopColor="#D97706" />
            <stop offset="100%" stopColor="#78350F" />
          </linearGradient>

          {/* Tray Plate Gradient */}
          <linearGradient id="plateGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#291409" />
            <stop offset="50%" stopColor="#5E2B0C" />
            <stop offset="100%" stopColor="#1C0A00" />
          </linearGradient>

          {/* Drop Shadow filter */}
          <filter id="cupShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#000000" floodOpacity="0.6" />
          </filter>
        </defs>

        {/* Outer Platter / Base Rim */}
        <ellipse
          cx="80"
          cy="134"
          rx="72"
          ry="18"
          fill="url(#plateGrad)"
          stroke="#78350F"
          strokeWidth="2"
        />
        <ellipse
          cx="80"
          cy="131"
          rx="66"
          ry="14"
          fill="#1C0A00"
          stroke="url(#goldTrimGrad)"
          strokeWidth="1.5"
        />

        {/* Shaker Dome / Cup (Tror-laok / ត្រឡោក) */}
        <g filter="url(#cupShadow)">
          <path
            d="M28 122 C26 62, 42 26, 80 26 C118 26, 134 62, 132 122 Z"
            fill="url(#cupGrad)"
            stroke="#291409"
            strokeWidth="2.5"
          />

          {/* Highlight Sheen on Left Dome */}
          <path
            d="M36 112 C34 72, 46 40, 72 32 C60 40, 48 70, 48 112 Z"
            fill="#FFFFFF"
            fillOpacity="0.12"
          />

          {/* Top Handle Knob / Lotus Finial */}
          <circle
            cx="80"
            cy="20"
            r="11"
            fill="url(#goldTrimGrad)"
            stroke="#451A03"
            strokeWidth="1.5"
          />
          <circle cx="80" cy="18" r="6" fill="#FEF3C7" fillOpacity="0.6" />
          <path d="M76 12 C78 9, 82 9, 84 12 Z" fill="url(#goldTrimGrad)" />

          {/* Traditional Khmer Gold Inlaid Rings & Lotus Petal Accents */}
          {/* Upper Gold Belt */}
          <path
            d="M45 62 Q80 70 115 62"
            stroke="url(#goldTrimGrad)"
            strokeWidth="3.5"
            strokeLinecap="round"
            fill="none"
          />
          {/* Upper Motif Dots */}
          <circle cx="80" cy="66" r="2.5" fill="#FEF3C7" />
          <circle cx="62" cy="64" r="2" fill="#FEF3C7" />
          <circle cx="98" cy="64" r="2" fill="#FEF3C7" />

          {/* Middle Decorative Band */}
          <path
            d="M36 88 Q80 98 124 88"
            stroke="url(#goldTrimGrad)"
            strokeWidth="4.5"
            strokeLinecap="round"
            fill="none"
          />
          {/* Traditional Diamond Inlays */}
          <polygon points="80,91 83,94 80,97 77,94" fill="#FEF3C7" />
          <polygon points="60,89 62.5,91.5 60,94 57.5,91.5" fill="#FEF3C7" />
          <polygon points="100,89 102.5,91.5 100,94 97.5,91.5" fill="#FEF3C7" />

          {/* Lower Gold Rim Band */}
          <ellipse
            cx="80"
            cy="122"
            rx="52"
            ry="11"
            fill="url(#goldTrimGrad)"
            stroke="#291409"
            strokeWidth="1.5"
          />
          <ellipse cx="80" cy="120" rx="46" ry="7" fill="#451A03" />
        </g>
      </svg>

      {/* Interactive Helper Badge when ready to shake */}
      {isClickable && (
        <div className="absolute -bottom-2 bg-amber-500 text-stone-950 font-bold text-[11px] px-2.5 py-0.5 rounded-full shadow-lg border border-amber-300 flex items-center gap-1 animate-bounce">
          <Sparkles className="w-3 h-3" />
          <span>{t ? t('action.shake') : 'Shake'}</span>
        </div>
      )}
    </div>
  )
}
export default ShakerCup
