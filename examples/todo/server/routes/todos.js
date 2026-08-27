import { Router } from 'express';

/**
 * Helper to validate todo payload
 * @param {any} body
 * @param {boolean} isPartial
 * @returns {{ valid: boolean, errors: string[], sanitized: Record<string, any> }}
 */
function validateTodoPayload(body, isPartial = false) {
  const errors = [];
  const sanitized = {};

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Request body must be a JSON object'], sanitized: {} };
  }

  // Validate title
  if ('title' in body || !isPartial) {
    if (typeof body.title !== 'string') {
      errors.push('Title must be a string');
    } else {
      const trimmed = body.title.trim();
      if (trimmed.length === 0) {
        errors.push('Title cannot be empty');
      } else if (trimmed.length > 200) {
        errors.push('Title cannot exceed 200 characters');
      } else {
        sanitized.title = trimmed;
      }
    }
  }

  // Validate description (optional)
  if ('description' in body) {
    if (body.description === null || body.description === undefined) {
      sanitized.description = '';
    } else if (typeof body.description !== 'string') {
      errors.push('Description must be a string');
    } else {
      const trimmed = body.description.trim();
      if (trimmed.length > 1000) {
        errors.push('Description cannot exceed 1000 characters');
      } else {
        sanitized.description = trimmed;
      }
    }
  }

  // Validate completed (optional)
  if ('completed' in body) {
    if (typeof body.completed !== 'boolean') {
      errors.push('Completed must be a boolean (true or false)');
    } else {
      sanitized.completed = body.completed;
    }
  }

  // Validate priority (optional)
  if ('priority' in body) {
    const validPriorities = ['low', 'medium', 'high'];
    if (typeof body.priority !== 'string' || !validPriorities.includes(body.priority.toLowerCase())) {
      errors.push(`Priority must be one of: ${validPriorities.join(', ')}`);
    } else {
      sanitized.priority = body.priority.toLowerCase();
    }
  }

  // Validate dueDate (optional)
  if ('dueDate' in body) {
    if (body.dueDate === null || body.dueDate === '') {
      sanitized.dueDate = null;
    } else if (typeof body.dueDate === 'string') {
      const parsedDate = new Date(body.dueDate);
      const isFormatValid = /^\d{4}-\d{2}-\d{2}/.test(body.dueDate);
      if (isNaN(parsedDate.getTime()) || !isFormatValid) {
        errors.push('Due date must be a valid ISO 8601 or YYYY-MM-DD date string');
      } else {
        sanitized.dueDate = parsedDate.toISOString();
      }
    } else {
      errors.push('Due date must be a string or null');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized,
  };
}

/**
 * Creates the Todo Express router
 * @param {import('../storage.js').TodoStorage} storage
 * @returns {Router}
 */
export function createTodoRouter(storage) {
  const router = Router();

  /**
   * GET /todos - List all todos with optional filtering, sorting, search
   */
  router.get('/', (req, res) => {
    try {
      const { filter, completed, priority, search, sortBy, sortOrder } = req.query;

      let effectiveFilter = filter;
      if (completed !== undefined && effectiveFilter === undefined) {
        effectiveFilter = completed;
      }

      const todos = storage.getAll({
        filter: effectiveFilter,
        priority: priority ? String(priority).toLowerCase() : undefined,
        search: search ? String(search) : undefined,
        sortBy: sortBy ? String(sortBy) : undefined,
        sortOrder: sortOrder ? String(sortOrder).toLowerCase() : undefined,
      });

      const stats = storage.getStats();

      res.status(200).json({
        success: true,
        data: todos,
        count: todos.length,
        stats,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve todos',
        message: err.message,
      });
    }
  });

  /**
   * POST /todos - Create a new todo
   */
  router.post('/', async (req, res) => {
    try {
      const validation = validateTodoPayload(req.body, false);

      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validation.errors,
        });
      }

      const newTodo = await storage.create(validation.sanitized);

      res.status(201).json({
        success: true,
        data: newTodo,
        message: 'Todo created successfully',
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: 'Failed to create todo',
        message: err.message,
      });
    }
  });

  /**
   * DELETE /todos - Clear all completed todos (batch delete)
   */
  router.delete('/', async (req, res) => {
    try {
      const count = await storage.clearCompleted();
      res.status(200).json({
        success: true,
        deletedCount: count,
        message: `Cleared ${count} completed todos`,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: 'Failed to clear completed todos',
        message: err.message,
      });
    }
  });

  /**
   * POST /todos/clear-completed - Alternative endpoint to clear completed todos
   */
  router.post('/clear-completed', async (req, res) => {
    try {
      const count = await storage.clearCompleted();
      res.status(200).json({
        success: true,
        deletedCount: count,
        message: `Cleared ${count} completed todos`,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: 'Failed to clear completed todos',
        message: err.message,
      });
    }
  });

  /**
   * PATCH /todos/toggle-all - Mark all todos completed or active
   */
  router.patch('/toggle-all', async (req, res) => {
    try {
      if (typeof req.body.completed !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'Field "completed" (boolean) is required',
        });
      }

      const count = await storage.toggleAll(req.body.completed);
      res.status(200).json({
        success: true,
        updatedCount: count,
        message: `Updated ${count} todos to completed=${req.body.completed}`,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: 'Failed to toggle todos',
        message: err.message,
      });
    }
  });

  /**
   * GET /todos/:id - Get a single todo by ID
   */
  router.get('/:id', (req, res) => {
    try {
      const { id } = req.params;
      const todo = storage.getById(id);

      if (!todo) {
        return res.status(404).json({
          success: false,
          error: `Todo with ID '${id}' not found`,
        });
      }

      res.status(200).json({
        success: true,
        data: todo,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve todo',
        message: err.message,
      });
    }
  });

  /**
   * PUT /todos/:id - Update an existing todo (full replacement of updated fields)
   */
  router.put('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const existing = storage.getById(id);

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: `Todo with ID '${id}' not found`,
        });
      }

      const validation = validateTodoPayload(req.body, false);

      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validation.errors,
        });
      }

      const updated = await storage.update(id, validation.sanitized);

      res.status(200).json({
        success: true,
        data: updated,
        message: 'Todo updated successfully',
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: 'Failed to update todo',
        message: err.message,
      });
    }
  });

  /**
   * PATCH /todos/:id - Partially update an existing todo (e.g. toggle complete or edit title)
   */
  router.patch('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const existing = storage.getById(id);

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: `Todo with ID '${id}' not found`,
        });
      }

      const validation = validateTodoPayload(req.body, true);

      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validation.errors,
        });
      }

      const updated = await storage.update(id, validation.sanitized);

      res.status(200).json({
        success: true,
        data: updated,
        message: 'Todo updated successfully',
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: 'Failed to patch todo',
        message: err.message,
      });
    }
  });

  /**
   * DELETE /todos/:id - Delete a single todo
   */
  router.delete('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.delete(id);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: `Todo with ID '${id}' not found`,
        });
      }

      res.status(200).json({
        success: true,
        data: deleted,
        message: 'Todo deleted successfully',
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: 'Failed to delete todo',
        message: err.message,
      });
    }
  });

  return router;
}
