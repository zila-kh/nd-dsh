import React from 'react'

interface IconProps extends React.SVGProps<SVGSVGElement> {
  className?: string
  size?: number
}

export const TigerIcon: React.FC<IconProps> = ({ className = 'w-12 h-12', size, ...props }) => {
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
        <radialGradient id="tigerGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FB923C" />
          <stop offset="70%" stopColor="#EA580C" />
          <stop offset="100%" stopColor="#C2410C" />
        </radialGradient>
        <linearGradient id="tigerEar" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#EA580C" />
          <stop offset="100%" stopColor="#7C2D12" />
        </linearGradient>
      </defs>

      {/* Ears */}
      <path d="M22 34 C16 18, 30 14, 38 24 Z" fill="url(#tigerEar)" stroke="#431407" strokeWidth="2" />
      <path d="M25 31 C20 22, 28 20, 33 26 Z" fill="#FDE047" opacity="0.8" />
      <path d="M78 34 C84 18, 70 14, 62 24 Z" fill="url(#tigerEar)" stroke="#431407" strokeWidth="2" />
      <path d="M75 31 C80 22, 72 20, 67 26 Z" fill="#FDE047" opacity="0.8" />

      {/* Head Base */}
      <ellipse cx="50" cy="54" rx="36" ry="32" fill="url(#tigerGlow)" stroke="#431407" strokeWidth="2" />

      {/* Forehead Khmer Crown / Stripes (Royal King Motif) */}
      <path d="M50 24 L50 40 M42 27 L50 35 L58 27 M38 35 L50 43 L62 35" stroke="#18181B" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* Cheek Stripes */}
      <path d="M18 52 L32 50 M16 60 L30 57 M82 52 L68 50 M84 60 L70 57" stroke="#18181B" strokeWidth="3.5" strokeLinecap="round" />

      {/* White Muzzle & Cheeks */}
      <ellipse cx="40" cy="67" rx="13" ry="11" fill="#FEF3C7" />
      <ellipse cx="60" cy="67" rx="13" ry="11" fill="#FEF3C7" />
      <ellipse cx="50" cy="74" rx="8" ry="6" fill="#FDE68A" />

      {/* Eyes */}
      <ellipse cx="36" cy="48" rx="7" ry="5.5" fill="#FEF08A" stroke="#18181B" strokeWidth="1.5" />
      <ellipse cx="37" cy="48" rx="2.5" ry="4" fill="#09090B" />
      <circle cx="38" cy="46.5" r="1" fill="#FFFFFF" />

      <ellipse cx="64" cy="48" rx="7" ry="5.5" fill="#FEF08A" stroke="#18181B" strokeWidth="1.5" />
      <ellipse cx="63" cy="48" rx="2.5" ry="4" fill="#09090B" />
      <circle cx="64" cy="46.5" r="1" fill="#FFFFFF" />

      {/* Nose */}
      <path d="M44 60 L56 60 L50 67 Z" fill="#DC2626" stroke="#450A0A" strokeWidth="1.5" strokeLinejoin="round" />

      {/* Mouth & Whiskers */}
      <path d="M50 67 L50 71 M44 71 C47 74, 50 74, 50 71 C50 74, 53 74, 56 71" stroke="#18181B" strokeWidth="2" strokeLinecap="round" />
      <circle cx="43" cy="68" r="1" fill="#18181B" />
      <circle cx="40" cy="70" r="1" fill="#18181B" />
      <circle cx="57" cy="68" r="1" fill="#18181B" />
      <circle cx="60" cy="70" r="1" fill="#18181B" />
    </svg>
  )
}
