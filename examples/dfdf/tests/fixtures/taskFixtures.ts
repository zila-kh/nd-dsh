import type { TaskPayload } from '../../src/types/index.ts';

export const validTransformTask: TaskPayload = {
  id: 'fixture-task-1',
  name: 'Compute Transform Task Fixture',
  action: 'COMPUTE_TRANSFORM',
  params: { value: 10 }
};

export const validWorkloadTask: TaskPayload = {
  id: 'fixture-task-2',
  name: 'Simulate Workload Task Fixture',
  action: 'SIMULATE_WORKLOAD',
  params: { cycles: 50 }
};

export const validValidateSchemaTask: TaskPayload = {
  id: 'fixture-task-3',
  name: 'Validate Schema Task Fixture',
  action: 'VALIDATE_SCHEMA',
  params: {
    schema: 'UserRecord',
    payload: { id: 'u-100', role: 'admin', active: true }
  }
};

export const excessiveWorkloadTask: TaskPayload = {
  id: 'fixture-task-dos',
  name: 'Excessive Workload Task Fixture',
  action: 'SIMULATE_WORKLOAD',
  params: { cycles: 999999 }
};

export const invalidActionTask: TaskPayload = {
  id: 'fixture-task-invalid-action',
  name: 'Invalid Action Task Fixture',
  action: 'UNKNOWN_ENGINE_ACTION'
};

export const missingPayloadSchemaTask: TaskPayload = {
  id: 'fixture-task-no-schema-payload',
  name: 'Missing Payload Schema Task Fixture',
  action: 'VALIDATE_SCHEMA',
  params: { schema: 'UserRecord' }
};

export const missingFieldsTaskPayload = {
  id: 'fixture-task-missing-fields'
} as unknown as TaskPayload;

export const sampleTaskBatch: TaskPayload[] = Array.from({ length: 10 }, (_, i) => ({
  id: `batch-task-${i + 1}`,
  name: `Batch Execution Item ${i + 1}`,
  action: 'COMPUTE_TRANSFORM',
  params: { value: (i + 1) * 2 }
}));
