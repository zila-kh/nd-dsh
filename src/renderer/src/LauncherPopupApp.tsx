import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { ThemeState } from '../../shared/contracts'
import type { OrganizationSnapshot } from '../../shared/organization'
import { QuickLauncher } from './components/QuickLauncher'
import { Toaster } from './components/ui/sonner'
import { buildLauncherMemoryMutation, buildLauncherTaskMutation } from './lib/quick-launcher-model'
import { errorMessage } from './lib/qa'

/**
 * The launcher popup surface: a dedicated sandboxed renderer (frameless
 * window at #/launcher) that draws only the quick launcher card floating over
 * the user's current app. It deliberately never runs the full product shell,
 * so it only touches channels admitted for this surface — the organization
 * bridge, the theme read, and the launcher popup controls. Everything that
 * needs chat state, the embedded browser, or capture flows hands off to the
 * full window: main hides the popup, focuses it, and forwards the target.
 */
export default function LauncherPopupApp(): React.ReactNode {
  const [orgState, setOrgState] = useState<OrganizationSnapshot | null>(null)
  const [theme, setTheme] = useState<ThemeState | null>(null)

  useEffect(() => {
    let mounted = true
    void window.ndDshOrganization.state()
      .then((next) => { if (mounted) setOrgState(next) })
      .catch((cause) => toast(errorMessage(cause), { duration: 5000 }))
    const offOrganization = window.ndDshOrganization.onChanged((next) => {
      if (mounted) setOrgState(next)
    })
    void window.ndDsh.theme?.state()
      .then((next) => { if (mounted) setTheme(next) })
      .catch(() => undefined)
    const offTheme = window.ndDsh.theme?.onChanged(setTheme)
    return () => {
      mounted = false
      offOrganization()
      offTheme?.()
    }
  }, [])

  useEffect(() => {
    if (!theme) return
    document.documentElement.dataset.theme = theme.effective
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme.effective)
  }, [theme])

  const notify = (message: string): void => {
    toast(message, { duration: 5000 })
  }

  const company = orgState?.companies.find((item) => item.id === orgState.activeCompanyId) ?? orgState?.companies[0] ?? null
  const companyProjects = orgState && company ? orgState.projects.filter((item) => item.companyId === company.id) : []
  const project = companyProjects.find((item) => item.id === orgState?.activeProjectId) ?? companyProjects[0] ?? null

  const hidePopup = (): void => void window.ndDsh.window?.hideLauncherPopup?.()

  const createTask = async (text: string): Promise<void> => {
    if (!company || !project) {
      notify('Choose a company and project before creating a task.')
      return
    }
    try {
      await window.ndDshOrganization.mutate(buildLauncherTaskMutation(company.id, project.id, text))
      hidePopup()
      toast('Task created from ND Quick Launcher.')
    } catch (cause) {
      notify(errorMessage(cause))
    }
  }

  const quickNote = async (text: string, tags: string[] = ['launcher', 'manual']): Promise<void> => {
    if (!company) {
      notify('Choose a company before saving a note.')
      return
    }
    try {
      await window.ndDshOrganization.mutate(buildLauncherMemoryMutation(company.id, project?.id, text, tags))
      hidePopup()
      toast(project ? `Note saved to ${project.name}.` : `Note saved to ${company.name}.`)
    } catch (cause) {
      notify(errorMessage(cause))
    }
  }

  const activateProject = async (projectId: string): Promise<void> => {
    const target = orgState?.projects.find((item) => item.id === projectId)
    if (!target) return
    try {
      if (target.companyId !== orgState?.activeCompanyId) {
        await window.ndDshOrganization.mutate({ type: 'company.activate', id: target.companyId })
      }
      await window.ndDshOrganization.mutate({ type: 'project.activate', id: projectId })
      hidePopup()
    } catch (cause) {
      notify(errorMessage(cause))
    }
  }

  const switchCompany = async (companyId: string): Promise<void> => {
    try {
      await window.ndDshOrganization.mutate({ type: 'company.activate', id: companyId })
      hidePopup()
    } catch (cause) {
      notify(errorMessage(cause))
    }
  }

  const captureClipboard = async (): Promise<void> => {
    try {
      const text = (await navigator.clipboard.readText()).trim()
      if (!text) {
        notify('Clipboard does not contain text to capture.')
        return
      }
      await quickNote(text, ['capture', 'clipboard'])
    } catch (cause) {
      notify(errorMessage(cause))
    }
  }

  return (
    <div className="launcher-popup-mode h-screen w-screen overflow-hidden bg-transparent p-2 font-sans">
      <QuickLauncher
        open
        onOpenChange={hidePopup}
        organization={orgState}
        onOpenKanban={() => void window.ndDsh.window?.handoffLauncherPopup?.('kanban')}
        onOpenAgent={() => void window.ndDsh.window?.handoffLauncherPopup?.('agent')}
        onActivateProject={(projectId) => void activateProject(projectId)}
        onSwitchCompany={(companyId) => void switchCompany(companyId)}
        onCreateTask={(text) => void createTask(text)}
        onQuickNote={(text) => void quickNote(text)}
        onAskAgent={(text) => void window.ndDsh.window?.handoffLauncherPopup?.('agent', text)}
        onCaptureScreen={() => void window.ndDsh.window?.handoffLauncherPopup?.('capture-screen')}
        onOpenCaptureTools={() => void window.ndDsh.window?.handoffLauncherPopup?.('capture-tools')}
        onCaptureClipboard={() => void captureClipboard()}
        onCaptureUrl={(url) => void quickNote(url, ['capture', 'url'])}
      />
      <Toaster position="bottom-right" duration={5000} />
    </div>
  )
}
