import fs from 'fs';
import path from 'path';
import { createDFDFSystem } from '../index.ts';
import type { TaskPayload } from '../types/index.ts';
import { runDomainEngineUnitTestSuite } from '../../tests/unit/domainEngine.unit.test.ts';
import { runStateStoreUnitTestSuite } from '../../tests/unit/stateStore.unit.test.ts';
import { runControlPlaneUnitTestSuite } from '../../tests/unit/controlPlane.unit.test.ts';

export interface VerificationResult {
  suiteName: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  durationMs: number;
  details: { testName: string; passed: boolean; error?: string }[];
}

export class TestRunner {
  public async runAllSuites(): Promise<{ success: boolean; results: VerificationResult[] }> {
    const results: VerificationResult[] = [];
    
    // Detailed Unit Test Suites using Fixtures
    results.push(this.formatSuiteResult(runDomainEngineUnitTestSuite()));
    results.push(this.formatSuiteResult(runStateStoreUnitTestSuite()));
    results.push(this.formatSuiteResult(runControlPlaneUnitTestSuite()));

    // Existing System & Performance Verification Suites
    results.push(await this.runCoreDomainEngineSuite());
    results.push(await this.runStateStoreObserverSuite());
    results.push(await this.runControlPlaneSuite());
    results.push(await this.runAtomicPersistenceSuite());
    results.push(await this.runPerformanceBenchmarkSuite());

    const success = results.every((r) => r.failedTests === 0);
    return { success, results };
  }

  private formatSuiteResult(suite: { suiteName: string; details: { testName: string; passed: boolean; error?: string }[] }): VerificationResult {
    const start = performance.now();
    const passed = suite.details.filter((d) => d.passed).length;
    return {
      suiteName: suite.suiteName,
      totalTests: suite.details.length,
      passedTests: passed,
      failedTests: suite.details.length - passed,
      durationMs: Number((performance.now() - start).toFixed(2)),
      details: suite.details
    };
  }

  private async runCoreDomainEngineSuite(): Promise<VerificationResult> {
    const start = performance.now();
    const details: { testName: string; passed: boolean; error?: string }[] = [];
    const { domainEngine, stateStore } = createDFDFSystem({ environment: 'test' });
    stateStore.resetState();

    // Test 1: Task execution success
    try {
      const task: TaskPayload = { id: 't-1', name: 'Test Transform', action: 'COMPUTE_TRANSFORM', params: { value: 10 } };
      const res = domainEngine.executeTask(task);
      if (res.success && (res.output as { transformedValue: number }).transformedValue === 62) {
        details.push({ testName: 'DomainEngine: Valid action execution', passed: true });
      } else {
        details.push({ testName: 'DomainEngine: Valid action execution', passed: false, error: 'Unexpected output value' });
      }
    } catch (e: unknown) {
      details.push({ testName: 'DomainEngine: Valid action execution', passed: false, error: String(e) });
    }

    // Test 2: Invalid action handling
    try {
      const task: TaskPayload = { id: 't-2', name: 'Invalid Action', action: 'NON_EXISTENT' };
      const res = domainEngine.executeTask(task);
      if (!res.success && res.error?.includes('Unsupported engine action')) {
        details.push({ testName: 'DomainEngine: Unsupported action graceful handling', passed: true });
      } else {
        details.push({ testName: 'DomainEngine: Unsupported action graceful handling', passed: false, error: 'Failed to report error' });
      }
    } catch (e: unknown) {
      details.push({ testName: 'DomainEngine: Unsupported action graceful handling', passed: false, error: String(e) });
    }

    // Test 3: Pause and block invariant
    try {
      domainEngine.pause();
      const task: TaskPayload = { id: 't-3', name: 'Blocked Task', action: 'COMPUTE_TRANSFORM' };
      const res = domainEngine.executeTask(task);
      domainEngine.resume();
      if (!res.success && res.error?.includes('PAUSED')) {
        details.push({ testName: 'DomainEngine: Pause invariant check', passed: true });
      } else {
        details.push({ testName: 'DomainEngine: Pause invariant check', passed: false, error: 'Task executed while paused' });
      }
    } catch (e: unknown) {
      details.push({ testName: 'DomainEngine: Pause invariant check', passed: false, error: String(e) });
    }

    // Test 4: Null task edge-case handling
    try {
      const res = domainEngine.executeTask(null as unknown as TaskPayload);
      if (!res.success && res.error?.includes('Invalid TaskPayload')) {
        details.push({ testName: 'DomainEngine: Null payload edge-case handling', passed: true });
      } else {
        details.push({ testName: 'DomainEngine: Null payload edge-case handling', passed: false, error: 'Failed to handle null payload' });
      }
    } catch (e: unknown) {
      details.push({ testName: 'DomainEngine: Null payload edge-case handling', passed: false, error: String(e) });
    }

    // Test 5: Workload DoS cycles upper bound enforcement
    try {
      const task: TaskPayload = { id: 't-5', name: 'Huge Workload', action: 'SIMULATE_WORKLOAD', params: { cycles: 1e9 } };
      const res = domainEngine.executeTask(task);
      const output = res.output as { cyclesExecuted: number };
      if (res.success && output.cyclesExecuted === 10000) {
        details.push({ testName: 'DomainEngine: Workload DoS cycles upper bound enforcement', passed: true });
      } else {
        details.push({ testName: 'DomainEngine: Workload DoS cycles upper bound enforcement', passed: false, error: 'Cycles not capped at 10000' });
      }
    } catch (e: unknown) {
      details.push({ testName: 'DomainEngine: Workload DoS cycles upper bound enforcement', passed: false, error: String(e) });
    }

    const passed = details.filter((d) => d.passed).length;
    return {
      suiteName: 'Core Domain Engine Integration Suite',
      totalTests: details.length,
      passedTests: passed,
      failedTests: details.length - passed,
      durationMs: Number((performance.now() - start).toFixed(2)),
      details
    };
  }

