import React from 'react'

interface IconProps extends React.SVGProps<SVGSVGElement> {
  className?: string
  size?: number
}

export const ShrimpIcon: React.FC<IconProps> = ({ className = 'w-12 h-12', size, ...props }) => {
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
        <radialGradient id="shrimpGrad" cx="40%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#F87171" />
          <stop offset="60%" stopColor="#EF4444" />
          <stop offset="100%" stopColor="#991B1B" />
        </radialGradient>
      </defs>

      {/* Long Antennae */}
      <path d="M68 28 C78 14, 88 18, 92 12" stroke="#FCA5A5" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M66 32 C82 24, 90 32, 94 26" stroke="#F87171" strokeWidth="2" strokeLinecap="round" />

      {/* Large Claws (Freshwater River Prawn Claws) */}
      <path d="M62 42 C72 38, 80 44, 84 38 M84 38 L88 34 M84 38 L87 42" stroke="#EF4444" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M58 48 C70 48, 76 56, 82 52 M82 52 L86 48 M82 52 L85 56" stroke="#DC2626" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

      {/* Tail Fan */}
      <path d="M22 68 C16 72, 10 68, 12 60 C18 62, 22 65, 22 68 Z" fill="#F87171" stroke="#991B1B" strokeWidth="1.5" />
      <path d="M22 72 C14 78, 12 86, 20 84 C22 78, 22 74, 22 72 Z" fill="#EF4444" stroke="#991B1B" strokeWidth="1.5" />
      <path d="M25 74 C20 84, 28 88, 32 82 C30 78, 27 75, 25 74 Z" fill="#DC2626" stroke="#991B1B" strokeWidth="1.5" />

      {/* Segmented Curved Body */}
      {/* Segment 1: Head / Carapace */}
      <path d="M46 32 C58 24, 70 30, 68 44 C60 48, 48 44, 46 32 Z" fill="url(#shrimpGrad)" stroke="#7F1D1D" strokeWidth="2" />
      
      {/* Eye */}
      <circle cx="62" cy="34" r="3" fill="#09090B" />
      <circle cx="63" cy="33" r="1" fill="#FFFFFF" />

      {/* Segment 2 */}
      <path d="M38 42 C48 34, 56 36, 52 50 C44 54, 38 48, 38 42 Z" fill="url(#shrimpGrad)" stroke="#7F1D1D" strokeWidth="2" />
      
      {/* Segment 3 */}
      <path d="M30 52 C40 44, 46 48, 42 60 C34 62, 30 58, 30 52 Z" fill="url(#shrimpGrad)" stroke="#7F1D1D" strokeWidth="2" />

      {/* Segment 4 */}
      <path d="M24 62 C32 56, 38 58, 34 68 C28 70, 24 66, 24 62 Z" fill="url(#shrimpGrad)" stroke="#7F1D1D" strokeWidth="2" />

      {/* Swimming Legs (Pleopods) */}
      <path d="M48 48 C46 56, 42 60, 38 64 M40 56 C38 64, 34 66, 30 70" stroke="#F87171" strokeWidth="2" strokeLinecap="round" />

      {/* Highlight curve */}
      <path d="M42 36 Q54 30 64 36" stroke="#FECDD3" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
    </svg>
  )
}
