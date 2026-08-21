import type { DesktopApi } from '../../shared/contracts'
import type { OrganizationDesktopApi } from '../../shared/organization'

declare global {
  interface Window {
    ndDsh: DesktopApi
    ndDshOrganization: OrganizationDesktopApi
  }
}

export {}
