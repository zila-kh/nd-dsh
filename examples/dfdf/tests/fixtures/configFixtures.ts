import type { ProjectConfig } from '../../src/types/index.ts';

export const defaultTestConfig: ProjectConfig = {
  projectId: 'dfdf',
  company: 'dd',
  mission: 'dss',
  environment: 'test',
  maxConcurrency: 5,
  persistenceIntervalMs: 50
};

export const lowConcurrencyConfig: ProjectConfig = {
  projectId: 'dfdf',
  company: 'dd',
  mission: 'dss',
  environment: 'test',
  maxConcurrency: 1,
  persistenceIntervalMs: 10
};

export const prodTestConfig: ProjectConfig = {
  projectId: 'dfdf',
  company: 'dd',
  mission: 'dss',
  environment: 'production',
  maxConcurrency: 10,
  persistenceIntervalMs: 500
};
