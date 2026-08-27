import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { TodoStorage } from '../server/storage.js';

const TEST_DATA_DIR = path.resolve(process.cwd(), 'data', 'test');
const TEST_FILE = path.resolve(TEST_DATA_DIR, 'test-storage-todos.json');

describe('TodoStorage Persistence Layer', () => {
  beforeEach(async () => {
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  afterEach(async () => {
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should initialize and create directory/file if not existing', async () => {
    const storage = new TodoStorage(TEST_FILE);
    await storage.init();

    assert.equal(storage.getAll().length, 0);
    const stats = storage.getStats();
    assert.deepEqual(stats, { total: 0, active: 0, completed: 0 });

    const exists = await fs.stat(TEST_FILE).then(() => true).catch(() => false);
    assert.equal(exists, true);
  });

  it('should create and persist a new todo', async () => {
    const storage = new TodoStorage(TEST_FILE);
    await storage.init();

    const created = await storage.create({
      title: 'Buy groceries',
      description: 'Milk, bread, cheese',
      priority: 'high',
      dueDate: '2026-03-01T12:00:00.000Z',
    });

    assert.ok(created.id);
    assert.equal(created.title, 'Buy groceries');
    assert.equal(created.description, 'Milk, bread, cheese');
    assert.equal(created.completed, false);
    assert.equal(created.priority, 'high');
    assert.equal(created.dueDate, '2026-03-01T12:00:00.000Z');
    assert.ok(created.createdAt);
    assert.ok(created.updatedAt);

    // Verify written to disk file
    const fileContent = JSON.parse(await fs.readFile(TEST_FILE, 'utf-8'));
    assert.equal(fileContent.length, 1);
    assert.equal(fileContent[0].id, created.id);
  });

  it('should reload data across storage instances (persistence verification)', async () => {
    const storage1 = new TodoStorage(TEST_FILE);
    await storage1.init();

    const todo1 = await storage1.create({ title: 'Task 1', priority: 'low' });
    const todo2 = await storage1.create({ title: 'Task 2', completed: true, priority: 'high' });

    // Instantiate fresh storage pointing to same file
    const storage2 = new TodoStorage(TEST_FILE);
    await storage2.init();

    const all = storage2.getAll();
    assert.equal(all.length, 2);

    const loaded1 = storage2.getById(todo1.id);
    const loaded2 = storage2.getById(todo2.id);

    assert.ok(loaded1);
    assert.equal(loaded1.title, 'Task 1');
    assert.equal(loaded1.completed, false);

    assert.ok(loaded2);
    assert.equal(loaded2.title, 'Task 2');
    assert.equal(loaded2.completed, true);
  });

  it('should update, toggle and delete todos with persistence', async () => {
    const storage = new TodoStorage(TEST_FILE);
    await storage.init();

    const created = await storage.create({ title: 'Original Title', priority: 'medium' });

    // Update
    const updated = await storage.update(created.id, {
      title: 'Updated Title',
      priority: 'high',
      description: 'New Description',
    });
    assert.equal(updated.title, 'Updated Title');
    assert.equal(updated.priority, 'high');
    assert.equal(updated.description, 'New Description');

    // Toggle complete
    const toggled = await storage.toggleComplete(created.id);
    assert.equal(toggled.completed, true);

    // Delete
    const deleted = await storage.delete(created.id);
    assert.equal(deleted.id, created.id);
    assert.equal(storage.getById(created.id), null);

    // Verify on disk
    const diskData = JSON.parse(await fs.readFile(TEST_FILE, 'utf-8'));
    assert.equal(diskData.length, 0);
  });

  it('should support filtering, search, and sorting', async () => {
    const storage = new TodoStorage(TEST_FILE);
    await storage.init();

    await storage.create({ title: 'Apples', priority: 'low', completed: false });
    await storage.create({ title: 'Bananas', priority: 'high', completed: true, description: 'Fruit purchase' });
    await storage.create({ title: 'Carrots', priority: 'medium', completed: false });

    // Filter active
    const active = storage.getAll({ filter: 'active' });
    assert.equal(active.length, 2);

    // Filter completed
    const completed = storage.getAll({ filter: 'completed' });
    assert.equal(completed.length, 1);
    assert.equal(completed[0].title, 'Bananas');

    // Filter priority
    const highPriority = storage.getAll({ priority: 'high' });
    assert.equal(highPriority.length, 1);
    assert.equal(highPriority[0].title, 'Bananas');

    // Search
    const searchResult = storage.getAll({ search: 'fruit' });
    assert.equal(searchResult.length, 1);
    assert.equal(searchResult[0].title, 'Bananas');

    // Sort by title asc
    const sortedTitle = storage.getAll({ sortBy: 'title', sortOrder: 'asc' });
    assert.equal(sortedTitle[0].title, 'Apples');
    assert.equal(sortedTitle[1].title, 'Bananas');
    assert.equal(sortedTitle[2].title, 'Carrots');
  });

  it('should clear completed and toggle all', async () => {
    const storage = new TodoStorage(TEST_FILE);
    await storage.init();

    await storage.create({ title: 'Task 1', completed: false });
    await storage.create({ title: 'Task 2', completed: true });
    await storage.create({ title: 'Task 3', completed: true });

    const clearedCount = await storage.clearCompleted();
    assert.equal(clearedCount, 2);
    assert.equal(storage.getAll().length, 1);

    // Toggle all to true
    await storage.toggleAll(true);
    assert.equal(storage.getAll()[0].completed, true);
  });
});
