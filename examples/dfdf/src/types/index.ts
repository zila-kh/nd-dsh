export type SystemStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'ERROR';

export interface ProjectConfig {
  projectId: 'dfdf';
  company: 'dd';
  mission: 'dss';
  environment: 'local' | 'test' | 'production';
  maxConcurrency: number;
  persistenceIntervalMs: number;
}

export interface Metrics {
  processedTasks: number;
  errorCount: number;
  avgLatencyMs: number;
}

export interface SystemState {
  status: SystemStatus;
  activeTaskCount: number;
  completedTaskCount: number;
  failedTaskCount: number;
  metrics: Metrics;
  lastUpdated: string;
}

export type EventType = 'STATE_CHANGED' | 'TASK_STARTED' | 'TASK_COMPLETED' | 'TASK_FAILED' | 'ERROR_LOGGED';

export interface SystemEvent {
  type: EventType;
  timestamp: string;
  payload: Record<string, unknown>;
}

export type ObserverCallback = (event: SystemEvent) => void;

export interface TaskPayload {
  id: string;
  name: string;
  action: string;
  params?: Record<string, unknown>;
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  durationMs: number;
  output?: unknown;
  error?: string;
}

export interface CommandRequest {
  command: 'EXECUTE_TASK' | 'PAUSE' | 'RESUME' | 'GET_STATE' | 'RESET';
  payload?: Record<string, unknown>;
  author?: string;
}

export interface CommandResponse {
  success: boolean;
  command: string;
  message: string;
  data?: unknown;
  error?: string;
}
