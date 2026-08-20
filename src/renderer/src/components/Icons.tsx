import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function IconBase({ children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  )
}

export const FilesIcon = (props: IconProps) => (
  <IconBase {...props}><path d="M6 2.75h8l4 4v14.5H6z" /><path d="M14 2.75v4h4" /><path d="M3 6.5v14.75h11" /></IconBase>
)
export const BrowserIcon = (props: IconProps) => (
  <IconBase {...props}><rect x="2.75" y="4" width="18.5" height="16" rx="2" /><path d="M2.75 8.25h18.5" /><path d="M6 6.15h.01M9 6.15h.01" /></IconBase>
)
export const ChatIcon = (props: IconProps) => (
  <IconBase {...props}><path d="M4 4h16v12H8l-4 4z" /><path d="M8 8h8M8 12h5" /></IconBase>
)
export const GitIcon = (props: IconProps) => (
  <IconBase {...props}><circle cx="6" cy="5" r="2" /><circle cx="18" cy="19" r="2" /><circle cx="6" cy="19" r="2" /><path d="M6 7v10M8 6.5c5 0 8 2 8 6.5v4" /></IconBase>
)
export const SettingsIcon = (props: IconProps) => (
  <IconBase {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .35 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.55 19.4a1.7 1.7 0 0 0-1.88.35l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.2 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.4v-4h.1A1.7 1.7 0 0 0 4.2 8.55a1.7 1.7 0 0 0-.35-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.55 4.2a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.4h4v.1A1.7 1.7 0 0 0 15 4.2a1.7 1.7 0 0 0 1.88-.35l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.55a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1A1.7 1.7 0 0 0 19.4 15z" /></IconBase>
)
export const ChevronRightIcon = (props: IconProps) => <IconBase {...props}><path d="m9 18 6-6-6-6" /></IconBase>
export const ChevronDownIcon = (props: IconProps) => <IconBase {...props}><path d="m6 9 6 6 6-6" /></IconBase>
export const FolderIcon = (props: IconProps) => <IconBase {...props}><path d="M3 5h7l2 2h9v12H3z" /></IconBase>
export const FileIcon = (props: IconProps) => <IconBase {...props}><path d="M6 2.75h8l4 4v14.5H6z" /><path d="M14 2.75v4h4" /></IconBase>
export const ArrowLeftIcon = (props: IconProps) => <IconBase {...props}><path d="m15 18-6-6 6-6" /></IconBase>
export const ArrowRightIcon = (props: IconProps) => <IconBase {...props}><path d="m9 18 6-6-6-6" /></IconBase>
export const ReloadIcon = (props: IconProps) => <IconBase {...props}><path d="M20 11a8 8 0 1 0-2.34 5.66" /><path d="M20 4v7h-7" /></IconBase>
export const CameraIcon = (props: IconProps) => <IconBase {...props}><path d="M4 7h3l1.5-2h7L17 7h3v12H4z" /><circle cx="12" cy="13" r="3.5" /></IconBase>
export const SendIcon = (props: IconProps) => <IconBase {...props}><path d="m21 3-7.5 18-3.3-7.2L3 10.5z" /><path d="M10.2 13.8 21 3" /></IconBase>
export const StopIcon = (props: IconProps) => <IconBase {...props}><rect x="6" y="6" width="12" height="12" rx="1" /></IconBase>
export const SparkIcon = (props: IconProps) => <IconBase {...props}><path d="m12 2 1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5z" /><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7z" /></IconBase>
export const CloseIcon = (props: IconProps) => <IconBase {...props}><path d="m7 7 10 10M17 7 7 17" /></IconBase>
export const ExternalIcon = (props: IconProps) => <IconBase {...props}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v7H4V6h7" /></IconBase>
