import React from 'react'

interface IconProps extends React.SVGProps<SVGSVGElement> {
  className?: string
  size?: number
}

export const GourdIcon: React.FC<IconProps> = ({ className = 'w-12 h-12', size, ...props }) => {
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
        <radialGradient id="gourdUpper" cx="40%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#4ADE80" />
          <stop offset="60%" stopColor="#16A34A" />
          <stop offset="100%" stopColor="#14532D" />
        </radialGradient>
        <radialGradient id="gourdLower" cx="40%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#86EFAC" />
          <stop offset="50%" stopColor="#22C55E" />
          <stop offset="100%" stopColor="#15803D" />
        </radialGradient>
        <linearGradient id="ribbonGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#EF4444" />
          <stop offset="100%" stopColor="#991B1B" />
        </linearGradient>
      </defs>

      {/* Stem & Top Leaf */}
      <path d="M50 14 C48 8, 54 4, 58 6 C56 10, 52 12, 50 16" stroke="#15803D" strokeWidth="4" strokeLinecap="round" />
      <ellipse cx="43" cy="12" rx="6" ry="3" transform="rotate(-30 43 12)" fill="#86EFAC" stroke="#14532D" strokeWidth="1" />

      {/* Lower Gourd Bulb */}
      <ellipse cx="50" cy="65" rx="30" ry="24" fill="url(#gourdLower)" stroke="#14532D" strokeWidth="2.5" />
      
      {/* Upper Gourd Bulb */}
      <ellipse cx="50" cy="35" rx="20" ry="17" fill="url(#gourdUpper)" stroke="#14532D" strokeWidth="2.5" />

      {/* Highlights */}
      <path d="M36 28 A12 10 0 0 1 45 22" stroke="#DCFCE7" strokeWidth="3" strokeLinecap="round" opacity="0.8" />
      <path d="M30 58 A22 17 0 0 1 42 48" stroke="#DCFCE7" strokeWidth="3.5" strokeLinecap="round" opacity="0.8" />

      {/* Red Lucky Festive Ribbon & Knot */}
      <rect x="36" y="44" width="28" height="7" rx="3.5" fill="url(#ribbonGrad)" stroke="#7F1D1D" strokeWidth="1.5" />
      <circle cx="50" cy="47.5" r="4.5" fill="#FBBF24" stroke="#B45309" strokeWidth="1.5" />
      
      {/* Hanging Ribbons */}
      <path d="M47 50 Q42 62 38 68 M53 50 Q58 62 62 68" stroke="#EF4444" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
