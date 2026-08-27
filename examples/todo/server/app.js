import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTodoRouter } from './routes/todos.js';
import { TodoStorage } from './storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Creates and configures the Express application
 * @param {Object} [options]
 * @param {TodoStorage} [options.storage] Custom storage instance
 * @param {string} [options.staticDir] Custom static files directory
 * @returns {express.Express}
 */
export function createApp(options = {}) {
  const app = express();
  const storage = options.storage || new TodoStorage();
  const staticDir = options.staticDir || path.resolve(__dirname, '..', 'public');

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Handle JSON parse errors gracefully
  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({
        success: false,
        error: 'Invalid JSON payload in request body',
      });
    }
    next(err);
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
  });
  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
  });

  // Mount Todo Router at both /todos and /api/todos
  const todoRouter = createTodoRouter(storage);
  app.use('/todos', todoRouter);
  app.use('/api/todos', todoRouter);

  // Serve static frontend files
  app.use(express.static(staticDir));

  // Fallback 404 handler
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/todos')) {
      return res.status(404).json({
        success: false,
        error: `Route '${req.originalUrl}' not found`,
      });
    }

    if (req.method === 'GET' && req.accepts('html')) {
      return res.sendFile(path.join(staticDir, 'index.html'), (err) => {
        if (err) {
          res.status(404).send('Not Found');
        }
      });
    }

    res.status(404).json({
      success: false,
      error: `Route '${req.originalUrl}' not found`,
    });
  });

  // Global error handler
  app.use((err, req, res, next) => {
    console.error('Unhandled server error:', err);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'production' ? undefined : err.message,
    });
  });

  return app;
}
