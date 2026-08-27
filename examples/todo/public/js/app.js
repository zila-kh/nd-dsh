/**
 * Todo Beta - Vanilla JavaScript Application
 * Interacts with the Express.js REST API
 */

const API_BASE = '/todos';

// State
const state = {
  todos: [],
  stats: { total: 0, active: 0, completed: 0 },
  filter: 'all',
  priority: 'all',
  search: '',
  sortBy: 'createdAt',
  sortOrder: 'desc',
  loading: false,
};

// DOM Elements
const elements = {
  // Form
  createTodoForm: document.getElementById('createTodoForm'),
  todoTitleInput: document.getElementById('todoTitleInput'),
  todoPriorityInput: document.getElementById('todoPriorityInput'),
  todoDueDateInput: document.getElementById('todoDueDateInput'),
  todoDescInput: document.getElementById('todoDescInput'),
  toggleDetailsBtn: document.getElementById('toggleDetailsBtn'),
  formExtraFields: document.getElementById('formExtraFields'),
  
  // Stats
  statTotal: document.getElementById('statTotal'),
  statActive: document.getElementById('statActive'),
  statCompleted: document.getElementById('statCompleted'),
  statPercentage: document.getElementById('statPercentage'),
  progressBar: document.getElementById('progressBar'),
  progressBarFill: document.getElementById('progressBarFill'),
  connectionStatus: document.getElementById('connectionStatus'),
  
  // Controls
  searchInput: document.getElementById('searchInput'),
  clearSearchBtn: document.getElementById('clearSearchBtn'),
  filterTabs: document.querySelectorAll('.tab-btn'),
  priorityFilter: document.getElementById('priorityFilter'),
  sortBySelect: document.getElementById('sortBySelect'),
  toggleAllBtn: document.getElementById('toggleAllBtn'),
  clearCompletedBtn: document.getElementById('clearCompletedBtn'),

  // List & State
  todoList: document.getElementById('todoList'),
  loadingState: document.getElementById('loadingState'),
  emptyState: document.getElementById('emptyState'),
  emptyStateTitle: document.getElementById('emptyStateTitle'),
  emptyStateDesc: document.getElementById('emptyStateDesc'),

  // Modal
  editModal: document.getElementById('editModal'),
  editTodoForm: document.getElementById('editTodoForm'),
  editTodoId: document.getElementById('editTodoId'),
  editTodoTitle: document.getElementById('editTodoTitle'),
  editTodoPriority: document.getElementById('editTodoPriority'),
  editTodoDueDate: document.getElementById('editTodoDueDate'),
  editTodoDesc: document.getElementById('editTodoDesc'),
  closeModalBtn: document.getElementById('closeModalBtn'),
  cancelEditBtn: document.getElementById('cancelEditBtn'),

  // Toast
  toastContainer: document.getElementById('toastContainer'),
};

// Toast Notifications
function showToast(message, type = 'info', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 200ms ease';
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

// API Helper
async function apiRequest(endpoint = '', options = {}) {
  const url = `${API_BASE}${endpoint}`;
  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      ...options,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMsg = data.error || (data.details && data.details.join(', ')) || `HTTP ${response.status}`;
      throw new Error(errorMsg);
    }

    return data;
  } catch (err) {
    console.error(`API error on ${options.method || 'GET'} ${url}:`, err);
    throw err;
  }
}

// Format date helpers
function formatDateDisplay(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  
  const options = { month: 'short', day: 'numeric', year: 'numeric' };
  return date.toLocaleDateString(undefined, options);
}

function isDateOverdue(isoString, isCompleted) {
  if (!isoString || isCompleted) return false;
  const dueDate = new Date(isoString);
  const now = new Date();
  // reset to start of day for comparison
  dueDate.setHours(23, 59, 59, 999);
  return dueDate < now;
}

// Load and Render Todos
async function fetchTodos() {
  state.loading = true;
  updateUI();

  try {
    const params = new URLSearchParams();
    if (state.filter !== 'all') params.append('filter', state.filter);
    if (state.priority !== 'all') params.append('priority', state.priority);
    if (state.search) params.append('search', state.search);
    if (state.sortBy) params.append('sortBy', state.sortBy);
    if (state.sortOrder) params.append('sortOrder', state.sortOrder);

    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await apiRequest(query);

    state.todos = res.data || [];
    state.stats = res.stats || { total: 0, active: 0, completed: 0 };
    setConnectionStatus(true);
  } catch (err) {
    setConnectionStatus(false);
    showToast(`Failed to load tasks: ${err.message}`, 'error');
  } finally {
    state.loading = false;
    updateUI();
  }
}

function setConnectionStatus(online) {
  const indicator = elements.connectionStatus.querySelector('.status-indicator');
  const text = elements.connectionStatus.querySelector('.status-text');
  if (online) {
    indicator.className = 'status-indicator online';
    text.textContent = 'Connected';
  } else {
    indicator.className = 'status-indicator offline';
    text.textContent = 'Offline / Error';
  }
}

