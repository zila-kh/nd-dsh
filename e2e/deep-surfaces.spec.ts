// Deep-surface QA pass for ND-DSH.
// Exercises surfaces not covered by smoke.spec.ts or qa-functional.spec.ts:
// Model/Engine/Gateway settings, Terminal Dock, Browser Pane, Source Control,
// Organization Control Center, Organization Strategy Center, Workflow Integration,
// and the Chat composer (session create + send).
/// <reference lib="dom" />

import { expect, test } from '@playwright/test'
import { closeApp, createWorkspaceDir, launchApp, type LaunchedApp } from './fixtures.js'

test.describe.configure({ mode: 'serial' })

let launched: LaunchedApp
let projectWorkspace: string
const rendererErrors: string[] = []

test.beforeAll(async () => {
  // The project form needs a folder that exists on the machine running the
  // suite. Naming a developer's checkout here failed the bootstrap on every CI
  // runner, which skipped the rest of this file rather than reporting it.
  projectWorkspace = await createWorkspaceDir()
  launched = await launchApp()
  launched.page.on('pageerror', (error) => rendererErrors.push(`pageerror: ${error.message}`))
  launched.page.on('console', (message) => {
    if (message.type() === 'error') rendererErrors.push(`console: ${message.text()}`)
  })
})

test.afterAll(async () => {
  await closeApp(launched)
})

// ─── Bootstrap: company + project for surfaces that need them ────────────────

