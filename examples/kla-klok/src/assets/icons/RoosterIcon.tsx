import React from 'react'

interface IconProps extends React.SVGProps<SVGSVGElement> {
  className?: string
  size?: number
}

export const RoosterIcon: React.FC<IconProps> = ({ className = 'w-12 h-12', size, ...props }) => {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      width={size}
      height={size}
      aria-hidden="true"
      {...props}
    >
      <defs>
        <radialGradient id="roosterBody" cx="40%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#FDE047" />
          <stop offset="60%" stopColor="#EAB308" />
          <stop offset="100%" stopColor="#A16207" />
        </radialGradient>
        <linearGradient id="combGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#EF4444" />
          <stop offset="100%" stopColor="#991B1B" />
        </linearGradient>
        <linearGradient id="tailGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0284C7" />
          <stop offset="50%" stopColor="#16A34A" />
          <stop offset="100%" stopColor="#A16207" />
        </linearGradient>
      </defs>

      {/* Magnificent Tail Feathers */}
      <path d="M62 54 C74 42, 84 28, 86 16 C80 24, 76 34, 68 44" fill="url(#tailGrad)" stroke="#14532D" strokeWidth="1.5" />
      <path d="M64 56 C78 48, 92 40, 94 30 C86 38, 78 48, 68 52" fill="url(#tailGrad)" stroke="#0369A1" strokeWidth="1.5" />
      <path d="M62 60 C80 58, 90 60, 94 54 C84 62, 74 64, 64 64" fill="url(#tailGrad)" stroke="#78350F" strokeWidth="1.5" />

      {/* Legs & Spurs */}
      <path d="M44 72 L44 86 M44 86 L36 90 M44 86 L44 92 M44 86 L50 90" stroke="#CA8A04" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M54 70 L54 84 M54 84 L46 88 M54 84 L54 90 M54 84 L60 88" stroke="#CA8A04" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* Main Body */}
      <ellipse cx="48" cy="58" rx="22" ry="17" fill="url(#roosterBody)" stroke="#78350F" strokeWidth="2" />

      {/* Wing Feathers */}
      <path d="M42 52 C50 48, 60 52, 58 64 C50 68, 42 66, 42 52 Z" fill="#CA8A04" stroke="#854D0E" strokeWidth="1.5" />
      <path d="M46 56 C50 54, 56 56, 54 62" stroke="#FEF08A" strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />

      {/* Neck & Head */}
      <path d="M36 60 C32 48, 30 36, 32 26 C36 24, 44 26, 46 36 C48 46, 46 58, 46 60 Z" fill="url(#roosterBody)" stroke="#78350F" strokeWidth="2" />

      {/* Proud Red Comb on Head */}
      <path
        d="M30 24 C28 14, 34 10, 36 18 C38 12, 44 10, 44 18 C46 12, 50 14, 48 24 Z"
        fill="url(#combGrad)"
        stroke="#7F1D1D"
        strokeWidth="1.5"
      />

      {/* Red Wattle (Chins) */}
      <path d="M26 36 C24 44, 30 46, 32 40 Z" fill="url(#combGrad)" stroke="#7F1D1D" strokeWidth="1.5" />

      {/* Golden Sharp Beak */}
      <path d="M28 30 L16 34 L28 38 Z" fill="#F59E0B" stroke="#B45309" strokeWidth="1.5" strokeLinejoin="round" />

      {/* Eye */}
      <circle cx="34" cy="28" r="3" fill="#FEF08A" stroke="#78350F" strokeWidth="1" />
      <circle cx="33" cy="28" r="1.5" fill="#09090B" />
      <circle cx="32.5" cy="27.5" r="0.6" fill="#FFFFFF" />
    </svg>
  )
}
