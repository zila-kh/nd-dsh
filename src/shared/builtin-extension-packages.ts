/**
 * ND-maintained proving packages go through the same manifest validation,
 * snapshot, activation, and invocation path as third-party packages. Daily
 * Essentials proves personal daily use, Wallpaper Manager proves a governed
 * native OS capability, and Project Workflow proves project-scoped use.
 */

import { ND_EXTENSION_API_VERSION, ND_EXTENSION_PROTOCOL, type NdExtensionManifest } from './extension-package.js'

export const DAILY_ESSENTIALS_ID = 'nd.daily-essentials'
export const PROJECT_WORKFLOW_ID = 'nd.project-workflow'
export const WALLPAPER_MANAGER_ID = 'nd.wallpaper-manager'

export const DAILY_ESSENTIALS_MANIFEST: NdExtensionManifest = {
  protocol: ND_EXTENSION_PROTOCOL,
  id: DAILY_ESSENTIALS_ID,
  name: 'Daily Essentials',
  description: 'Notes, screen capture, web, and app actions for everyday use — in any context, including Personal with no company yet.',
  version: '1.0.0',
  apiVersion: ND_EXTENSION_API_VERSION,
  contexts: ['personal', 'company', 'project'],
  permissions: [
    'notes.read',
    'notes.write',
    'capture.screen',
    'capture.area',
    'capture.read',
    'clipboard.read',
    'browser.navigate',
    'browser.openExternal',
    'os.launch',
    'chat.start',
  ],
  settings: [
    {
      key: 'searchPrefix',
      title: 'Web search prefix',
      type: 'string',
      default: 'https://www.google.com/search?q=',
      description: 'Where “Search the web” sends the query. Personal and company contexts may override this default.',
    },
  ],
  contributions: {
    tools: [],
    skills: [],
    commands: [
      { id: 'quick-note', title: 'Quick note', host: 'note.create', contexts: ['personal', 'company', 'project'], keywords: ['note', 'memo', 'remember'] },
      { id: 'search-notes', title: 'Search notes', host: 'note.search', contexts: ['personal', 'company', 'project'], keywords: ['note', 'find', 'search'] },
      { id: 'capture-area', title: 'Capture area', host: 'capture.area', contexts: ['personal', 'company', 'project'], keywords: ['screenshot', 'region', 'crop'] },
      { id: 'capture-screen', title: 'Capture screen', host: 'capture.screen', contexts: ['personal', 'company', 'project'], keywords: ['screenshot', 'display', 'monitor'] },
      { id: 'capture-clipboard', title: 'Capture clipboard', host: 'clipboard.read', contexts: ['personal', 'company', 'project'], keywords: ['paste', 'clipboard', 'copy'] },
      { id: 'open-google', title: 'Open Google', host: 'browser.openUrl', contexts: ['personal', 'company', 'project'], keywords: ['google', 'web', 'browser'] },
      { id: 'search-web', title: 'Search the web', host: 'browser.search', contexts: ['personal', 'company', 'project'], keywords: ['google', 'search', 'web'] },
      { id: 'open-website', title: 'Open website', host: 'browser.openUrl', contexts: ['personal', 'company', 'project'], keywords: ['url', 'link', 'website'] },
      { id: 'open-externally', title: 'Open in system browser', host: 'browser.openExternal', contexts: ['personal', 'company', 'project'], keywords: ['external', 'browser', 'url'] },
      { id: 'open-target', title: 'Open app, file, or folder', host: 'os.openTarget', contexts: ['personal', 'company', 'project'], keywords: ['launch', 'app', 'file', 'folder', 'open'] },
      { id: 'ask-nd', title: 'Ask ND', host: 'chat.ask', startsAgent: true, contexts: ['personal', 'company', 'project'], keywords: ['chat', 'agent', 'question'] },
    ],
    views: [
      {
        id: 'notes',
        title: 'Notes',
        description: 'No notes yet. Type anything into the launcher and choose Quick note.',
        kind: 'list',
        host: 'note.search',
        itemTitleKey: 'title',
        itemBodyKey: 'body',
        contexts: ['personal', 'company', 'project'],
        actions: [
          { id: 'note-open', title: 'Open note', host: 'note.open' },
          { id: 'note-delete', title: 'Delete note', host: 'note.delete' },
        ],
      },
      {
        id: 'captures',
        title: 'Captures',
        description: 'No captures yet. Save one with Capture screen or Capture area.',
        kind: 'list',
        host: 'capture.list',
        itemTitleKey: 'title',
        itemBodyKey: 'detail',
        contexts: ['personal', 'company', 'project'],
        actions: [
          { id: 'capture-copy', title: 'Copy image', host: 'capture.copy' },
          { id: 'capture-export', title: 'Export image', host: 'capture.export' },
        ],
      },
    ],
    workflows: [],
  },
}

export const WALLPAPER_MANAGER_MANIFEST: NdExtensionManifest = {
  protocol: ND_EXTENSION_PROTOCOL,
  id: WALLPAPER_MANAGER_ID,
  name: 'Wallpaper Manager',
  description: 'A native desktop extension that changes the host OS wallpaper through ND’s permission broker.',
  version: '1.0.0',
  apiVersion: ND_EXTENSION_API_VERSION,
  contexts: ['personal'],
  permissions: ['os.wallpaper.write'],
  settings: [],
  contributions: {
    tools: [],
    skills: [],
    commands: [
      {
        id: 'choose-wallpaper',
        title: 'Choose wallpaper',
        description: 'Pick an image and set it as the desktop wallpaper.',
        host: 'os.wallpaper.chooseAndSet',
        contexts: ['personal'],
        keywords: ['wallpaper', 'desktop', 'background', 'image'],
      },
    ],
    views: [],
    workflows: [],
  },
}

export const PROJECT_WORKFLOW_MANIFEST: NdExtensionManifest = {
  protocol: ND_EXTENSION_PROTOCOL,
  id: PROJECT_WORKFLOW_ID,
  name: 'Project Workflow',
  description: 'Read-only view of the project’s repository task board, using the project’s existing workflow integration binding.',
  version: '1.0.0',
  apiVersion: ND_EXTENSION_API_VERSION,
  contexts: ['project'],
  permissions: ['workflow.read'],
  settings: [],
  contributions: {
    tools: [],
    skills: [],
    commands: [],
    views: [
      {
        id: 'repository-tasks',
        title: 'Repository tasks',
        description: 'No repository tasks were found for this project yet.',
        kind: 'list',
        host: 'workflow.list',
        itemTitleKey: 'title',
        itemBodyKey: 'detail',
        contexts: ['project'],
        actions: [],
      },
    ],
    workflows: [
      {
        id: 'workflow-mirror',
        title: 'Repository tasks (open board)',
        description: 'Refresh and open the read-only repository task board for this project.',
        pluginId: 'auto',
        contexts: ['project'],
      },
    ],
  },
}

export const BUILTIN_EXTENSION_PACKAGES: readonly NdExtensionManifest[] = [
  DAILY_ESSENTIALS_MANIFEST,
  WALLPAPER_MANAGER_MANIFEST,
  PROJECT_WORKFLOW_MANIFEST,
]

/**
 * Built-in packages activate in Personal by default so daily essentials work
 * before any company or project exists. Every other context — including any
 * company/project use of Daily Essentials — still requires explicit activation.
 */
export function defaultActivationContexts(manifest: NdExtensionManifest): readonly ('personal' | 'company' | 'project')[] {
  return manifest.contexts.includes('personal') ? ['personal'] : []
}
