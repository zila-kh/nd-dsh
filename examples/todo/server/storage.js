import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * @typedef {'low' | 'medium' | 'high'} Priority
 * @typedef {'all' | 'active' | 'completed'} FilterStatus
 * 
 * @typedef {Object} Todo
 * @property {string} id
 * @property {string} title
 * @property {string} [description]
 * @property {boolean} completed
 * @property {Priority} priority
 * @property {string|null} [dueDate]
 * @property {string} createdAt
 * @property {string} updatedAt
 */

export class TodoStorage {
  /**
   * @param {string} [filePath] Path to JSON storage file
   */
  constructor(filePath) {
    this.filePath = filePath || path.resolve(__dirname, '..', 'data', 'todos.json');
    /** @type {Map<string, Todo>} */
    this.todos = new Map();
    this.initialized = false;
  }

  /**
   * Initialize storage and load existing data from disk.
   */
  async init() {
    if (this.initialized) return;

    try {
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });

      try {
        const raw = await fs.readFile(this.filePath, 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          this.todos.clear();
          for (const item of data) {
            if (item && item.id && item.title) {
              this.todos.set(item.id, {
                id: String(item.id),
                title: String(item.title).trim(),
                description: item.description ? String(item.description).trim() : '',
                completed: Boolean(item.completed),
                priority: ['low', 'medium', 'high'].includes(item.priority) ? item.priority : 'medium',
                dueDate: item.dueDate ? String(item.dueDate) : null,
                createdAt: item.createdAt || new Date().toISOString(),
                updatedAt: item.updatedAt || new Date().toISOString(),
              });
            }
          }
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.warn(`Warning: Could not read storage file at ${this.filePath}: ${err.message}. Starting fresh.`);
        }
        // If file doesn't exist, we persist empty state
        await this.persist();
      }
    } catch (err) {
      console.error(`Storage init error: ${err.message}`);
    }

    this.initialized = true;
  }

  /**
   * Synchronously persist todos to disk using atomic write (write to temp file then rename).
   */
  async persist() {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });

    const items = Array.from(this.todos.values());
    const json = JSON.stringify(items, null, 2);

    const tempPath = `${this.filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    await fs.writeFile(tempPath, json, 'utf-8');
    await fs.rename(tempPath, this.filePath);
  }

  /**
   * Get all todos with optional filtering, sorting, and search.
   * @param {Object} [options]
   * @param {string} [options.filter] - 'all' | 'active' | 'completed' | boolean
   * @param {string} [options.priority] - 'low' | 'medium' | 'high'
   * @param {string} [options.search] - substring search in title and description
   * @param {string} [options.sortBy] - 'createdAt' | 'updatedAt' | 'dueDate' | 'priority' | 'title'
   * @param {'asc'|'desc'} [options.sortOrder] - 'asc' | 'desc'
   * @returns {Todo[]}
   */
  getAll(options = {}) {
    let list = Array.from(this.todos.values());

    const { filter, priority, search, sortBy = 'createdAt', sortOrder = 'desc' } = options;

    // Filter by completion status
    if (filter !== undefined && filter !== 'all') {
      if (filter === 'active' || filter === false || filter === 'false') {
        list = list.filter((t) => !t.completed);
      } else if (filter === 'completed' || filter === true || filter === 'true') {
        list = list.filter((t) => t.completed);
      }
    }

    // Filter by priority
    if (priority && ['low', 'medium', 'high'].includes(priority)) {
      list = list.filter((t) => t.priority === priority);
    }

    // Filter by search term
    if (search && typeof search === 'string' && search.trim().length > 0) {
      const q = search.trim().toLowerCase();
      list = list.filter((t) => 
        t.title.toLowerCase().includes(q) || 
        (t.description && t.description.toLowerCase().includes(q))
      );
    }

    // Sorting
    const priorityWeight = { high: 3, medium: 2, low: 1 };
    list.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'priority') {
        comparison = (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0);
      } else if (sortBy === 'title') {
        comparison = a.title.localeCompare(b.title);
      } else if (sortBy === 'dueDate') {
        if (!a.dueDate && !b.dueDate) comparison = 0;
        else if (!a.dueDate) comparison = 1;
        else if (!b.dueDate) comparison = -1;
        else comparison = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      } else if (sortBy === 'updatedAt') {
        comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      } else {
        // default createdAt
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return list;
  }

  /**
   * Get counts & summary statistics
   */
  getStats() {
    let total = 0;
    let active = 0;
    let completed = 0;

    for (const todo of this.todos.values()) {
      total++;
      if (todo.completed) {
        completed++;
      } else {
        active++;
      }
    }

    return { total, active, completed };
  }

  /**
   * Get a single todo by ID
   * @param {string} id
   * @returns {Todo | null}
   */
  getById(id) {
    return this.todos.get(String(id)) || null;
  }

  /**
   * Create and persist a new Todo item.
   * @param {Object} input
   * @param {string} input.title
   * @param {string} [input.description]
   * @param {boolean} [input.completed]
   * @param {Priority} [input.priority]
   * @param {string|null} [input.dueDate]
   * @returns {Promise<Todo>}
   */
  async create(input) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    /** @type {Todo} */
    const newTodo = {
      id,
      title: input.title.trim(),
      description: input.description ? input.description.trim() : '',
      completed: Boolean(input.completed),
      priority: ['low', 'medium', 'high'].includes(input.priority) ? input.priority : 'medium',
      dueDate: input.dueDate || null,
      createdAt: now,
      updatedAt: now,
    };

    this.todos.set(id, newTodo);
    await this.persist();
    return newTodo;
  }

  /**
   * Update an existing Todo item.
   * @param {string} id
   * @param {Partial<Todo>} updates
   * @returns {Promise<Todo | null>}
   */
  async update(id, updates) {
    const existing = this.todos.get(String(id));
    if (!existing) return null;

    const now = new Date().toISOString();

    if (updates.title !== undefined) {
      existing.title = String(updates.title).trim();
    }
    if (updates.description !== undefined) {
      existing.description = updates.description ? String(updates.description).trim() : '';
    }
    if (updates.completed !== undefined) {
      existing.completed = Boolean(updates.completed);
    }
    if (updates.priority !== undefined && ['low', 'medium', 'high'].includes(updates.priority)) {
      existing.priority = updates.priority;
    }
    if (updates.dueDate !== undefined) {
      existing.dueDate = updates.dueDate ? String(updates.dueDate) : null;
    }

    existing.updatedAt = now;
    this.todos.set(id, existing);
    await this.persist();
    return existing;
  }

  /**
   * Toggle completion status
   * @param {string} id
   * @returns {Promise<Todo | null>}
   */
  async toggleComplete(id) {
    const existing = this.todos.get(String(id));
    if (!existing) return null;

    return this.update(id, { completed: !existing.completed });
  }

  /**
   * Delete a todo by ID
   * @param {string} id
   * @returns {Promise<Todo | null>}
   */
  async delete(id) {
    const existing = this.todos.get(String(id));
    if (!existing) return null;

    this.todos.delete(String(id));
    await this.persist();
    return existing;
  }

  /**
   * Clear all completed todos
   * @returns {Promise<number>} Number of deleted todos
   */
  async clearCompleted() {
    let count = 0;
    for (const [id, todo] of this.todos.entries()) {
      if (todo.completed) {
        this.todos.delete(id);
        count++;
      }
    }
    if (count > 0) {
      await this.persist();
    }
    return count;
  }

  /**
   * Toggle all todos to completed or active
   * @param {boolean} completed
   * @returns {Promise<number>}
   */
  async toggleAll(completed) {
    const now = new Date().toISOString();
    let updatedCount = 0;

    for (const [id, todo] of this.todos.entries()) {
      if (todo.completed !== completed) {
        todo.completed = completed;
        todo.updatedAt = now;
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      await this.persist();
    }
    return updatedCount;
  }

  /**
   * Clear all todos (primarily for testing)
   */
  async clearAll() {
    this.todos.clear();
    await this.persist();
  }
}
