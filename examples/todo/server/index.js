import { createApp } from './app.js';
import { TodoStorage } from './storage.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const DATA_FILE = process.env.DATA_FILE || path.resolve(__dirname, '..', 'data', 'todos.json');

async function startServer() {
  const storage = new TodoStorage(DATA_FILE);
  await storage.init();

  const app = createApp({ storage });

  const server = app.listen(PORT, '127.0.0.1', () => {
    console.log(`Todo server is running at http://127.0.0.1:${PORT}`);
    console.log(`API endpoints available at http://127.0.0.1:${PORT}/todos and http://127.0.0.1:${PORT}/api/todos`);
    console.log(`Data stored at: ${DATA_FILE}`);
  });

  const shutdown = async (signal) => {
    console.log(`Received ${signal}. Gracefully shutting down...`);
    server.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
