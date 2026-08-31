import { DomainEngine } from '../../src/engine/domainEngine.ts';
import { StateStore } from '../../src/state/stateStore.ts';
import {
  validTransformTask,
  validWorkloadTask,
  validValidateSchemaTask,
  excessiveWorkloadTask,
  invalidActionTask,
  missingPayloadSchemaTask,
  defaultTestConfig,
  lowConcurrencyConfig
} from '../fixtures/index.ts';
import type { TaskPayload } from '../../src/types/index.ts';

export function runDomainEngineUnitTestSuite(): { suiteName: string; details: { testName: string; passed: boolean; error?: string }[] } {
  const details: { testName: string; passed: boolean; error?: string }[] = [];

  // Test 1: Valid COMPUTE_TRANSFORM execution
  try {
    const stateStore = new StateStore('dfdf_unit_engine_1');
    stateStore.resetState();
    const engine = new DomainEngine(defaultTestConfig, stateStore);

    const res = engine.executeTask(validTransformTask);
    const output = res.output as { transformedValue: number; status: string };

    if (res.success && output.transformedValue === 62 && output.status === 'PROCESSED') {
      details.push({ testName: 'DomainEngine Unit: COMPUTE_TRANSFORM calculation', passed: true });
    } else {
      details.push({ testName: 'DomainEngine Unit: COMPUTE_TRANSFORM calculation', passed: false, error: `Unexpected output: ${JSON.stringify(res.output)}` });
    }
  } catch (e: unknown) {
    details.push({ testName: 'DomainEngine Unit: COMPUTE_TRANSFORM calculation', passed: false, error: String(e) });
  }

  // Test 2: Valid SIMULATE_WORKLOAD execution
  try {
    const stateStore = new StateStore('dfdf_unit_engine_2');
    stateStore.resetState();
    const engine = new DomainEngine(defaultTestConfig, stateStore);

    const res = engine.executeTask(validWorkloadTask);
    const output = res.output as { cyclesExecuted: number };

    if (res.success && output.cyclesExecuted === 50) {
      details.push({ testName: 'DomainEngine Unit: SIMULATE_WORKLOAD cycle execution', passed: true });
    } else {
      details.push({ testName: 'DomainEngine Unit: SIMULATE_WORKLOAD cycle execution', passed: false, error: 'Cycles count mismatch' });
    }
  } catch (e: unknown) {
    details.push({ testName: 'DomainEngine Unit: SIMULATE_WORKLOAD cycle execution', passed: false, error: String(e) });
  }

  // Test 3: DoS cycles cap enforcement
  try {
    const stateStore = new StateStore('dfdf_unit_engine_3');
    stateStore.resetState();
    const engine = new DomainEngine(defaultTestConfig, stateStore);

    const res = engine.executeTask(excessiveWorkloadTask);
    const output = res.output as { cyclesExecuted: number };

    if (res.success && output.cyclesExecuted === 10000) {
      details.push({ testName: 'DomainEngine Unit: Workload DoS cycles cap at 10000', passed: true });
    } else {
      details.push({ testName: 'DomainEngine Unit: Workload DoS cycles cap at 10000', passed: false, error: `Cycles executed: ${output?.cyclesExecuted}` });
    }
  } catch (e: unknown) {
    details.push({ testName: 'DomainEngine Unit: Workload DoS cycles cap at 10000', passed: false, error: String(e) });
  }

  // Test 4: VALIDATE_SCHEMA success path
  try {
    const stateStore = new StateStore('dfdf_unit_engine_4');
    stateStore.resetState();
    const engine = new DomainEngine(defaultTestConfig, stateStore);

    const res = engine.executeTask(validValidateSchemaTask);
    const output = res.output as { isValid: boolean };

    if (res.success && output.isValid === true) {
      details.push({ testName: 'DomainEngine Unit: VALIDATE_SCHEMA success path', passed: true });
    } else {
      details.push({ testName: 'DomainEngine Unit: VALIDATE_SCHEMA success path', passed: false, error: res.error || 'Failed validation' });
    }
  } catch (e: unknown) {
    details.push({ testName: 'DomainEngine Unit: VALIDATE_SCHEMA success path', passed: false, error: String(e) });
  }

  // Test 5: VALIDATE_SCHEMA missing payload error path
  try {
    const stateStore = new StateStore('dfdf_unit_engine_5');
    stateStore.resetState();
    const engine = new DomainEngine(defaultTestConfig, stateStore);

    const res = engine.executeTask(missingPayloadSchemaTask);

    if (!res.success && res.error?.includes('Missing payload parameter')) {
      details.push({ testName: 'DomainEngine Unit: VALIDATE_SCHEMA missing payload error path', passed: true });
    } else {
      details.push({ testName: 'DomainEngine Unit: VALIDATE_SCHEMA missing payload error path', passed: false, error: 'Expected error for missing payload' });
    }
  } catch (e: unknown) {
    details.push({ testName: 'DomainEngine Unit: VALIDATE_SCHEMA missing payload error path', passed: false, error: String(e) });
  }

  // Test 6: Graceful handling of unknown engine action
  try {
    const stateStore = new StateStore('dfdf_unit_engine_6');
    stateStore.resetState();
    const engine = new DomainEngine(defaultTestConfig, stateStore);

    const res = engine.executeTask(invalidActionTask);

    if (!res.success && res.error?.includes('Unsupported engine action')) {
      details.push({ testName: 'DomainEngine Unit: Unknown action error handling', passed: true });
    } else {
      details.push({ testName: 'DomainEngine Unit: Unknown action error handling', passed: false, error: 'Failed to handle unknown action' });
    }
  } catch (e: unknown) {
    details.push({ testName: 'DomainEngine Unit: Unknown action error handling', passed: false, error: String(e) });
  }

  // Test 7: Null and malformed task payload handling
  try {
    const stateStore = new StateStore('dfdf_unit_engine_7');
    stateStore.resetState();
    const engine = new DomainEngine(defaultTestConfig, stateStore);

    const resNull = engine.executeTask(null as unknown as TaskPayload);
    const resIncomplete = engine.executeTask({ id: 't-only-id' } as unknown as TaskPayload);

    if (!resNull.success && !resIncomplete.success && resNull.error?.includes('Invalid TaskPayload')) {
      details.push({ testName: 'DomainEngine Unit: Malformed TaskPayload validation', passed: true });
    } else {
      details.push({ testName: 'DomainEngine Unit: Malformed TaskPayload validation', passed: false, error: 'Failed to reject malformed payload' });
    }
  } catch (e: unknown) {
    details.push({ testName: 'DomainEngine Unit: Malformed TaskPayload validation', passed: false, error: String(e) });
  }

  // Test 8: Pause and Resume execution invariants
  try {
    const stateStore = new StateStore('dfdf_unit_engine_8');
    stateStore.resetState();
    const engine = new DomainEngine(defaultTestConfig, stateStore);

    engine.pause();
    const pausedRes = engine.executeTask(validTransformTask);

    engine.resume();
    const resumedRes = engine.executeTask(validTransformTask);

    if (!pausedRes.success && pausedRes.error?.includes('PAUSED') && resumedRes.success) {
      details.push({ testName: 'DomainEngine Unit: Pause and Resume state invariants', passed: true });
    } else {
      details.push({ testName: 'DomainEngine Unit: Pause and Resume state invariants', passed: false, error: 'Pause/Resume invariants violated' });
    }
  } catch (e: unknown) {
    details.push({ testName: 'DomainEngine Unit: Pause and Resume state invariants', passed: false, error: String(e) });
  }

  // Test 9: Concurrency limit enforcement
  try {
    const stateStore = new StateStore('dfdf_unit_engine_9');
    stateStore.resetState();
    const engine = new DomainEngine(lowConcurrencyConfig, stateStore);

    // Artificially elevate activeTaskCount to simulate active tasks
    stateStore.updateState((s) => {
      s.activeTaskCount = 1;
    });

    const res = engine.executeTask(validTransformTask);

    if (!res.success && res.error?.includes('Max concurrency limit of 1 reached')) {
      details.push({ testName: 'DomainEngine Unit: Max concurrency limit enforcement', passed: true });
    } else {
      details.push({ testName: 'DomainEngine Unit: Max concurrency limit enforcement', passed: false, error: res.error || 'Failed concurrency check' });
    }
  } catch (e: unknown) {
    details.push({ testName: 'DomainEngine Unit: Max concurrency limit enforcement', passed: false, error: String(e) });
  }

  return { suiteName: 'DomainEngine Unit Test Suite', details };
}
