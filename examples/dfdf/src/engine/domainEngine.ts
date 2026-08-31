import type { TaskPayload, TaskResult, ProjectConfig } from '../types/index.ts';
import { StateStore } from '../state/stateStore.ts';

export class DomainEngine {
  private config: ProjectConfig;
  private stateStore: StateStore;
  private totalLatencySumMs: number = 0;

  constructor(config: ProjectConfig, stateStore: StateStore) {
    this.config = config;
    this.stateStore = stateStore;
  }

  public getConfig(): Readonly<ProjectConfig> {
    return this.config;
  }

  public executeTask(task: TaskPayload): TaskResult {
    const startTime = performance.now();

    // Invariant Check 1: Input validation (must be first to avoid null property access)
    if (!task || typeof task !== 'object' || !task.id || !task.name || !task.action) {
      return {
        taskId: task?.id || 'unknown',
        success: false,
        durationMs: 0,
        error: 'Invalid TaskPayload: id, name, and action are required fields.'
      };
    }

    const currentState = this.stateStore.getState();

    // Invariant Check 2: Pause state check
    if (currentState.status === 'PAUSED') {
      return {
        taskId: task.id,
        success: false,
        durationMs: 0,
        error: 'Engine is currently PAUSED. Resume execution before submitting tasks.'
      };
    }

    // Invariant Check 3: Concurrency check
    if (currentState.activeTaskCount >= this.config.maxConcurrency) {
      return {
        taskId: task.id,
        success: false,
        durationMs: 0,
        error: `Max concurrency limit of ${this.config.maxConcurrency} reached.`
      };
    }

    // Transition state to RUNNING & update active count
    this.stateStore.updateState((s) => {
      s.status = 'RUNNING';
      s.activeTaskCount += 1;
    });
    this.stateStore.emitEvent('TASK_STARTED', { taskId: task.id, action: task.action });

    try {
      // Execute task logic deterministically
      const output = this.processAction(task.action, task.params);
      const durationMs = Math.max(0.1, performance.now() - startTime);

      this.totalLatencySumMs += durationMs;

      // Update state post-completion
      this.stateStore.updateState((s) => {
        s.activeTaskCount = Math.max(0, s.activeTaskCount - 1);
        s.completedTaskCount += 1;
        s.metrics.processedTasks += 1;
        s.metrics.avgLatencyMs = Number((this.totalLatencySumMs / s.metrics.processedTasks).toFixed(2));
        if (s.activeTaskCount === 0) {
          s.status = 'IDLE';
        }
      });

      this.stateStore.emitEvent('TASK_COMPLETED', { taskId: task.id, durationMs, output });
      this.stateStore.saveToDiskSync();

      return {
        taskId: task.id,
        success: true,
        durationMs: Number(durationMs.toFixed(2)),
        output
      };
    } catch (err: unknown) {
      const durationMs = Math.max(0.1, performance.now() - startTime);
      const errorMessage = err instanceof Error ? err.message : String(err);

      this.stateStore.updateState((s) => {
        s.activeTaskCount = Math.max(0, s.activeTaskCount - 1);
        s.failedTaskCount += 1;
        s.metrics.errorCount += 1;
        s.status = 'ERROR';
      });

      this.stateStore.emitEvent('TASK_FAILED', { taskId: task.id, durationMs, error: errorMessage });
      this.stateStore.saveToDiskSync();

      return {
        taskId: task.id,
        success: false,
        durationMs: Number(durationMs.toFixed(2)),
        error: errorMessage
      };
    }
  }

  private processAction(action: string, params?: Record<string, unknown>): unknown {
    switch (action) {
      case 'COMPUTE_TRANSFORM': {
        const inputVal = typeof params?.value === 'number' && Number.isFinite(params.value) ? params.value : 0;
        return { transformedValue: inputVal * 2 + 42, status: 'PROCESSED' };
      }

      case 'VALIDATE_SCHEMA': {
        const payload = params?.payload;
        if (!payload) throw new Error('Missing payload parameter for VALIDATE_SCHEMA');
        return { isValid: typeof payload === 'object' && payload !== null };
      }

      case 'SIMULATE_WORKLOAD': {
        const rawCycles = typeof params?.cycles === 'number' && Number.isFinite(params.cycles) ? params.cycles : 10;
        const cycles = Math.min(10000, Math.max(0, Math.floor(rawCycles)));
        let accumulator = 0;
        for (let i = 0; i < cycles; i++) {
          accumulator += (i * 3) % 7;
        }
        return { cyclesExecuted: cycles, finalAccumulator: accumulator };
      }

      default:
        throw new Error(`Unsupported engine action: '${action}'`);
    }
  }

  public pause(): void {
    this.stateStore.updateState((s) => {
      s.status = 'PAUSED';
    });
    this.stateStore.emitEvent('STATE_CHANGED', { newStatus: 'PAUSED' });
    this.stateStore.saveToDiskSync();
  }

  public resume(): void {
    this.stateStore.updateState((s) => {
      s.status = s.activeTaskCount > 0 ? 'RUNNING' : 'IDLE';
    });
    this.stateStore.emitEvent('STATE_CHANGED', { newStatus: this.stateStore.getState().status });
    this.stateStore.saveToDiskSync();
  }
}
