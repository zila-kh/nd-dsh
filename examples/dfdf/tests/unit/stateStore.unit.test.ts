import fs from 'fs';
import path from 'path';
import { StateStore } from '../../src/state/stateStore.ts';
import { corruptedState } from '../fixtures/index.ts';
import type { SystemEvent } from '../../src/types/index.ts';

export function runStateStoreUnitTestSuite(): { suiteName: string; details: { testName: string; passed: boolean; error?: string }[] } {
  const details: { testName: string; passed: boolean; error?: string }[] = [];

  // Test 1: Reset state and state retrieval
  try {
    const store = new StateStore('dfdf_unit_state_1');
    const state = store.resetState();

    if (state.status === 'IDLE' && state.completedTaskCount === 0 && state.activeTaskCount === 0) {
      details.push({ testName: 'StateStore Unit: Initial reset state structure', passed: true });
    } else {
      details.push({ testName: 'StateStore Unit: Initial reset state structure', passed: false, error: 'State values do not match defaults' });
    }
  } catch (e: unknown) {
    details.push({ testName: 'StateStore Unit: Initial reset state structure', passed: false, error: String(e) });
  }

  // Test 2: Observer subscription and multi-event handling
  try {
    const store = new StateStore('dfdf_unit_state_2');
    store.resetState();
    const receivedEvents: string[] = [];

    const unsubscribe = store.subscribe((event: SystemEvent) => {
      receivedEvents.push(event.type);
    });

    store.emitEvent('TASK_STARTED', { taskId: 't-1' });
    store.emitEvent('TASK_COMPLETED', { taskId: 't-1' });
    store.emitEvent('TASK_FAILED', { taskId: 't-2' });
    store.emitEvent('ERROR_LOGGED', { error: 'Test error' });
    unsubscribe();

    store.emitEvent('STATE_CHANGED', { dummy: true });

    if (receivedEvents.length === 4 && store.getObserverCount() === 0) {
      details.push({ testName: 'StateStore Unit: Observer multi-event emission and unsubscribe', passed: true });
    } else {
      details.push({ testName: 'StateStore Unit: Observer multi-event emission and unsubscribe', passed: false, error: `Received ${receivedEvents.length} events, remaining observers: ${store.getObserverCount()}` });
    }
  } catch (e: unknown) {
    details.push({ testName: 'StateStore Unit: Observer multi-event emission and unsubscribe', passed: false, error: String(e) });
  }

  // Test 3: Observer exception isolation resilience
  try {
    const store = new StateStore('dfdf_unit_state_3');
    store.resetState();
    let safeObserverCalled = false;

    // Faulty observer
    store.subscribe(() => {
      throw new Error('Simulated observer failure');
    });

    // Safe observer
    store.subscribe(() => {
      safeObserverCalled = true;
    });

    // Should not throw outer exception
    store.emitEvent('STATE_CHANGED', { test: true });

    if (safeObserverCalled) {
      details.push({ testName: 'StateStore Unit: Observer error exception isolation', passed: true });
    } else {
      details.push({ testName: 'StateStore Unit: Observer error exception isolation', passed: false, error: 'Safe observer was not called' });
    }
  } catch (e: unknown) {
    details.push({ testName: 'StateStore Unit: Observer error exception isolation', passed: false, error: String(e) });
  }

  // Test 4: Shape validation logic
  try {
    const store = new StateStore('dfdf_unit_state_4');
    const valid = store.validateStateShape(store.getState());
    const invalid = store.validateStateShape(corruptedState);

    if (valid === true && invalid === false) {
      details.push({ testName: 'StateStore Unit: validateStateShape precision', passed: true });
    } else {
      details.push({ testName: 'StateStore Unit: validateStateShape precision', passed: false, error: `valid: ${valid}, invalid: ${invalid}` });
    }
  } catch (e: unknown) {
    details.push({ testName: 'StateStore Unit: validateStateShape precision', passed: false, error: String(e) });
  }

  // Test 5: Disk persistence and load recovery
  try {
    const store = new StateStore('dfdf_unit_state_5');
    store.resetState();

    store.updateState((s) => {
      s.completedTaskCount = 42;
      s.status = 'RUNNING';
    });

    store.saveToDiskSync();

    // Create a new store instance with same project id to test loadFromDiskSync
    const store2 = new StateStore('dfdf_unit_state_5');
    store2.loadFromDiskSync();

    const loadedState = store2.getState();

    if (loadedState.completedTaskCount === 42 && loadedState.status === 'RUNNING') {
      details.push({ testName: 'StateStore Unit: Save to disk and reload state', passed: true });
    } else {
      details.push({ testName: 'StateStore Unit: Save to disk and reload state', passed: false, error: 'Loaded state mismatch' });
    }
  } catch (e: unknown) {
    details.push({ testName: 'StateStore Unit: Save to disk and reload state', passed: false, error: String(e) });
  }

  // Test 6: Recovery when disk file contains corrupted JSON
  try {
    const store = new StateStore('dfdf_unit_state_6');
    store.resetState();
    const filePath = store.getStoragePath();

    // Write malformed JSON to disk
    fs.writeFileSync(filePath, '{ malformed json content...', 'utf8');

    const store2 = new StateStore('dfdf_unit_state_6');
    store2.loadFromDiskSync();

    // Store2 should fallback gracefully without crashing and keep default state
    const state = store2.getState();
    if (state && store2.validateStateShape(state)) {
      details.push({ testName: 'StateStore Unit: Malformed JSON disk load fallback', passed: true });
    } else {
      details.push({ testName: 'StateStore Unit: Malformed JSON disk load fallback', passed: false, error: 'Failed fallback on malformed JSON' });
    }
  } catch (e: unknown) {
    details.push({ testName: 'StateStore Unit: Malformed JSON disk load fallback', passed: false, error: String(e) });
  }

  return { suiteName: 'StateStore Unit Test Suite', details };
}
