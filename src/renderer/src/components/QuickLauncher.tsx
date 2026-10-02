import { Fragment, useRef, useState, type ReactNode } from 'react'
import {
  Building2,
  Camera,
  Check,
  Clipboard,
  FolderOpen,
  ListTodo,
  MessageSquare,
  MonitorUp,
  Puzzle,
  StickyNote,
} from 'lucide-react'
import type { OrganizationSnapshot } from '../../../shared/organization'
import type { NdCommandView } from '../../../shared/nd-invocations'
import type { ContextOption } from '../lib/nd-context-model'
import {
  DEFAULT_LAUNCHER_COMMAND_REGISTRY,
  launcherCommandGroups,
  type LauncherCommandIcon,
  type LauncherCommandItem,
} from '../lib/command-registry'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from './ui/command'

interface Props {
  open: boolean
  onOpenChange(open: boolean): void
  /** The popup owns dismissal after validation or successful execution. */
  closeBeforeRun?: boolean
  organization: OrganizationSnapshot | null
  currentUrl?: string | undefined
  /** Explicit context selector; the popup defaults to Personal, the in-app launcher to the current context. */
  contexts?: ContextOption[]
  activeContextId?: string
  contextLabel?: string
  onSelectContext?(id: string): void
  /** Extension commands available in the selected context. */
  extensionCommands?: NdCommandView[]
  onRunExtensionCommand?(command: NdCommandView, typed: string): void | Promise<void>
  onOpenKanban(): void
  onOpenAgent(): void
  onActivateProject(projectId: string): void | Promise<void>
  onSwitchCompany(companyId: string): void | Promise<void>
  onCreateTask(text: string): void | Promise<void>
  onQuickNote(text: string): void | Promise<void>
  onAskAgent(text: string): void | Promise<void>
  onCaptureScreen(): void | Promise<void>
  onOpenCaptureTools(): void | Promise<void>
  onCaptureClipboard(): void | Promise<void>
  onCaptureUrl(url: string): void | Promise<void>
}

function launcherIcon(command: LauncherCommandItem): ReactNode {
  if (command.sourceId === 'core.context' && command.shortcut === 'Active') return <Check />
  const icons: Record<LauncherCommandIcon, ReactNode> = {
    task: <ListTodo />,
    note: <StickyNote />,
    agent: <MessageSquare />,
    context: <Building2 />,
    kanban: <ListTodo />,
    'capture-screen': <Camera />,
    'capture-tools': <MonitorUp />,
    clipboard: <Clipboard />,
    link: <FolderOpen />,
    extension: <Puzzle />,
    project: <FolderOpen />,
    company: <Building2 />,
  }
  return icons[command.icon]
}

export function QuickLauncher({
  open,
  onOpenChange,
  closeBeforeRun = true,
  organization,
  currentUrl,
  contexts = [],
  activeContextId,
  contextLabel,
  onSelectContext,
  extensionCommands = [],
  onRunExtensionCommand,
  onOpenKanban,
  onOpenAgent,
  onActivateProject,
  onSwitchCompany,
  onCreateTask,
  onQuickNote,
  onAskAgent,
  onCaptureScreen,
  onOpenCaptureTools,
  onCaptureClipboard,
  onCaptureUrl,
}: Props) {
  const [query, setQuery] = useState('')
  const running = useRef(false)
  const companies = organization?.companies ?? []
  const projects = organization?.projects ?? []
  const activeCompany = companies.find((item) => item.id === organization?.activeCompanyId) ?? companies[0]
  const activeProject = projects.find((item) => item.id === organization?.activeProjectId)

  const commands = DEFAULT_LAUNCHER_COMMAND_REGISTRY.list({
    query,
    organization,
    ...(currentUrl ? { currentUrl } : {}),
    contexts,
    ...(activeContextId ? { activeContextId } : {}),
    extensionCommands,
    actions: {
      selectContext: (id) => onSelectContext?.(id),
      openKanban: onOpenKanban,
      openAgent: onOpenAgent,
      activateProject: onActivateProject,
      switchCompany: onSwitchCompany,
      createTask: onCreateTask,
      quickNote: onQuickNote,
      askAgent: onAskAgent,
      captureScreen: onCaptureScreen,
      openCaptureTools: onOpenCaptureTools,
      captureClipboard: onCaptureClipboard,
      captureUrl: onCaptureUrl,
      runExtension: (command, typed) => onRunExtensionCommand?.(command, typed),
    },
  })
  const groups = launcherCommandGroups(commands)

  const closeAndRun = (command: LauncherCommandItem): void => {
    if (command.closeOnRun === false) {
      void Promise.resolve(command.run())
      return
    }
    if (!closeBeforeRun) {
      if (running.current) return
      running.current = true
      void Promise.resolve().then(() => command.run()).finally(() => { running.current = false })
      return
    }
    setQuery('')
    onOpenChange(false)
    void Promise.resolve(command.run())
  }

  const handleOpenChange = (next: boolean): void => {
    if (!next) setQuery('')
    onOpenChange(next)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="ND Quick Launcher"
      description="Search one registry of ND, company, project, and extension commands."
      className="top-[42%] max-w-[680px] rounded-xl border-border-strong bg-surface-1/98 shadow-[0_28px_90px_rgba(0,0,0,0.58)] backdrop-blur-xl"
      showCloseButton={false}
    >
      <CommandInput
        autoFocus
        value={query}
        onValueChange={setQuery}
        placeholder="Search ND or type something to capture…"
      />
      <CommandList className="max-h-[430px]">
        <CommandEmpty>No matching ND command.</CommandEmpty>

        {groups.map((group, index) => (
          <Fragment key={group.group}>
            {index > 0 ? <CommandSeparator /> : null}
            <CommandGroup heading={group.group}>
              {group.items.map((command) => (
                <CommandItem
                  key={`${command.sourceId}:${command.id}`}
                  value={command.searchText}
                  onSelect={() => closeAndRun(command)}
                >
                  {launcherIcon(command)}
                  <span className="min-w-0 flex-1 truncate">{command.title}</span>
                  {command.shortcut ? (
                    <CommandShortcut className={command.id === 'capture-url' ? 'max-w-[230px] truncate normal-case tracking-normal' : undefined}>
                      {command.shortcut}
                    </CommandShortcut>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </Fragment>
        ))}
      </CommandList>

      <div className="flex items-center justify-between gap-3 border-t border-border-soft px-3 py-2 text-[10px] text-faint">
        <span className="truncate">
          {contextLabel ?? (activeCompany?.name ?? 'No company')}{activeProject && !contextLabel ? ` · ${activeProject.name}` : ''}
        </span>
        <span className="shrink-0 font-mono">↑↓ navigate · Enter run · Esc close</span>
      </div>
    </CommandDialog>
  )
}
