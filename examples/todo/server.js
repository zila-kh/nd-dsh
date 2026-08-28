import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// In-memory RAM storage
const todos = [
  {
    id: '1',
    title: 'Learn Node.js REST API',
    completed: true,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: '2',
    title: 'Build in-memory fullstack todo app',
    completed: false,
    createdAt: new Date().toISOString(),
  },
];

const DEFAULT_PORT = process.env.PORT || 3001;

// CORS headers helper
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// JSON response helper
function sendJSON(res, statusCode, data) {
  setCorsHeaders(res);
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = statusCode;
  res.end(JSON.stringify(data));
}

// Helper to parse JSON body
function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON format'));
      }
    });
    req.on('error', (err) => reject(err));
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method.toUpperCase();

    // Handle CORS preflight options request
    if (method === 'OPTIONS') {
      setCorsHeaders(res);
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      // Health check endpoint
      if (pathname === '/api/health' && method === 'GET') {
        sendJSON(res, 200, { status: 'ok', storage: 'RAM', count: todos.length });
        return;
      }

      // GET /api/todos - List all todos
      if (pathname === '/api/todos' && method === 'GET') {
        sendJSON(res, 200, todos);
        return;
      }

      // POST /api/todos - Create new todo
      if (pathname === '/api/todos' && method === 'POST') {
        const body = await getRequestBody(req);
        const title = body.title ? String(body.title).trim() : '';

        if (!title) {
          sendJSON(res, 400, { error: 'Title is required' });
          return;
        }

        const newTodo = {
          id: crypto.randomUUID(),
          title,
          completed: false,
          createdAt: new Date().toISOString(),
        };

        todos.push(newTodo);
        sendJSON(res, 201, newTodo);
        return;
      }

      // Routes matching /api/todos/:id
      const todoIdMatch = pathname.match(/^\/api\/todos\/([^/]+)$/);
      if (todoIdMatch) {
        const id = todoIdMatch[1];
        const todoIndex = todos.findIndex((item) => item.id === id);

        if (todoIndex === -1) {
          sendJSON(res, 404, { error: 'Todo item not found' });
          return;
        }

        // PATCH /api/todos/:id - Update or toggle todo
        if (method === 'PATCH') {
          const body = await getRequestBody(req);
          const existingTodo = todos[todoIndex];

          if (typeof body.completed === 'boolean') {
            existingTodo.completed = body.completed;
          } else if (typeof body.completed === 'undefined' && typeof body.title === 'undefined') {
            // Toggle completed state if omitted
            existingTodo.completed = !existingTodo.completed;
          }

          if (typeof body.title === 'string' && body.title.trim()) {
            existingTodo.title = body.title.trim();
          }

          sendJSON(res, 200, existingTodo);
          return;
        }

        // DELETE /api/todos/:id - Delete todo item
        if (method === 'DELETE') {
          const [deletedTodo] = todos.splice(todoIndex, 1);
          sendJSON(res, 200, { message: 'Todo deleted successfully', item: deletedTodo });
          return;
        }
      }

      // Fallback for unknown routes
      sendJSON(res, 404, { error: 'Route not found' });
    } catch (err) {
      sendJSON(res, 500, { error: err.message || 'Internal server error' });
    }
  });
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  const server = createServer();
  server.listen(DEFAULT_PORT, () => {
    console.log(`Node Todo REST API Server running on http://localhost:${DEFAULT_PORT}`);
  });
}

export { createServer, todos };