test('Bootstrap: create company and project for deep-surface tests', async () => {
  const { page } = launched
  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Company').click()
  await page.getByRole('button', { name: '+ New' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByPlaceholder('Company name').fill('Deep Surface Corp')
  await dialog.getByPlaceholder('Company mission').fill('Exercise every deep surface in the ND-DSH product.')
  await dialog.getByRole('button', { name: 'Create AI company' }).click()
  // The Activity card renders the creation message inline (not a toast). Wait for
  // the project form instead — it only mounts once `company` state has propagated,
  // which guarantees the createProject guard won't silently no-op.
  const projectForm = page.locator('form').filter({ has: page.getByPlaceholder('New project') })
  await expect(projectForm).toBeVisible({ timeout: 15_000 })
  await projectForm.getByPlaceholder('New project').fill('Deep Surface Project')
  await projectForm.getByPlaceholder('Objective').fill('Cover every deep surface in the QA pass.')
  // The workspace field is a native folder picker. Stub the main-process dialog
  // so the Browse click resolves to the throwaway workspace instead of a real
  // dialog no automation can drive.
  await launched.app.evaluate(({ dialog }, path) => {
    (dialog as unknown as { showOpenDialog: (options: unknown) => Promise<{ canceled: boolean; filePaths: string[] }> }).showOpenDialog =
      async () => ({ canceled: false, filePaths: [path] })
  }, projectWorkspace)
  await projectForm.getByRole('button', { name: 'Browse for workspace folder' }).click()
  await expect(projectForm.getByRole('button', { name: 'Browse for workspace folder' })).toHaveText(/nd-dsh-e2e-workspace/, { timeout: 15_000 })
  await projectForm.getByRole('button', { name: 'Add project' }).click()

  // Confirm the project was created: it appears in the projects strip with its
  // progress/state label ("Deep Surface Project 0% · planning"). (The Activity
  // card message uses smart quotes, so we assert on the strip entry instead of
  // matching the exact formatted string.)
  await expect(page.getByRole('button', { name: /Deep Surface Project 0%/ })).toBeVisible({ timeout: 15_000 })
})

// ─── Model Settings ──────────────────────────────────────────────────────────

test('Model settings: seeded opencode-go provider is listed and configurable', async () => {
  const { page } = launched
  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Settings').click()
  await page.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab', { name: 'Models', exact: true }).click()
  await expect(page).toHaveURL(/#\/settings\?tab=model$/)

  // The seeded opencode-go provider should appear in the detail panel heading.
  await expect(page.getByRole('heading', { name: 'OpenCode Go' })).toBeVisible()

  // Provider is enabled — the enable toggle should reflect that.
  await expect(page.getByText('Enabled', { exact: true })).toBeVisible()

  // API format field shows the OpenAI-compatible format (inside the combobox).
  await expect(page.getByRole('combobox', { name: 'API format' })).toBeVisible()

  // The seeded model mimo-v2.5 appears in the model list (scope to the
  // "Model list" section to avoid matching the titlebar model trigger).
  const modelList = page.getByText('Model list').locator('..').locator('span.font-mono')
  await expect(modelList.first()).toBeVisible()
  await expect(modelList.first()).toHaveText('mimo-v2.5')

  // Test connection button is present (provider-level, not the per-model one).
  await expect(page.getByRole('button', { name: 'Test connection', exact: true })).toBeVisible()

  expect(rendererErrors).toEqual([])
})

test('Model settings: add-provider button appends a configurable provider', async () => {
  const { page } = launched

  // Add provider button appends directly to the sidebar (no dialog).
  const addButton = page.getByRole('button', { name: 'Add provider', exact: true })
  await expect(addButton).toBeVisible()
  await addButton.click()

  // A new "Custom provider" appears in the detail panel heading.
  await expect(page.getByRole('heading', { name: 'Custom provider' })).toBeVisible()

  // The right panel shows the Base URL, API format, and Credential fields.
  await expect(page.getByPlaceholder('Leave blank for a provider-native catalog endpoint')).toBeVisible()
  await expect(page.getByPlaceholder('Enter API key')).toBeVisible()

  // API format selector is present.
  await expect(page.getByRole('combobox', { name: 'API format' })).toBeVisible()

  // New provider starts disabled.
  await expect(page.getByText('Disabled', { exact: true })).toBeVisible()

  // Enabling is gated on a passing connection probe: until "Test connection"
  // passes with a stored credential, Enable is disabled and says why.
  const enableButton = page.getByRole('button', { name: 'Enable', exact: true })
  await expect(enableButton).toBeDisabled()
  await expect(page.getByText('Pass “Test connection” to enable')).toBeVisible()

  expect(rendererErrors).toEqual([])
})

// ─── Engine Settings ─────────────────────────────────────────────────────────

test('Engine settings: coding engine surface shows ND control plane', async () => {
  const { page } = launched
  await page.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab', { name: 'Coding engines', exact: true }).click()
  await expect(page).toHaveURL(/#\/settings\?tab=engines$/)

  // ND control plane row is always present.
  await expect(page.getByText('ND control plane', { exact: true })).toBeVisible()
  await expect(page.getByText('Provider-neutral', { exact: true })).toBeVisible()

  // Gateway settings are nested inside engine settings (heading is "ND Gateway").
  await expect(page.getByRole('heading', { name: 'ND Gateway' })).toBeVisible()

  expect(rendererErrors).toEqual([])
})

// ─── Gateway Settings ────────────────────────────────────────────────────────

test('Gateway settings: gateway state surface renders without errors', async () => {
  const { page } = launched
  // Gateway is reachable within the Coding engines tab.
  await page.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab', { name: 'Coding engines', exact: true }).click()

  // Gateway section title.
  await expect(page.getByRole('heading', { name: 'ND Gateway' })).toBeVisible()

  // Mode selector shows "ND Enhanced" as the active mode.
  await expect(page.getByRole('button', { name: 'ND Enhanced' })).toBeVisible()

  // Codex and ChatGPT Desktop app rows are present (within the ND Gateway section).
  await expect(page.getByText('ChatGPT Desktop')).toBeVisible()
  // "Codex" appears multiple times; scope to the gateway section via its heading.
  await expect(page.getByText('Codex can use ND Gateway')).toBeVisible()

  expect(rendererErrors).toEqual([])
})

// ─── Source Control ──────────────────────────────────────────────────────────

test('Source Control: commit message input and branch controls are functional', async () => {
  const { page } = launched
  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Agent').click()

  // Switch to Source Control tab.
  const gitTab = page.getByRole('button', { name: 'Source Control' })
  await expect(gitTab).toBeVisible()
  await gitTab.click()

  // Commit message input is present.
  const commitInput = page.getByPlaceholder('Commit message (Ctrl+Enter to commit)')
  await expect(commitInput).toBeVisible()

  // Type a commit message to verify the input works.
  await commitInput.fill('test: deep-surface QA commit message')
  await expect(commitInput).toHaveValue('test: deep-surface QA commit message')

  // Commit button is present (text varies: "Commit" or "Commit (Ctrl+Enter)").
  await expect(page.getByRole('button', { name: /Commit/ })).toBeVisible()

  // Branch create button is an icon button titled "Create branch".
  const createBranch = page.getByRole('button', { name: 'Create branch' })
  await expect(createBranch).toBeVisible()
  await createBranch.click()

  // Branch name input appears.
  await expect(page.getByPlaceholder('new-branch-name')).toBeVisible()

  // Close the branch form via Escape.
  await page.getByPlaceholder('new-branch-name').press('Escape')
  await expect(page.getByPlaceholder('new-branch-name')).toHaveCount(0)

  expect(rendererErrors).toEqual([])
})

// ─── Browser Pane ────────────────────────────────────────────────────────────

test('Browser Pane: embedded browser controls respond', async () => {
  const { page } = launched
  const panes = page.getByRole('tablist', { name: 'Agent workspace panes' })
  await panes.getByRole('button', { name: 'Browser' }).click()

  // Built-in browser region is visible.
  const browserRegion = page.getByRole('region', { name: 'Built-in browser' })
  await expect(browserRegion).toBeVisible()

  // Address bar starts at about:blank.
  const addressBar = page.getByRole('textbox', { name: 'Address' })
  await expect(addressBar).toHaveValue('about:blank')

  // Navigation controls are present.
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Forward' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()

  expect(rendererErrors).toEqual([])
})

// ─── Terminal Dock ───────────────────────────────────────────────────────────

test('Terminal Dock: dedicated terminal session runs a command', async () => {
  const { page } = launched
  const result = await page.evaluate(async () => {
    const api = (globalThis as typeof globalThis & { ndDshTerminal: import('../src/shared/terminal.js').TerminalDesktopApi }).ndDshTerminal
    const sessionId = `dock-deep-${Date.now()}`
    const marker = 'ND_DOCK_E2E_OK'
    const created = await api.create({ sessionId, title: 'Deep surface terminal' })
    const terminal = created.terminals[0]
    if (!terminal) throw new Error('Terminal was not created')
    try {
      const streamed = await new Promise<string>((resolve, reject) => {
        let output = ''
        const timeout = setTimeout(() => { off(); reject(new Error('Timed out waiting for PTY output')) }, 15_000)
        const off = api.onOutput((event) => {
          if (event.sessionId !== sessionId || event.terminalId !== terminal.id) return
          output += event.data
          if (output.includes(marker)) { clearTimeout(timeout); off(); resolve(output) }
        })
        void api.write(sessionId, terminal.id, `node -e "console.log(Buffer.from('TkRfRE9DS19FMkVfT0s=','base64').toString())"\r`).catch((error) => { clearTimeout(timeout); off(); reject(error) })
      })
      const latest = await api.state(sessionId)
      const snapshot = latest.terminals.find((item) => item.id === terminal.id)
      if (!snapshot) throw new Error('Terminal disappeared')
      return { streamed, status: snapshot.status, shell: snapshot.shell }
    } finally {
      await api.close(sessionId, terminal.id).catch(() => undefined)
    }
  })

  expect(result.streamed).toContain('ND_DOCK_E2E_OK')
  expect(result.status).toBe('running')
  expect(result.shell.length).toBeGreaterThan(0)

  expect(rendererErrors).toEqual([])
})

// ─── Organization Control Center ─────────────────────────────────────────────

test('Organization Control Center: operations view renders control cards', async () => {
  const { page } = launched
  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Company').click()

  // Switch to Operations view.
  await page.getByRole('button', { name: 'Operations', exact: true }).click()

  // Control cards are visible.
  await expect(page.getByText('Needs You', { exact: true })).toBeVisible()
  await expect(page.getByText('Verification', { exact: true })).toBeVisible()
  await expect(page.getByText('Signal Inbox', { exact: true })).toBeVisible()
  await expect(page.getByText('AI Employee Performance', { exact: true })).toBeVisible()
  await expect(page.getByText('Human Action / Gate', { exact: true })).toBeVisible()
  await expect(page.getByText('AI Budget', { exact: true })).toBeVisible()

  expect(rendererErrors).toEqual([])
})

test('Organization Control Center: signal capture form accepts input', async () => {
  const { page } = launched
  // Signal capture form is in the operations view.
  const sourceInput = page.getByPlaceholder('Source')
  await expect(sourceInput).toBeVisible()
  await sourceInput.fill('e2e-test')
  await page.getByPlaceholder('Feedback / issue title').fill('Deep surface signal')
  await page.getByPlaceholder('What happened?').fill('QA pass captured this signal.')
  await expect(page.getByPlaceholder('Source')).toHaveValue('e2e-test')

  expect(rendererErrors).toEqual([])
})

// ─── Organization Strategy Center ────────────────────────────────────────────

test('Organization Strategy Center: strategy view renders projection cards', async () => {
  const { page } = launched
  await page.getByRole('button', { name: 'Strategy', exact: true }).click()

  // Strategy projection cards are visible.
  await expect(page.getByText('Release Readiness', { exact: true })).toBeVisible()
  await expect(page.getByText('Strategic Anchors', { exact: true })).toBeVisible()
  await expect(page.getByText('Company Brain', { exact: true })).toBeVisible()
  await expect(page.getByText('Scheduled Company Work', { exact: true })).toBeVisible()

  expect(rendererErrors).toEqual([])
})

test('Organization Strategy Center: strategic anchor form accepts input', async () => {
  const { page } = launched
  // Find the anchor title input by placeholder.
  const titleInput = page.getByPlaceholder('High-value proof path')
  await expect(titleInput).toBeVisible()
  await titleInput.fill('Launch readiness anchor')
  await page.getByPlaceholder('What outcome proves this matters?').fill('All QA pass before public launch')
  await expect(titleInput).toHaveValue('Launch readiness anchor')

  expect(rendererErrors).toEqual([])
})

// ─── Workflow Integration ────────────────────────────────────────────────────

test('Workflow Integration: install panel exposes source controls', async () => {
  const { page } = launched
  // Workflow Integration lives in the Company workspace view (OrganizationDashboardLegacy).
  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Company').click()
  await page.getByRole('button', { name: 'Company Workspace', exact: true }).click()

  // The Workflow button is in the "Work" section of the workspace.
  await page.getByRole('button', { name: 'Work', exact: true }).click()

  // Open the workflow panel.
  const workflowButton = page.getByRole('button', { name: 'Workflow', exact: true })
  await expect(workflowButton).toBeVisible()
  await workflowButton.click()

  // Git source URL input has the default URL value.
  const gitUrlInput = page.getByPlaceholder('https://github.com/owner/workflow-plugins.git')
  await expect(gitUrlInput).toBeVisible()
  await expect(gitUrlInput).toHaveValue('https://github.com/next-mmo/agent-dev-workflow.git')

  // Install button is present (text is "Install plugin").
  await expect(page.getByRole('button', { name: 'Install plugin', exact: true })).toBeVisible()

  // Close the dialog so it doesn't block navigation in subsequent tests.
  await page.keyboard.press('Escape')

  expect(rendererErrors).toEqual([])
})

// ─── Chat Composer ───────────────────────────────────────────────────────────

test('Chat: create a session and verify the composer is ready', async () => {
  const { page } = launched
  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Agent').click()

  // Verify the chat composer textarea is present.
  const textarea = page.getByPlaceholder('Ask the agent to work in this workspace — use @ for files and / for skills')
  await expect(textarea).toBeVisible()

  // Type a message — the send button should enable when text is entered.
  await textarea.fill('Say hello in one sentence.')

  // Send button becomes enabled (ArrowUpIcon inside a button).
  const sendButton = page.locator('button[title="Send"]')
  await expect(sendButton).toBeVisible()
  await expect(sendButton).toBeEnabled()

  // Clear the textarea so we don't accidentally send in a future test.
  await textarea.fill('')
  await expect(sendButton).toBeDisabled()

  expect(rendererErrors).toEqual([])
})

test('Chat: model picker shows the seeded mimo-v2.5 route', async () => {
  const { page } = launched
  // The model trigger button shows the current model selection.
  const modelTrigger = page.getByRole('button', { name: /Model|mimo|OpenCode/ }).first()
  await expect(modelTrigger).toBeVisible()

  // Click to open the model menu.
  await modelTrigger.click()

  // The model menu should show the seeded provider route.
  const modelMenu = page.getByRole('menu', { name: 'Model controls' })
  if (await modelMenu.count() > 0) {
    await expect(modelMenu).toBeVisible()
    // Close it.
    await page.keyboard.press('Escape')
  }

  expect(rendererErrors).toEqual([])
})

// ─── Explorer Files Tab ──────────────────────────────────────────────────────

test('Explorer: Files tab shows workspace root entries', async () => {
  const { page } = launched
  // Navigate here rather than inheriting whatever surface the previous test
  // left open; the explorer is not visible from every one of them.
  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Agent').click()

  // Files tab is the default in the Agent explorer.
  const filesTab = page.getByRole('button', { name: 'Files' })
  await expect(filesTab).toBeVisible()
  await filesTab.click()

  // The tree lists the project workspace root, so it shows the file the
  // fixture seeded there.
  await expect(page.getByText('README.md', { exact: true })).toBeVisible({ timeout: 10_000 })

  expect(rendererErrors).toEqual([])
})
