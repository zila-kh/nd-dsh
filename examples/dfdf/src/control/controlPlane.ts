import type { CommandRequest, CommandResponse, TaskPayload } from '../types/index.ts';
import { DomainEngine } from '../engine/domainEngine.ts';
import { StateStore } from '../state/stateStore.ts';

export class ControlPlane {
  private engine: DomainEngine;
  private stateStore: StateStore;

  constructor(engine: DomainEngine, stateStore: StateStore) {
    this.engine = engine;
    this.stateStore = stateStore;
  }

  public dispatchCommand(request: CommandRequest): CommandResponse {
    if (!request || !request.command) {
      return {
        success: false,
        command: 'UNKNOWN',
        message: 'Invalid request: request object and command string are required.',
        error: 'INVALID_REQUEST'
      };
    }

    switch (request.command) {
      case 'EXECUTE_TASK': {
        const payload = request.payload as unknown as TaskPayload;
        if (!payload || typeof payload !== 'object') {
          return {
            success: false,
            command: request.command,
            message: 'Command EXECUTE_TASK requires valid task payload in request body.',
            error: 'MISSING_TASK_PAYLOAD'
          };
        }
        const result = this.engine.executeTask(payload);
        return {
          success: result.success,
          command: request.command,
          message: result.success ? `Task ${result.taskId} executed successfully` : `Task ${result.taskId} failed`,
          data: result,
          error: result.error
        };
      }

      case 'PAUSE': {
        this.engine.pause();
        return {
          success: true,
          command: request.command,
          message: 'Domain engine paused successfully.',
          data: this.stateStore.getState()
        };
      }

      case 'RESUME': {
        this.engine.resume();
        return {
          success: true,
          command: request.command,
          message: 'Domain engine resumed successfully.',
          data: this.stateStore.getState()
        };
      }

      case 'GET_STATE': {
        return {
          success: true,
          command: request.command,
          message: 'Current system state retrieved.',
          data: this.stateStore.getState()
        };
      }

      case 'RESET': {
        const state = this.stateStore.resetState();
        return {
          success: true,
          command: request.command,
          message: 'System state reset to default values.',
          data: state
        };
      }

      default:
        return {
          success: false,
          command: request.command,
          message: `Unrecognized command: '${request.command}'`,
          error: 'UNSUPPORTED_COMMAND'
        };
    }
  }

  public getSystemReport(): {
    config: ReturnType<DomainEngine['getConfig']>;
    state: ReturnType<StateStore['getState']>;
    observerCount: number;
  } {
    return {
      config: this.engine.getConfig(),
      state: this.stateStore.getState(),
      observerCount: this.stateStore.getObserverCount()
    };
  }
}