  private async runStateStoreObserverSuite(): Promise<VerificationResult> {
    const start = performance.now();
    const details: { testName: string; passed: boolean; error?: string }[] = [];
    const { stateStore } = createDFDFSystem({ environment: 'test' });
    stateStore.resetState();

    // Test 1: Subscribe & emit event
    try {
      let eventCount = 0;
      const unsubscribe = stateStore.subscribe((event) => {
        if (event.type === 'STATE_CHANGED') eventCount++;
      });

      stateStore.emitEvent('STATE_CHANGED', { test: true });
      stateStore.emitEvent('STATE_CHANGED', { test: true });
      unsubscribe();
      stateStore.emitEvent('STATE_CHANGED', { test: true });

      if (eventCount === 2 && stateStore.getObserverCount() === 0) {
        details.push({ testName: 'StateStore: Observer subscribe, emit, and clean unsubscribe', passed: true });
      } else {
        details.push({ testName: 'StateStore: Observer subscribe, emit, and clean unsubscribe', passed: false, error: `Received ${eventCount} events, observers left: ${stateStore.getObserverCount()}` });
      }
    } catch (e: unknown) {
      details.push({ testName: 'StateStore: Observer subscribe, emit, and clean unsubscribe', passed: false, error: String(e) });
    }

    // Test 2: Shape validation
    try {
      const valid = stateStore.validateStateShape(stateStore.getState());
      const invalid = stateStore.validateStateShape({ status: 'INVALID_STATUS' });
      if (valid && !invalid) {
        details.push({ testName: 'StateStore: Shape validation logic', passed: true });
      } else {
        details.push({ testName: 'StateStore: Shape validation logic', passed: false, error: 'Validation returned false result' });
      }
    } catch (e: unknown) {
      details.push({ testName: 'StateStore: Shape validation logic', passed: false, error: String(e) });
    }

    const passed = details.filter((d) => d.passed).length;
    return {
      suiteName: 'State Store Observer Suite',
      totalTests: details.length,
      passedTests: passed,
      failedTests: details.length - passed,
      durationMs: Number((performance.now() - start).toFixed(2)),
      details
    };
  }

