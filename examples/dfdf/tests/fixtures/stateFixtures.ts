import type { SystemState } from '../../src/types/index.ts';

export const defaultTestState: SystemState = {
  status: 'IDLE',
  activeTaskCount: 0,
  completedTaskCount: 0,
  failedTaskCount: 0,
  metrics: {
    processedTasks: 0,
    errorCount: 0,
    avgLatencyMs: 0
  },
  lastUpdated: new Date().toISOString()
};

export const pausedState: SystemState = {
  status: 'PAUSED',
  activeTaskCount: 0,
  completedTaskCount: 5,
  failedTaskCount: 0,
  metrics: {
    processedTasks: 5,
    errorCount: 0,
    avgLatencyMs: 2.5
  },
  lastUpdated: new Date().toISOString()
};

export const runningState: SystemState = {
  status: 'RUNNING',
  activeTaskCount: 2,
  completedTaskCount: 10,
  failedTaskCount: 1,
  metrics: {
    processedTasks: 11,
    errorCount: 1,
    avgLatencyMs: 4.1
  },
  lastUpdated: new Date().toISOString()
};

export const errorState: SystemState = {
  status: 'ERROR',
  activeTaskCount: 0,
  completedTaskCount: 3,
  failedTaskCount: 2,
  metrics: {
    processedTasks: 5,
    errorCount: 2,
    avgLatencyMs: 8.0
  },
  lastUpdated: new Date().toISOString()
};

export const corruptedState = {
  status: 'INVALID_STATUS_VALUE',
  activeTaskCount: 'not-a-number',
  metrics: null
} as unknown as Record<string, unknown>;
