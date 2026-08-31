import { ControlPlane } from '../../src/control/controlPlane.ts';
import { DomainEngine } from '../../src/engine/domainEngine.ts';
import { StateStore } from '../../src/state/stateStore.ts';
import { defaultTestConfig, validTransformTask } from '../fixtures/index.ts';
import type { CommandRequest } from '../../src/types/index.ts';

export function runControlPlaneUnitTestSuite(): { suiteName: string; details: { testName: string; passed: boolean; error?: string }[] } {
  const details: { testName: string; passed: boolean; error?: string }[] = [];

  // Helper setup
  function setupControlPlane(id: string) {
    const store = new StateStore(id);
    store.resetState();
    const engine = new DomainEngine(defaultTestConfig, store);
    const cp = new ControlPlane(engine, store);
    return { store, engine, cp };
  }

  // Test 1: EXECUTE_TASK dispatch
  try {
    const { cp } = setupControlPlane('dfdf_unit_cp_1');
    const res = cp.dispatchCommand({
      command: 'EXECUTE_TASK',
      payload: validTransformTask as unknown as Record<string, unknown>
    });

    if (res.success && res.command === 'EXECUTE_TASK' && res.data) {
      details.push({ testName: 'ControlPlane Unit: EXECUTE_TASK dispatch success', passed: true });
    } else {
      details.push({ testName: 'ControlPlane Unit: EXECUTE_TASK dispatch success', passed: false, error: res.message });
    }
  } catch (e: unknown) {
    details.push({ testName: 'ControlPlane Unit: EXECUTE_TASK dispatch success', passed: false, error: String(e) });
  }

  // Test 2: EXECUTE_TASK missing payload handling
  try {
    const { cp } = setupControlPlane('dfdf_unit_cp_2');
    const res = cp.dispatchCommand({
      command: 'EXECUTE_TASK'
    });

    if (!res.success && res.error === 'MISSING_TASK_PAYLOAD') {
      details.push({ testName: 'ControlPlane Unit: EXECUTE_TASK missing payload error', passed: true });
    } else {
      details.push({ testName: 'ControlPlane Unit: EXECUTE_TASK missing payload error', passed: false, error: 'Failed to return error' });
    }
  } catch (e: unknown) {
    details.push({ testName: 'ControlPlane Unit: EXECUTE_TASK missing payload error', passed: false, error: String(e) });
  }

  // Test 3: PAUSE and RESUME command dispatch
  try {
    const { cp, store } = setupControlPlane('dfdf_unit_cp_3');

    const pauseRes = cp.dispatchCommand({ command: 'PAUSE' });
    const stateAfterPause = store.getState();

    const resumeRes = cp.dispatchCommand({ command: 'RESUME' });
    const stateAfterResume = store.getState();

    if (pauseRes.success && stateAfterPause.status === 'PAUSED' && resumeRes.success && stateAfterResume.status === 'IDLE') {
      details.push({ testName: 'ControlPlane Unit: PAUSE and RESUME command state updates', passed: true });
    } else {
      details.push({ testName: 'ControlPlane Unit: PAUSE and RESUME command state updates', passed: false, error: `Status after pause: ${stateAfterPause.status}, after resume: ${stateAfterResume.status}` });
    }
  } catch (e: unknown) {
    details.push({ testName: 'ControlPlane Unit: PAUSE and RESUME command state updates', passed: false, error: String(e) });
  }

  // Test 4: GET_STATE and RESET commands
  try {
    const { cp, store } = setupControlPlane('dfdf_unit_cp_4');

    store.updateState((s) => {
      s.completedTaskCount = 77;
    });

    const getRes = cp.dispatchCommand({ command: 'GET_STATE' });
    const resetRes = cp.dispatchCommand({ command: 'RESET' });
    const stateAfterReset = store.getState();

    if (getRes.success && resetRes.success && stateAfterReset.completedTaskCount === 0) {
      details.push({ testName: 'ControlPlane Unit: GET_STATE and RESET dispatch', passed: true });
    } else {
      details.push({ testName: 'ControlPlane Unit: GET_STATE and RESET dispatch', passed: false, error: 'Failed reset state verification' });
    }
  } catch (e: unknown) {
    details.push({ testName: 'ControlPlane Unit: GET_STATE and RESET dispatch', passed: false, error: String(e) });
  }

  // Test 5: Invalid and unsupported command requests
  try {
    const { cp } = setupControlPlane('dfdf_unit_cp_5');

    const nullReqRes = cp.dispatchCommand(null as unknown as CommandRequest);
    const unknownCmdRes = cp.dispatchCommand({ command: 'UNSUPPORTED_FOO' as unknown as CommandRequest['command'] });

    if (!nullReqRes.success && nullReqRes.error === 'INVALID_REQUEST' && !unknownCmdRes.success && unknownCmdRes.error === 'UNSUPPORTED_COMMAND') {
      details.push({ testName: 'ControlPlane Unit: Invalid request & unsupported command validation', passed: true });
    } else {
      details.push({ testName: 'ControlPlane Unit: Invalid request & unsupported command validation', passed: false, error: 'Validation response codes mismatch' });
    }
  } catch (e: unknown) {
    details.push({ testName: 'ControlPlane Unit: Invalid request & unsupported command validation', passed: false, error: String(e) });
  }

  // Test 6: getSystemReport inspection
  try {
    const { cp, store } = setupControlPlane('dfdf_unit_cp_6');
    store.subscribe(() => {});

    const report = cp.getSystemReport();

    if (report.config.projectId === 'dfdf' && report.state.status === 'IDLE' && report.observerCount === 1) {
      details.push({ testName: 'ControlPlane Unit: getSystemReport metadata check', passed: true });
    } else {
      details.push({ testName: 'ControlPlane Unit: getSystemReport metadata check', passed: false, error: 'Report metadata mismatch' });
    }
  } catch (e: unknown) {
    details.push({ testName: 'ControlPlane Unit: getSystemReport metadata check', passed: false, error: String(e) });
  }

  return { suiteName: 'ControlPlane Unit Test Suite', details };
}