// Update UI Components
function updateUI() {
  // Update stats
  const { total, active, completed } = state.stats;
  elements.statTotal.textContent = total;
  elements.statActive.textContent = active;
  elements.statCompleted.textContent = completed;

  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  elements.statPercentage.textContent = `${percentage}% done`;
  elements.progressBarFill.style.width = `${percentage}%`;
  elements.progressBar.setAttribute('aria-valuenow', percentage);

  // Clear completed button state
  elements.clearCompletedBtn.disabled = completed === 0;

  // Toggle All button label
  if (total > 0 && active === 0) {
    elements.toggleAllBtn.textContent = 'Mark All Active';
  } else {
    elements.toggleAllBtn.textContent = 'Mark All Done';
  }

  // Loading state
  if (state.loading) {
    elements.loadingState.classList.remove('hidden');
    elements.emptyState.classList.add('hidden');
    elements.todoList.innerHTML = '';
    return;
  } else {
    elements.loadingState.classList.add('hidden');
  }

  // Empty state
  if (state.todos.length === 0) {
    elements.emptyState.classList.remove('hidden');
    if (state.search) {
      elements.emptyStateTitle.textContent = 'No matching tasks';
      elements.emptyStateDesc.textContent = `No results found for "${state.search}". Try another term.`;
    } else if (state.filter === 'active') {
      elements.emptyStateTitle.textContent = 'No active tasks';
      elements.emptyStateDesc.textContent = 'All caught up! Create a new task or check completed.';
    } else if (state.filter === 'completed') {
      elements.emptyStateTitle.textContent = 'No completed tasks';
      elements.emptyStateDesc.textContent = 'Complete tasks by clicking their checkbox.';
    } else {
      elements.emptyStateTitle.textContent = 'No tasks yet';
      elements.emptyStateDesc.textContent = 'Add your first task above to get started!';
    }
    elements.todoList.innerHTML = '';
    return;
  } else {
    elements.emptyState.classList.add('hidden');
  }

  // Render Todo items
  renderTodoList();
}

