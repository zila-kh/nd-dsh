import fs from 'fs';
import path from 'path';
import type { SystemState, SystemEvent, ObserverCallback, EventType } from '../types/index.ts';

export class StateStore {
  private currentState: SystemState;
  private observers: Set<ObserverCallback> = new Set();
  private storagePath: string;
  private tempStoragePath: string;

  constructor(baseDir?: string) {
    let dir = baseDir;
    if (!dir) {
      if (fs.existsSync(path.join(process.cwd(), 'package.json'))) {
        dir = '.';
      } else {
        dir = 'dfdf';
      }
    }
    this.storagePath = path.join(dir, 'state.json');
    this.tempStoragePath = path.join(dir, 'state.json.tmp');
    this.currentState = this.createDefaultState();
  }

  public getStoragePath(): string {
    return this.storagePath;
  }

  private createDefaultState(): SystemState {
    return {
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
  }

  public getState(): Readonly<SystemState> {
    return { ...this.currentState, metrics: { ...this.currentState.metrics } };
  }

  public updateState(updater: (state: SystemState) => void): Readonly<SystemState> {
    updater(this.currentState);
    this.currentState.lastUpdated = new Date().toISOString();
    return this.getState();
  }

  public subscribe(callback: ObserverCallback): () => void {
    this.observers.add(callback);
    return () => {
      this.observers.delete(callback);
    };
  }

  public emitEvent(type: EventType, payload: Record<string, unknown> = {}): void {
    const event: SystemEvent = {
      type,
      timestamp: new Date().toISOString(),
      payload
    };
    for (const callback of this.observers) {
      try {
        callback(event);
      } catch (err) {
        // Observer exception isolation prevents store operations from breaking
      }
    }
  }

  public getObserverCount(): number {
    return this.observers.size;
  }

  public validateStateShape(raw: unknown): raw is SystemState {
    if (typeof raw !== 'object' || raw === null) return false;
    const obj = raw as Record<string, unknown>;
    const validStatus = ['IDLE', 'RUNNING', 'PAUSED', 'COMPLETED', 'ERROR'].includes(String(obj.status));
    const validCounts =
      typeof obj.activeTaskCount === 'number' &&
      typeof obj.completedTaskCount === 'number' &&
      typeof obj.failedTaskCount === 'number';
    const metrics = obj.metrics as Record<string, unknown> | undefined;
    const validMetrics =
      typeof metrics === 'object' &&
      metrics !== null &&
      typeof metrics.processedTasks === 'number' &&
      typeof metrics.errorCount === 'number' &&
      typeof metrics.avgLatencyMs === 'number';

    return validStatus && validCounts && validMetrics;
  }

  public saveToDiskSync(): void {
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = JSON.stringify(this.currentState, null, 2);
    // Atomic write-and-rename pattern
    fs.writeFileSync(this.tempStoragePath, data, 'utf8');
    if (fs.existsSync(this.storagePath)) {
      try {
        fs.unlinkSync(this.storagePath);
      } catch {}
    }
    try {
      fs.renameSync(this.tempStoragePath, this.storagePath);
    } catch {
      fs.copyFileSync(this.tempStoragePath, this.storagePath);
      if (fs.existsSync(this.tempStoragePath)) {
        fs.unlinkSync(this.tempStoragePath);
      }
    }
  }

  public loadFromDiskSync(): boolean {
    try {
      if (!fs.existsSync(this.storagePath)) {
        return false;
      }
      const rawText = fs.readFileSync(this.storagePath, 'utf8');
      const parsed = JSON.parse(rawText);
      if (this.validateStateShape(parsed)) {
        this.currentState = parsed;
        return true;
      } else {
        return false;
      }
    } catch (err) {
      return false;
    }
  }

  public resetState(): Readonly<SystemState> {
    this.currentState = this.createDefaultState();
    this.saveToDiskSync();
    return this.getState();
  }
}
