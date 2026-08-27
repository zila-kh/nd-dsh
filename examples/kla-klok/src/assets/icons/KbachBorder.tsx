import React from 'react'

interface KbachBorderProps {
  className?: string
}

export const KbachBorder: React.FC<KbachBorderProps> = ({ className = 'w-full h-4 text-amber-500/40' }) => {
  return (
    <div className={`overflow-hidden flex items-center justify-center ${className}`} aria-hidden="true">
      <svg
        viewBox="0 0 400 24"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full max-w-2xl"
      >
        <path d="M0 12 Q25 4 50 12 T100 12 T150 12 T200 12 T250 12 T300 12 T350 12 T400 12" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M0 12 Q25 20 50 12 T100 12 T150 12 T200 12 T250 12 T300 12 T350 12 T400 12" stroke="currentColor" strokeWidth="1.5" fill="none" />
        {[50, 150, 250, 350].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy="12" r="3" fill="currentColor" />
            <circle cx={cx - 50} cy="12" r="2" fill="currentColor" opacity="0.6" />
          </g>
        ))}
      </svg>
    </div>
  )
}
