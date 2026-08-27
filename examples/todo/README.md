# Todo Beta — Express.js REST API & Vanilla JavaScript Todo App

Production-quality Todo application built with an Express.js REST API, persistent JSON file storage, and a responsive vanilla JavaScript frontend.

## Features

- **Full CRUD REST API**:
  - `GET /todos` & `GET /api/todos`: Fetch todos with filtering (`filter=all|active|completed`), priority filtering (`priority=low|medium|high`), full-text search (`search=...`), and custom sorting (`sortBy`, `sortOrder`). Includes summary stats (total, active, completed).
  - `GET /todos/:id` & `GET /api/todos/:id`: Fetch single todo by ID with 404 handling.
  - `POST /todos` & `POST /api/todos`: Create a todo with strict payload validation, priority, due date, and description. Returns `201 Created`.
  - `PUT /todos/:id` & `PUT /api/todos/:id`: Update existing todo fields.
  - `PATCH /todos/:id` & `PATCH /api/todos/:id`: Partial update (e.g. toggle `completed` state).
  - `DELETE /todos/:id` & `DELETE /api/todos/:id`: Delete a single todo item.
  - `DELETE /todos` / `POST /todos/clear-completed`: Batch remove all completed items.
  - `PATCH /todos/toggle-all`: Batch mark all items completed or active.
  - `GET /health` & `GET /api/health`: Health status endpoint.
- **Robust Persistence**:
  - In-memory cache synced to disk (`data/todos.json`) using atomic writes (`write-to-temp` + `rename`) to prevent corruption during concurrent writes or sudden shutdowns.
  - Automatic directory creation and initialization.
  - Configurable storage path via `DATA_FILE` environment variable.
- **Vanilla JavaScript Frontend**:
  - Accessible, responsive UI built with semantic HTML5, modern CSS variables, and clean vanilla JS.
  - Real-time statistics counters and progress bar indicator.
  - Filter tabs (All, Active, Completed), search box with clear button, priority selector, sorting dropdown.
  - Inline completion toggle, editing modal dialog, deletion with toast notifications.
  - Connection status indicator.
- **Automated Test Suite**:
  - 31 test cases covering storage layer persistence, atomic reload, and all Express API endpoints (creation, validation, filtering, search, sorting, update, partial patch, deletion, batch operations, 404/400 errors, and cross-instance data reload).

## Project Structure

```
├── data/                  # Persistent JSON storage files
│   └── todos.json
├── public/                # Static frontend assets
│   ├── css/
│   │   └── style.css      # Modern responsive styling with CSS variables
│   ├── js/
│   │   └── app.js         # Vanilla JS client logic and API integration
│   └── index.html         # Semantic HTML5 user interface
├── server/                # Express backend application
│   ├── routes/
│   │   └── todos.js       # Express REST router for CRUD /todos
│   ├── app.js             # Express app setup and middleware
│   ├── index.js           # Server bootstrap and graceful shutdown
│   └── storage.js         # Atomic JSON file persistence engine
├── tests/                 # Automated test suite
│   ├── api.test.js        # Supertest API endpoint test suite
│   ├── run.js             # Test runner entrypoint
│   └── storage.test.js    # Storage and persistence test suite
├── package.json
└── README.md
```

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Run Automated Tests

```bash
npm test
```

### 3. Start the Server

```bash
npm start
```

The application will be accessible at:
- Web UI: http://127.0.0.1:3000
- REST API: http://127.0.0.1:3000/todos and http://127.0.0.1:3000/api/todos
