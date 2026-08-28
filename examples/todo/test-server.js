import assert from 'node:assert';
import { createServer } from './server.js';

const TEST_PORT = 3099;

async function runTests() {
  console.log('Starting REST API Server tests...');
  const server = createServer();
  
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  const baseUrl = `http://127.0.0.1:${TEST_PORT}`;

  try {
    // 1. GET /api/health
    console.log('- Testing GET /api/health');
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.strictEqual(healthData.status, 'ok');
    assert.strictEqual(healthData.storage, 'RAM');

    // 2. GET /api/todos
    console.log('- Testing GET /api/todos');
    const getRes = await fetch(`${baseUrl}/api/todos`);
    assert.strictEqual(getRes.status, 200);
    const getTodos = await getRes.json();
    assert.ok(Array.isArray(getTodos));
    const initialCount = getTodos.length;

    // 3. POST /api/todos
    console.log('- Testing POST /api/todos');
    const postRes = await fetch(`${baseUrl}/api/todos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New RAM item' }),
    });
    assert.strictEqual(postRes.status, 201);
    const createdTodo = await postRes.json();
    assert.ok(createdTodo.id);
    assert.strictEqual(createdTodo.title, 'New RAM item');
    assert.strictEqual(createdTodo.completed, false);

    // Verify list count increased
    const getRes2 = await fetch(`${baseUrl}/api/todos`);
    const todos2 = await getRes2.json();
    assert.strictEqual(todos2.length, initialCount + 1);

    // 4. POST validation error
    console.log('- Testing POST /api/todos validation failure');
    const badPostRes = await fetch(`${baseUrl}/api/todos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '' }),
    });
    assert.strictEqual(badPostRes.status, 400);

    // 5. PATCH /api/todos/:id (toggle & title update)
    console.log('- Testing PATCH /api/todos/:id');
    const patchRes = await fetch(`${baseUrl}/api/todos/${createdTodo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: true, title: 'Updated RAM item' }),
    });
    assert.strictEqual(patchRes.status, 200);
    const updatedTodo = await patchRes.json();
    assert.strictEqual(updatedTodo.completed, true);
    assert.strictEqual(updatedTodo.title, 'Updated RAM item');

    // 6. PATCH non-existent ID
    console.log('- Testing PATCH non-existent ID');
    const badPatchRes = await fetch(`${baseUrl}/api/todos/invalid-id-123`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: true }),
    });
    assert.strictEqual(badPatchRes.status, 404);

    // 7. DELETE /api/todos/:id
    console.log('- Testing DELETE /api/todos/:id');
    const delRes = await fetch(`${baseUrl}/api/todos/${createdTodo.id}`, {
      method: 'DELETE',
    });
    assert.strictEqual(delRes.status, 200);

    // Verify removed from list
    const getRes3 = await fetch(`${baseUrl}/api/todos`);
    const todos3 = await getRes3.json();
    assert.strictEqual(todos3.length, initialCount);
    assert.ok(!todos3.some((t) => t.id === createdTodo.id));

    // 8. DELETE non-existent ID
    console.log('- Testing DELETE non-existent ID');
    const badDelRes = await fetch(`${baseUrl}/api/todos/invalid-id-123`, {
      method: 'DELETE',
    });
    assert.strictEqual(badDelRes.status, 404);

    console.log('\nALL REST API TESTS PASSED SUCCESSFULLY! ✅');
  } catch (err) {
    console.error('\nTEST FAILED ❌:', err);
    process.exitCode = 1;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

runTests();
