async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const qs = (params) => {
  const s = new URLSearchParams(
    Object.entries(params || {}).filter(([, v]) => v !== '' && v != null)
  ).toString();
  return s ? `?${s}` : '';
};

export const api = {
  me: () => request('GET', '/auth/me'),
  login: (payload) => request('POST', '/auth/login', payload),
  register: (payload) => request('POST', '/auth/register', payload),
  logout: () => request('POST', '/auth/logout'),
  updateProfile: (payload) => request('PUT', '/auth/profile', payload),
  changePassword: (payload) => request('PUT', '/auth/password', payload),

  books: (filters) => request('GET', `/books${qs(filters)}`),
  publicBooks: (filters) => request('GET', `/books/public${qs(filters)}`),
  book: (id) => request('GET', `/books/${id}`),
  createBook: (payload) => request('POST', '/books', payload),
  updateBook: (id, payload) => request('PUT', `/books/${id}`, payload),
  deleteBook: (id) => request('DELETE', `/books/${id}`),

  addNote: (bookId, payload) => request('POST', `/books/${bookId}/notes`, payload),
  updateNote: (bookId, noteId, payload) => request('PUT', `/books/${bookId}/notes/${noteId}`, payload),
  deleteNote: (bookId, noteId) => request('DELETE', `/books/${bookId}/notes/${noteId}`),

  categories: () => request('GET', '/categories'),
  createCategory: (payload) => request('POST', '/categories', payload),
  updateCategory: (id, payload) => request('PUT', `/categories/${id}`, payload),
  deleteCategory: (id) => request('DELETE', `/categories/${id}`),

  lookup: (q) => request('GET', `/lookup${qs({ q })}`),

  borrowing: () => request('GET', '/loans/borrowing'),
  lending: () => request('GET', '/loans/lending'),
  requestLoan: (payload) => request('POST', '/loans', payload),
  manualLoan: (payload) => request('POST', '/loans/manual', payload),
  loanAction: (id, action, payload) => request('POST', `/loans/${id}/${action}`, payload || {}),

  notifications: () => request('GET', '/notifications'),
  markRead: (ids) => request('POST', '/notifications/read', { ids }),
  clearNotifications: () => request('DELETE', '/notifications'),
  pushKey: () => request('GET', '/notifications/push/key'),
  subscribePush: (sub) => request('POST', '/notifications/push/subscribe', sub),
  unsubscribePush: (endpoint) => request('POST', '/notifications/push/unsubscribe', { endpoint }),

  users: () => request('GET', '/users'),
  userDirectory: () => request('GET', '/users/directory'),
  adminOverview: () => request('GET', '/users/admin/overview'),
  adminUpdateUser: (id, payload) => request('PUT', `/users/admin/${id}`, payload),
  adminDeleteUser: (id) => request('DELETE', `/users/admin/${id}`),
  runReminders: () => request('POST', '/admin/run-reminders')
};
