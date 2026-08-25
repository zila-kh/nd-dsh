export interface OrganizationCompanySnapshot {
  id: string
  label: string
  createdAt: number
  files: Array<'organization.json' | 'organization-control.json' | 'organization-strategy.json'>
  restorePending: boolean
}

export interface OrganizationSnapshotDesktopApi {
  list(): Promise<OrganizationCompanySnapshot[]>
  create(label?: string): Promise<OrganizationCompanySnapshot>
  restoreOnNextLaunch(id: string): Promise<OrganizationCompanySnapshot[]>
  cancelRestore(): Promise<OrganizationCompanySnapshot[]>
  onChanged(listener: (snapshots: OrganizationCompanySnapshot[]) => void): () => void
}

export const ORGANIZATION_SNAPSHOT_IPC = {
  list: 'organization-snapshots:list',
  create: 'organization-snapshots:create',
  restoreOnNextLaunch: 'organization-snapshots:restore-next-launch',
  cancelRestore: 'organization-snapshots:cancel-restore',
  changed: 'organization-snapshots:changed',
} as const
