import type { DesktopApi } from '../../shared/contracts'
import type { DesignDesktopApi } from '../../shared/design'
import type { ExtensionsDesktopApi } from '../../shared/extensions'
import type { OrganizationControlDesktopApi } from '../../shared/organization-control'
import type { OrganizationDesktopApi } from '../../shared/organization'
import type { OrganizationStrategyDesktopApi } from '../../shared/organization-strategy'
import type { TerminalDesktopApi } from '../../shared/terminal'

declare global {
  interface Window {
    ndDsh: DesktopApi
    ndDshExtensions: ExtensionsDesktopApi
    ndDshDesign: DesignDesktopApi
    ndDshOrganization: OrganizationDesktopApi
    ndDshControl: OrganizationControlDesktopApi
    ndDshStrategy: OrganizationStrategyDesktopApi
    ndDshTerminal: TerminalDesktopApi
    ndDshRuntimeMode?: 'ui-preview'
  }
}

export {}
