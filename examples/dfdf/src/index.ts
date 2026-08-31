import type { ProjectConfig } from './types/index.ts';
import { StateStore } from './state/stateStore.ts';
import { DomainEngine } from './engine/domainEngine.ts';
import { ControlPlane } from './control/controlPlane.ts';

export * from './types/index.ts';
export { StateStore } from './state/stateStore.ts';
export { DomainEngine } from './engine/domainEngine.ts';
export { ControlPlane } from './control/controlPlane.ts';

export function createDFDFSystem(customConfig?: Partial<ProjectConfig>): {
  stateStore: StateStore;
  domainEngine: DomainEngine;
  controlPlane: ControlPlane;
} {
  const defaultConfig: ProjectConfig = {
    projectId: 'dfdf',
    company: 'dd',
    mission: 'dss',
    environment: 'local',
    maxConcurrency: 5,
    persistenceIntervalMs: 100,
    ...customConfig
  };

  const stateStore = new StateStore('dfdf');
  stateStore.loadFromDiskSync();

  const domainEngine = new DomainEngine(defaultConfig, stateStore);
  const controlPlane = new ControlPlane(domainEngine, stateStore);

  return { stateStore, domainEngine, controlPlane };
}
