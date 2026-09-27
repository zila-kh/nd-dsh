import { useMemo, useState } from 'react'
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
import type { NdContext } from '../../../shared/nd-context'
import type { NdCommandView } from '../../../shared/nd-invocations'
import { commandSearchText, type ContextOption } from '../lib/nd-context-model'
import { compactLauncherText, recentLauncherProjects } from '../lib/quick-launcher-model'
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

export function QuickLauncher({
  open,
  onOpenChange,
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
  const companies = organization?.companies ?? []
  const projects = organization?.projects ?? []
  const activeCompany = companies.find((item) => item.id === organization?.activeCompanyId) ?? companies[0]
  const activeProject = projects.find((item) => item.id === organization?.activeProjectId)
  const recentProjects = useMemo(() => recentLauncherProjects(projects), [projects])
  const text = query.trim()

  const closeAndRun = (action: () => void | Promise<void>): void => {
    setQuery('')
    onOpenChange(false)
    void Promise.resolve(action())
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
      description="Jump to daily ND actions, projects, companies, and external capture."
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
        <CommandEmpty>No matching ND action.</CommandEmpty>

        {text ? (
          <CommandGroup heading="Use what you typed">
            <CommandItem
              value={`task ${text}`}
              onSelect={() => closeAndRun(() => onCreateTask(text))}
            >
              <ListTodo />
              <span className="min-w-0 flex-1 truncate">Create task · {compactLauncherText(text)}</span>
              <CommandShortcut>Task</CommandShortcut>
            </CommandItem>
            <CommandItem
              value={`note ${text}`}
              onSelect={() => closeAndRun(() => onQuickNote(text))}
            >
              <StickyNote />
              <span className="min-w-0 flex-1 truncate">Quick note · {compactLauncherText(text)}</span>
              <CommandShortcut>Note</CommandShortcut>
            </CommandItem>
            <CommandItem
              value={`ask agent ${text}`}
              onSelect={() => closeAndRun(() => onAskAgent(text))}
            >
              <MessageSquare />
              <span className="min-w-0 flex-1 truncate">Ask agent · {compactLauncherText(text)}</span>
              <CommandShortcut>Agent</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        ) : null}

        {contexts.length > 0 ? (
          <CommandGroup heading="Context">
            {contexts.map((option) => (
              <CommandItem
                key={option.id}
                value={`context ${option.label} ${option.detail}`}
                onSelect={() => onSelectContext?.(option.id)}
              >
                {option.id === activeContextId ? <Check /> : <Building2 />}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <CommandShortcut>{option.id === activeContextId ? 'Active' : option.detail}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        <CommandGroup heading="Quick actions">
          <CommandItem value="open kanban work board tasks" onSelect={() => closeAndRun(onOpenKanban)}>
            <ListTodo />
            <span>Open Kanban</span>
            <CommandShortcut>Board</CommandShortcut>
          </CommandItem>
          <CommandItem value="ask agent chat workbench" onSelect={() => closeAndRun(onOpenAgent)}>
            <MessageSquare />
            <span>Ask Agent</span>
            <CommandShortcut>Agent</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Capture">
          <CommandItem value="capture external screen screenshot" onSelect={() => closeAndRun(onCaptureScreen)}>
            <Camera />
            <span>Capture External Screen</span>
            <CommandShortcut>3s</CommandShortcut>
          </CommandItem>
          <CommandItem value="external capture tools area annotate inspect" onSelect={() => closeAndRun(onOpenCaptureTools)}>
            <MonitorUp />
            <span>External Capture Tools</span>
            <CommandShortcut>Area · Annotate</CommandShortcut>
          </CommandItem>
          <CommandItem value="capture clipboard text paste" onSelect={() => closeAndRun(onCaptureClipboard)}>
            <Clipboard />
            <span>Capture Clipboard</span>
          </CommandItem>
          {currentUrl ? (
            <CommandItem value={`capture current url link ${currentUrl}`} onSelect={() => closeAndRun(() => onCaptureUrl(currentUrl))}>
              <FolderOpen />
              <span className="min-w-0 flex-1 truncate">Capture Current URL</span>
              <CommandShortcut className="max-w-[230px] truncate normal-case tracking-normal">{currentUrl}</CommandShortcut>
            </CommandItem>
          ) : null}
        </CommandGroup>

        {extensionCommands.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Extensions">
              {extensionCommands.map((command) => (
                <CommandItem
                  key={`${command.extensionId}:${command.contributionId}`}
                  value={`extension ${commandSearchText(command)}`}
                  onSelect={() => closeAndRun(() => onRunExtensionCommand?.(command, text))}
                >
                  <Puzzle />
                  <span className="min-w-0 flex-1 truncate">{command.title}</span>
                  <CommandShortcut>{command.extensionId.replace(/^nd\./, '')}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {recentProjects.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent projects">
              {recentProjects.map((project) => {
                const company = companies.find((item) => item.id === project.companyId)
                return (
                  <CommandItem
                    key={project.id}
                    value={`project ${project.name} ${company?.name ?? ''} ${project.objective}`}
                    onSelect={() => closeAndRun(() => onActivateProject(project.id))}
                  >
                    <FolderOpen />
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    <CommandShortcut>{company?.name ?? 'Project'}</CommandShortcut>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </>
        ) : null}

        {companies.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Companies">
              {companies.map((company) => (
                <CommandItem
                  key={company.id}
                  value={`company ${company.name} ${company.mission}`}
                  onSelect={() => closeAndRun(() => onSwitchCompany(company.id))}
                >
                  <Building2 />
                  <span className="min-w-0 flex-1 truncate">{company.name}</span>
                  <CommandShortcut>{company.id === activeCompany?.id ? 'Active' : 'Switch'}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
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
