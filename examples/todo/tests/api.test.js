import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createApp } from '../server/app.js';
import { TodoStorage } from '../server/storage.js';

const TEST_DATA_DIR = path.resolve(process.cwd(), 'data', 'test');
const TEST_FILE = path.resolve(TEST_DATA_DIR, 'test-api-todos.json');

describe('Todo Express REST API Endpoints', () => {
  let app;
  let storage;

  beforeEach(async () => {
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
    storage = new TodoStorage(TEST_FILE);
    await storage.init();
    app = createApp({ storage });
  });

  afterEach(async () => {
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('Health check', () => {
    it('GET /health returns 200 and ok status', async () => {
      const res = await request(app).get('/health');
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'ok');
    });

    it('GET /api/health returns 200 and ok status', async () => {
      const res = await request(app).get('/api/health');
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'ok');
    });
  });

  describe('POST /todos (Create)', () => {
    it('should create a new todo with valid input and return 201', async () => {
      const res = await request(app)
        .post('/todos')
        .send({
          title: 'Implement REST API',
          description: 'Build CRUD endpoints',
          priority: 'high',
          dueDate: '2026-04-01T00:00:00.000Z',
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.ok(res.body.data.id);
      assert.equal(res.body.data.title, 'Implement REST API');
      assert.equal(res.body.data.description, 'Build CRUD endpoints');
      assert.equal(res.body.data.completed, false);
      assert.equal(res.body.data.priority, 'high');
      assert.equal(res.body.data.dueDate, '2026-04-01T00:00:00.000Z');
      assert.ok(res.body.data.createdAt);
      assert.ok(res.body.data.updatedAt);
    });

    it('should create a todo on /api/todos as well', async () => {
      const res = await request(app)
        .post('/api/todos')
        .send({ title: 'Via /api/todos route' });

      assert.equal(res.status, 201);
      assert.equal(res.body.data.title, 'Via /api/todos route');
    });

    it('should reject creation without title or empty title with 400', async () => {
      const res1 = await request(app).post('/todos').send({});
      assert.equal(res1.status, 400);
      assert.equal(res1.body.success, false);

      const res2 = await request(app).post('/todos').send({ title: '   ' });
      assert.equal(res2.status, 400);
      assert.equal(res2.body.success, false);
    });

    it('should reject invalid priority with 400', async () => {
      const res = await request(app).post('/todos').send({
        title: 'Task with bad priority',
        priority: 'urgent-ultra',
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
    });

    it('should reject invalid date with 400', async () => {
      const res = await request(app).post('/todos').send({
        title: 'Task with bad date',
        dueDate: 'not-a-real-date-12345',
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
    });
  });

  describe('GET /todos (Read list)', () => {
    beforeEach(async () => {
      await storage.create({ title: 'Active Low', priority: 'low', completed: false });
      await storage.create({ title: 'Active High', priority: 'high', completed: false });
      await storage.create({ title: 'Completed Medium', priority: 'medium', completed: true });
    });

    it('should list all todos with stats and count', async () => {
      const res = await request(app).get('/todos');
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.count, 3);
      assert.equal(res.body.data.length, 3);
      assert.deepEqual(res.body.stats, { total: 3, active: 2, completed: 1 });
    });

    it('should filter by completion status (active / completed)', async () => {
      const resActive = await request(app).get('/todos?filter=active');
      assert.equal(resActive.status, 200);
      assert.equal(resActive.body.count, 2);
      assert.ok(resActive.body.data.every((t) => !t.completed));

      const resCompleted = await request(app).get('/todos?filter=completed');
      assert.equal(resCompleted.status, 200);
      assert.equal(resCompleted.body.count, 1);
      assert.equal(resCompleted.body.data[0].title, 'Completed Medium');
    });

    it('should filter by priority', async () => {
      const res = await request(app).get('/todos?priority=high');
      assert.equal(res.status, 200);
      assert.equal(res.body.count, 1);
      assert.equal(res.body.data[0].title, 'Active High');
    });

    it('should search by keyword in title/description', async () => {
      const res = await request(app).get('/todos?search=Medium');
      assert.equal(res.status, 200);
      assert.equal(res.body.count, 1);
      assert.equal(res.body.data[0].title, 'Completed Medium');
    });
  });

  describe('GET /todos/:id (Read single)', () => {
    it('should return 200 and todo object when ID exists', async () => {
      const created = await storage.create({ title: 'Specific task' });
      const res = await request(app).get(`/todos/${created.id}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.id, created.id);
      assert.equal(res.body.data.title, 'Specific task');
    });

    it('should return 404 when ID does not exist', async () => {
      const res = await request(app).get('/todos/non-existent-id-999');
      assert.equal(res.status, 404);
      assert.equal(res.body.success, false);
    });
  });

  describe('PUT /todos/:id (Update full)', () => {
    it('should update todo fields and return 200', async () => {
      const created = await storage.create({ title: 'Initial Title', priority: 'low' });
      const res = await request(app)
        .put(`/todos/${created.id}`)
        .send({
          title: 'Updated Title',
          description: 'Updated description',
          priority: 'high',
          completed: true,
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.title, 'Updated Title');
      assert.equal(res.body.data.description, 'Updated description');
      assert.equal(res.body.data.priority, 'high');
      assert.equal(res.body.data.completed, true);
    });

    it('should return 404 when updating non-existent ID', async () => {
      const res = await request(app)
        .put('/todos/non-existent-id')
        .send({ title: 'Updated' });
      assert.equal(res.status, 404);
    });

    it('should return 400 when body has validation errors', async () => {
      const created = await storage.create({ title: 'Valid' });
      const res = await request(app)
        .put(`/todos/${created.id}`)
        .send({ title: '' });
      assert.equal(res.status, 400);
    });
  });

  describe('PATCH /todos/:id (Partial update / complete)', () => {
    it('should partially update completed status', async () => {
      const created = await storage.create({ title: 'Task to complete', completed: false });
      const res = await request(app)
        .patch(`/todos/${created.id}`)
        .send({ completed: true });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.completed, true);
      assert.equal(res.body.data.title, 'Task to complete');
    });

    it('should partially update title only', async () => {
      const created = await storage.create({ title: 'Old Name', priority: 'high' });
      const res = await request(app)
        .patch(`/todos/${created.id}`)
        .send({ title: 'New Name' });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.title, 'New Name');
      assert.equal(res.body.data.priority, 'high');
    });

    it('should return 404 for non-existent ID on PATCH', async () => {
      const res = await request(app)
        .patch('/todos/missing-id')
        .send({ completed: true });
      assert.equal(res.status, 404);
    });
  });

  describe('DELETE /todos/:id (Delete single)', () => {
    it('should delete existing todo and return 200', async () => {
      const created = await storage.create({ title: 'To be deleted' });
      const res = await request(app).delete(`/todos/${created.id}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.id, created.id);

      // Verify it no longer exists
      const check = await request(app).get(`/todos/${created.id}`);
      assert.equal(check.status, 404);
    });

    it('should return 404 when deleting non-existent ID', async () => {
      const res = await request(app).delete('/todos/non-existent-id');
      assert.equal(res.status, 404);
    });
  });

  describe('Batch operations (Clear completed & Toggle all)', () => {
    beforeEach(async () => {
      await storage.create({ title: 'Task 1', completed: false });
      await storage.create({ title: 'Task 2', completed: true });
      await storage.create({ title: 'Task 3', completed: true });
    });

    it('DELETE /todos should clear completed todos', async () => {
      const res = await request(app).delete('/todos');
      assert.equal(res.status, 200);
      assert.equal(res.body.deletedCount, 2);

      const remaining = await request(app).get('/todos');
      assert.equal(remaining.body.count, 1);
      assert.equal(remaining.body.data[0].title, 'Task 1');
    });

    it('POST /todos/clear-completed should also clear completed todos', async () => {
      const res = await request(app).post('/todos/clear-completed');
      assert.equal(res.status, 200);
      assert.equal(res.body.deletedCount, 2);
    });

    it('PATCH /todos/toggle-all should mark all as completed or uncompleted', async () => {
      const res = await request(app)
        .patch('/todos/toggle-all')
        .send({ completed: true });

      assert.equal(res.status, 200);
      assert.equal(res.body.updatedCount, 1); // 1 task was not completed, now all 3 are

      const list = await request(app).get('/todos');
      assert.ok(list.body.data.every((t) => t.completed));
    });
  });

  describe('Persistence across server reload', () => {
    it('should persist new todo to disk and load it in a second app instance', async () => {
      // 1. Create todo via first app instance
      const postRes = await request(app)
        .post('/todos')
        .send({ title: 'Persisted Task', priority: 'high', description: 'Testing file storage' });
      assert.equal(postRes.status, 201);
      const todoId = postRes.body.data.id;

      // 2. Instantiate a second storage and app instance on the exact same data file
      const secondStorage = new TodoStorage(TEST_FILE);
      await secondStorage.init();
      const secondApp = createApp({ storage: secondStorage });

      // 3. Query second app instance
      const getRes = await request(secondApp).get(`/todos/${todoId}`);
      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.data.title, 'Persisted Task');
      assert.equal(getRes.body.data.priority, 'high');
      assert.equal(getRes.body.data.description, 'Testing file storage');
    });
  });
});
