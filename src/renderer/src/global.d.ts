import type { DesktopApi } from '../../shared/contracts'
import type { DesignDesktopApi } from '../../shared/design'
import type { OrganizationDesktopApi } from '../../shared/organization'

declare global {
  interface Window {
    ndDsh: DesktopApi
    ndDshDesign: DesignDesktopApi
    ndDshOrganization: OrganizationDesktopApi
  }
}

export {}
