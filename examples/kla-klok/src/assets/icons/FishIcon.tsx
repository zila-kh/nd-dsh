import React from 'react'

interface IconProps extends React.SVGProps<SVGSVGElement> {
  className?: string
  size?: number
}

export const FishIcon: React.FC<IconProps> = ({ className = 'w-12 h-12', size, ...props }) => {
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
        <radialGradient id="fishBodyGrad" cx="35%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="60%" stopColor="#2563EB" />
          <stop offset="100%" stopColor="#1E3A8A" />
        </radialGradient>
        <linearGradient id="fishFinGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7DD3FC" />
          <stop offset="100%" stopColor="#0284C7" />
        </linearGradient>
      </defs>

      {/* Tail Fin */}
      <path
        d="M72 50 C80 32, 92 24, 94 30 C90 42, 84 48, 88 50 C84 52, 90 58, 94 70 C92 76, 80 68, 72 50 Z"
        fill="url(#fishFinGrad)"
        stroke="#1E3A8A"
        strokeWidth="1.5"
      />

      {/* Dorsal (Top) Fin */}
      <path
        d="M38 32 C46 16, 60 18, 64 28 C54 28, 44 30, 38 32 Z"
        fill="url(#fishFinGrad)"
        stroke="#1E3A8A"
        strokeWidth="1.5"
      />

      {/* Ventral (Bottom) Fin */}
      <path
        d="M48 68 C56 80, 66 78, 68 70 C58 70, 52 68, 48 68 Z"
        fill="url(#fishFinGrad)"
        stroke="#1E3A8A"
        strokeWidth="1.5"
      />

      {/* Main Fish Body (Graceful Carp) */}
      <ellipse cx="44" cy="50" rx="32" ry="20" fill="url(#fishBodyGrad)" stroke="#1E3A8A" strokeWidth="2" />

      {/* Fish Scales pattern */}
      <path d="M38 42 C41 45, 41 51, 38 54 M46 38 C49 42, 49 48, 46 52 M46 48 C49 52, 49 58, 46 62 M54 42 C57 46, 57 50, 54 54" stroke="#93C5FD" strokeWidth="1.5" strokeLinecap="round" opacity="0.75" />

      {/* Gill Arc */}
      <path d="M32 36 C36 44, 36 56, 32 64" stroke="#1E3A8A" strokeWidth="2.5" strokeLinecap="round" />

      {/* Pectoral Fin */}
      <path
        d="M36 52 C44 52, 50 58, 46 64 C38 64, 34 58, 36 52 Z"
        fill="#60A5FA"
        stroke="#1D4ED8"
        strokeWidth="1.5"
      />

      {/* Eye */}
      <circle cx="22" cy="46" r="4.5" fill="#FEF08A" stroke="#1E3A8A" strokeWidth="1.5" />
      <circle cx="21" cy="46" r="2.2" fill="#09090B" />
      <circle cx="20" cy="45" r="1" fill="#FFFFFF" />

      {/* Mouth */}
      <path d="M12 50 C15 51, 16 53, 13 54" stroke="#1E3A8A" strokeWidth="2" strokeLinecap="round" />

      {/* Highlight stroke */}
      <path d="M26 36 C36 32, 52 34, 60 40" stroke="#BAE6FD" strokeWidth="2.5" strokeLinecap="round" opacity="0.8" />
    </svg>
  )
}