function renderTodoList() {
  elements.todoList.innerHTML = '';

  state.todos.forEach((todo) => {
    const li = document.createElement('li');
    li.className = `todo-item ${todo.completed ? 'is-completed' : ''}`;
    li.id = `todo-${todo.id}`;
    li.setAttribute('data-id', todo.id);

    const isOverdue = isDateOverdue(todo.dueDate, todo.completed);

    li.innerHTML = `
      <div class="todo-checkbox-wrapper">
        <input 
          type="checkbox" 
          class="custom-checkbox" 
          ${todo.completed ? 'checked' : ''} 
          aria-label="Mark task '${escapeHtml(todo.title)}' as ${todo.completed ? 'incomplete' : 'complete'}"
        >
      </div>
      <div class="todo-body">
        <div class="todo-header-line">
          <span class="todo-title" title="Click or Edit to modify">${escapeHtml(todo.title)}</span>
          <div class="todo-badges">
            <span class="badge badge-priority-${todo.priority}">${todo.priority}</span>
            ${todo.dueDate ? `
              <span class="badge badge-due-date ${isOverdue ? 'overdue' : ''}" title="${isOverdue ? 'Overdue!' : 'Due date'}">
                📅 ${formatDateDisplay(todo.dueDate)}${isOverdue ? ' (Overdue)' : ''}
              </span>
            ` : ''}
          </div>
        </div>
        ${todo.description ? `<p class="todo-description">${escapeHtml(todo.description)}</p>` : ''}
      </div>
      <div class="todo-actions">
        <button type="button" class="icon-btn edit-btn" aria-label="Edit task '${escapeHtml(todo.title)}'" title="Edit">
          ✏️
        </button>
        <button type="button" class="icon-btn delete-btn" aria-label="Delete task '${escapeHtml(todo.title)}'" title="Delete">
          🗑️
        </button>
      </div>
    `;

    // Event Handlers for item
    const checkbox = li.querySelector('.custom-checkbox');
    checkbox.addEventListener('change', () => handleToggleTodo(todo.id, !todo.completed));

    const editBtn = li.querySelector('.edit-btn');
    editBtn.addEventListener('click', () => openEditModal(todo));

    const deleteBtn = li.querySelector('.delete-btn');
    deleteBtn.addEventListener('click', () => handleDeleteTodo(todo.id, todo.title));

    elements.todoList.appendChild(li);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Action Handlers
async function handleCreateTodo(e) {
  e.preventDefault();
  const title = elements.todoTitleInput.value.trim();
  if (!title) return;

  const priority = elements.todoPriorityInput.value;
  const dueDate = elements.todoDueDateInput.value ? new Date(elements.todoDueDateInput.value).toISOString() : null;
  const description = elements.todoDescInput.value.trim();

  try {
    const payload = { title, priority, description };
    if (dueDate) payload.dueDate = dueDate;

    const res = await apiRequest('', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    elements.todoTitleInput.value = '';
    elements.todoDescInput.value = '';
    elements.todoDueDateInput.value = '';
    elements.todoPriorityInput.value = 'medium';

    showToast('Task added successfully', 'success');
    await fetchTodos();
  } catch (err) {
    showToast(`Error creating task: ${err.message}`, 'error');
  }
}

async function handleToggleTodo(id, newCompletedState) {
  try {
    await apiRequest(`/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ completed: newCompletedState }),
    });

    await fetchTodos();
  } catch (err) {
    showToast(`Failed to update status: ${err.message}`, 'error');
    await fetchTodos();
  }
}

async function handleDeleteTodo(id, title) {
  try {
    await apiRequest(`/${id}`, {
      method: 'DELETE',
    });

    showToast(`Deleted "${title}"`, 'info');
    await fetchTodos();
  } catch (err) {
    showToast(`Failed to delete task: ${err.message}`, 'error');
  }
}

async function handleToggleAll() {
  const shouldCompleteAll = state.stats.active > 0;
  try {
    await apiRequest('/toggle-all', {
      method: 'PATCH',
      body: JSON.stringify({ completed: shouldCompleteAll }),
    });

    showToast(shouldCompleteAll ? 'Marked all tasks as completed' : 'Marked all tasks as active', 'success');
    await fetchTodos();
  } catch (err) {
    showToast(`Failed to toggle all tasks: ${err.message}`, 'error');
  }
}

async function handleClearCompleted() {
  if (state.stats.completed === 0) return;

  try {
    const res = await apiRequest('/clear-completed', {
      method: 'POST',
    });

    showToast(`Cleared ${res.deletedCount || 0} completed tasks`, 'info');
    await fetchTodos();
  } catch (err) {
    showToast(`Failed to clear completed: ${err.message}`, 'error');
  }
}

// Modal Edit
function openEditModal(todo) {
  elements.editTodoId.value = todo.id;
  elements.editTodoTitle.value = todo.title;
  elements.editTodoPriority.value = todo.priority || 'medium';
  elements.editTodoDesc.value = todo.description || '';

  if (todo.dueDate) {
    const d = new Date(todo.dueDate);
    elements.editTodoDueDate.value = d.toISOString().split('T')[0];
  } else {
    elements.editTodoDueDate.value = '';
  }

  elements.editModal.showModal();
}

function closeEditModal() {
  elements.editModal.close();
}

async function handleSaveEdit(e) {
  e.preventDefault();
  const id = elements.editTodoId.value;
  const title = elements.editTodoTitle.value.trim();
  if (!title) return;

  const priority = elements.editTodoPriority.value;
  const description = elements.editTodoDesc.value.trim();
  const dueDate = elements.editTodoDueDate.value ? new Date(elements.editTodoDueDate.value).toISOString() : null;

  try {
    await apiRequest(`/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        title,
        priority,
        description,
        dueDate,
      }),
    });

    closeEditModal();
    showToast('Task updated successfully', 'success');
    await fetchTodos();
  } catch (err) {
    showToast(`Failed to update task: ${err.message}`, 'error');
  }
}

// Event Listeners Initialization
function initEventListeners() {
  // Create form
  elements.createTodoForm.addEventListener('submit', handleCreateTodo);

  // Toggle details fields in create form
  elements.toggleDetailsBtn.addEventListener('click', () => {
    const isCollapsed = elements.formExtraFields.classList.toggle('collapsed');
    elements.toggleDetailsBtn.setAttribute('aria-expanded', !isCollapsed);
    const icon = elements.toggleDetailsBtn.querySelector('.toggle-icon');
    if (icon) icon.textContent = isCollapsed ? '▸' : '▾';
  });

  // Filter tabs
  elements.filterTabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      elements.filterTabs.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter = btn.getAttribute('data-filter');
      fetchTodos();
    });
  });

  // Priority filter
  elements.priorityFilter.addEventListener('change', (e) => {
    state.priority = e.target.value;
    fetchTodos();
  });

  // Sort by
  elements.sortBySelect.addEventListener('change', (e) => {
    const [field, order] = e.target.value.split('-');
    state.sortBy = field;
    state.sortOrder = order;
    fetchTodos();
  });

  // Search input with debounce
  let searchTimeout;
  elements.searchInput.addEventListener('input', (e) => {
    const val = e.target.value;
    if (val.length > 0) {
      elements.clearSearchBtn.classList.remove('hidden');
    } else {
      elements.clearSearchBtn.classList.add('hidden');
    }

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.search = val.trim();
      fetchTodos();
    }, 250);
  });

  // Clear search
  elements.clearSearchBtn.addEventListener('click', () => {
    elements.searchInput.value = '';
    elements.clearSearchBtn.classList.add('hidden');
    state.search = '';
    fetchTodos();
  });

  // Bulk actions
  elements.toggleAllBtn.addEventListener('click', handleToggleAll);
  elements.clearCompletedBtn.addEventListener('click', handleClearCompleted);

  // Modal events
  elements.editTodoForm.addEventListener('submit', handleSaveEdit);
  elements.closeModalBtn.addEventListener('click', closeEditModal);
  elements.cancelEditBtn.addEventListener('click', closeEditModal);

  // Close modal when clicking outside
  elements.editModal.addEventListener('click', (e) => {
    if (e.target === elements.editModal) {
      closeEditModal();
    }
  });
}

// App Bootstrap
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  fetchTodos();
});