  private async runControlPlaneSuite(): Promise<VerificationResult> {
    const start = performance.now();
    const details: { testName: string; passed: boolean; error?: string }[] = [];
    const { controlPlane, stateStore } = createDFDFSystem({ environment: 'test' });
    stateStore.resetState();

    // Test 1: EXECUTE_TASK command
    try {
      const res = controlPlane.dispatchCommand({
        command: 'EXECUTE_TASK',
        payload: { id: 'cp-1', name: 'Workload Test', action: 'SIMULATE_WORKLOAD', params: { cycles: 5 } }
      });
      if (res.success && res.data) {
        details.push({ testName: 'ControlPlane: EXECUTE_TASK command dispatch', passed: true });
      } else {
        details.push({ testName: 'ControlPlane: EXECUTE_TASK command dispatch', passed: false, error: res.message });
      }
    } catch (e: unknown) {
      details.push({ testName: 'ControlPlane: EXECUTE_TASK command dispatch', passed: false, error: String(e) });
    }

    // Test 2: GET_STATE command
    try {
      const res = controlPlane.dispatchCommand({ command: 'GET_STATE' });
      if (res.success && res.data) {
        details.push({ testName: 'ControlPlane: GET_STATE command', passed: true });
      } else {
        details.push({ testName: 'ControlPlane: GET_STATE command', passed: false, error: 'State retrieval failed' });
      }
    } catch (e: unknown) {
      details.push({ testName: 'ControlPlane: GET_STATE command', passed: false, error: String(e) });
    }

    const passed = details.filter((d) => d.passed).length;
    return {
      suiteName: 'Control Plane Interface Suite',
      totalTests: details.length,
      passedTests: passed,
      failedTests: details.length - passed,
      durationMs: Number((performance.now() - start).toFixed(2)),
      details
    };
  }

  private async runAtomicPersistenceSuite(): Promise<VerificationResult> {
    const start = performance.now();
    const details: { testName: string; passed: boolean; error?: string }[] = [];
    const { stateStore } = createDFDFSystem({ environment: 'test' });
    stateStore.resetState();

    try {
      stateStore.updateState((s) => {
        s.completedTaskCount = 999;
      });
      stateStore.saveToDiskSync();

      const statePath = stateStore.getStoragePath();
      const fileExists = fs.existsSync(statePath);
      const raw = fs.readFileSync(statePath, 'utf8');
      const parsed = JSON.parse(raw);

      if (fileExists && parsed.completedTaskCount === 999) {
        details.push({ testName: 'Persistence: Atomic disk save and read validation', passed: true });
      } else {
        details.push({ testName: 'Persistence: Atomic disk save and read validation', passed: false, error: 'File content mismatch' });
      }
    } catch (e: unknown) {
      details.push({ testName: 'Persistence: Atomic disk save and read validation', passed: false, error: String(e) });
    }

    const passed = details.filter((d) => d.passed).length;
    return {
      suiteName: 'Atomic Persistence Suite',
      totalTests: details.length,
      passedTests: passed,
      failedTests: details.length - passed,
      durationMs: Number((performance.now() - start).toFixed(2)),
      details
    };
  }

  private async runPerformanceBenchmarkSuite(): Promise<VerificationResult> {
    const start = performance.now();
    const details: { testName: string; passed: boolean; error?: string }[] = [];
    const { domainEngine, stateStore } = createDFDFSystem({ environment: 'test' });
    stateStore.resetState();

    const iterations = 500;
    const latencies: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      domainEngine.executeTask({
        id: `bm-${i}`,
        name: 'Benchmark Item',
        action: 'COMPUTE_TRANSFORM',
        params: { value: i }
      });
      latencies.push(performance.now() - t0);
    }

    latencies.sort((a, b) => a - b);
    const p95Index = Math.floor(iterations * 0.95);
    const p95Latency = latencies[p95Index];

    if (p95Latency <= 50) {
      details.push({
        testName: `Performance Benchmark: p95 latency <= 50ms (Actual: ${p95Latency.toFixed(3)}ms across ${iterations} iterations)`,
        passed: true
      });
    } else {
      details.push({
        testName: `Performance Benchmark: p95 latency <= 50ms (Actual: ${p95Latency.toFixed(3)}ms)`,
        passed: false,
        error: `p95 Latency of ${p95Latency.toFixed(3)}ms exceeded target maximum of 50ms`
      });
    }

    const passed = details.filter((d) => d.passed).length;
    return {
      suiteName: 'Performance Benchmark Suite',
      totalTests: details.length,
      passedTests: passed,
      failedTests: details.length - passed,
      durationMs: Number((performance.now() - start).toFixed(2)),
      details
    };
  }
}
