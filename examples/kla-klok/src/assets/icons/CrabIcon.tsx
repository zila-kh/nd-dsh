import React from 'react'

interface IconProps extends React.SVGProps<SVGSVGElement> {
  className?: string
  size?: number
}

export const CrabIcon: React.FC<IconProps> = ({ className = 'w-12 h-12', size, ...props }) => {
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
        <radialGradient id="crabBodyGrad" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#EF4444" />
          <stop offset="65%" stopColor="#DC2626" />
          <stop offset="100%" stopColor="#991B1B" />
        </radialGradient>
        <radialGradient id="clawGrad" cx="40%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#F87171" />
          <stop offset="70%" stopColor="#DC2626" />
          <stop offset="100%" stopColor="#7F1D1D" />
        </radialGradient>
      </defs>

      {/* Walking Legs (4 on each side = 8 total) */}
      {/* Left Legs */}
      <path d="M28 50 C18 42, 10 46, 6 52" stroke="#B91C1C" strokeWidth="3" strokeLinecap="round" />
      <path d="M26 56 C14 52, 8 60, 4 66" stroke="#B91C1C" strokeWidth="3" strokeLinecap="round" />
      <path d="M28 64 C16 62, 10 72, 8 80" stroke="#B91C1C" strokeWidth="3" strokeLinecap="round" />
      <path d="M32 72 C22 74, 16 82, 16 88" stroke="#B91C1C" strokeWidth="2.5" strokeLinecap="round" />

      {/* Right Legs */}
      <path d="M72 50 C82 42, 90 46, 94 52" stroke="#B91C1C" strokeWidth="3" strokeLinecap="round" />
      <path d="M74 56 C86 52, 92 60, 96 66" stroke="#B91C1C" strokeWidth="3" strokeLinecap="round" />
      <path d="M72 64 C84 62, 90 72, 92 80" stroke="#B91C1C" strokeWidth="3" strokeLinecap="round" />
      <path d="M68 72 C78 74, 84 82, 84 88" stroke="#B91C1C" strokeWidth="2.5" strokeLinecap="round" />

      {/* Left Claw Arm & Pincer */}
      <path d="M34 44 C22 36, 18 24, 26 16" stroke="#991B1B" strokeWidth="4" strokeLinecap="round" />
      <path
        d="M26 16 C16 10, 10 24, 16 32 C20 36, 26 32, 26 24 C28 24, 30 20, 26 16 Z"
        fill="url(#clawGrad)"
        stroke="#7F1D1D"
        strokeWidth="1.5"
      />
      <path d="M16 22 C22 22, 24 16, 24 12" stroke="#FCA5A5" strokeWidth="2" strokeLinecap="round" />

      {/* Right Claw Arm & Pincer */}
      <path d="M66 44 C78 36, 82 24, 74 16" stroke="#991B1B" strokeWidth="4" strokeLinecap="round" />
      <path
        d="M74 16 C84 10, 90 24, 84 32 C80 36, 74 32, 74 24 C72 24, 70 20, 74 16 Z"
        fill="url(#clawGrad)"
        stroke="#7F1D1D"
        strokeWidth="1.5"
      />
      <path d="M84 22 C78 22, 76 16, 76 12" stroke="#FCA5A5" strokeWidth="2" strokeLinecap="round" />

      {/* Main Crab Carapace Shell */}
      <ellipse cx="50" cy="58" rx="28" ry="22" fill="url(#crabBodyGrad)" stroke="#7F1D1D" strokeWidth="2.5" />

      {/* Shell Grooves & Khmer Mud Crab Texture */}
      <path d="M34 50 C44 46, 56 46, 66 50 M32 60 C42 56, 58 56, 68 60 M38 68 C46 66, 54 66, 62 68" stroke="#7F1D1D" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      
      {/* Shell Highlights */}
      <path d="M32 46 C42 42, 58 42, 68 46" stroke="#FECDD3" strokeWidth="2" strokeLinecap="round" opacity="0.75" />

      {/* Stalk Eyes */}
      <circle cx="42" cy="40" r="4.5" fill="#FEF08A" stroke="#7F1D1D" strokeWidth="1.5" />
      <circle cx="42" cy="39" r="2" fill="#09090B" />
      <circle cx="43" cy="38.5" r="0.8" fill="#FFFFFF" />

      <circle cx="58" cy="40" r="4.5" fill="#FEF08A" stroke="#7F1D1D" strokeWidth="1.5" />
      <circle cx="58" cy="39" r="2" fill="#09090B" />
      <circle cx="59" cy="38.5" r="0.8" fill="#FFFFFF" />
    </svg>
  )
}
