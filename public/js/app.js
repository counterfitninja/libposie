import { api } from './api.js';
import { toast, esc, spinner } from './ui.js';
import { renderAuth } from './views/auth.js';
import { renderLibrary } from './views/library.js';
import { renderBook } from './views/book.js';
import { renderScan } from './views/scan.js';
import { renderDiscover } from './views/discover.js';
import { renderBorrowing, renderLending } from './views/loans.js';
import { renderCategories } from './views/categories.js';
import { renderNotifications } from './views/notifications.js';
import { renderSettings } from './views/settings.js';
import { renderAdmin } from './views/admin.js';

export const state = {
  user: null,
  categories: [],
  unread: 0
};

const routes = {
  library: renderLibrary,
  book: renderBook,
  scan: renderScan,
  discover: renderDiscover,
  borrowing: renderBorrowing,
  lending: renderLending,
  categories: renderCategories,
  notifications: renderNotifications,
  settings: renderSettings,
  admin: renderAdmin
};

const viewEl = () => document.getElementById('view');
let cleanup = null;

export function navigate(hash) {
  if (location.hash === hash) router();
  else location.hash = hash;
}

export function setView(markup) {
  viewEl().innerHTML = markup;
}

export async function refreshCategories() {
  try {
    state.categories = (await api.categories()).categories;
  } catch {
    state.categories = [];
  }
  return state.categories;
}

async function router() {
  if (!state.user) return;

  const [name, param] = (location.hash.replace(/^#\/?/, '') || 'library').split('/');
  const render = routes[name] || renderLibrary;

  cleanup?.();
  cleanup = null;

  document.querySelectorAll('[data-route]').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === name);
  });
  document.getElementById('sidenav')?.classList.remove('open');

  setView(spinner());
  try {
    cleanup = (await render({ param, mount: viewEl() })) || null;
  } catch (err) {
    setView(`<div class="empty"><h3>Could not load this page</h3><p class="small">${esc(err.message)}</p></div>`);
  }
  viewEl().scrollTo?.(0, 0);
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------ shell wiring */

function showApp(show) {
  document.getElementById('app').hidden = !show;
  document.getElementById('authScreen').hidden = show;
}

export async function onSignedIn(user) {
  // The login/register responses carry only the public fields; fetch the rest.
  state.user = user;
  try {
    state.user = { ...user, ...(await api.me()).user };
  } catch {
    /* keep the partial profile */
  }
  document.getElementById('adminLink').hidden = !state.user.isAdmin;
  showApp(true);
  await refreshCategories();
  await pollNotifications();
  registerServiceWorker();
  if (!location.hash) location.hash = '#/library';
  router();
}

async function signOut() {
  await api.logout().catch(() => {});
  state.user = null;
  showApp(false);
  renderAuth();
}

export async function pollNotifications() {
  if (!state.user) return;
  try {
    const { unread } = await api.notifications();
    state.unread = unread;
    const badge = document.getElementById('notifBadge');
    badge.textContent = unread > 99 ? '99+' : unread;
    badge.hidden = unread === 0;
  } catch {
    /* offline */
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

/** Ask for notification permission and store the push subscription. */
export async function enablePushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('This browser does not support push notifications.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api.pushKey();
  if (!publicKey) throw new Error('Push is not configured on this server.');

  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    }));

  await api.subscribePush(sub.toJSON());
  return true;
}

export async function disablePushNotifications() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api.unsubscribePush(sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  }
}

export async function pushEnabled() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/* ---------------------------------------------------------------- startup */

document.getElementById('logoutBtn').addEventListener('click', signOut);
document.getElementById('bellBtn').addEventListener('click', () => navigate('#/notifications'));
document.getElementById('navToggle').addEventListener('click', () => {
  document.getElementById('sidenav').classList.toggle('open');
});

// Replace broken remote cover images with a text placeholder (CSP-safe).
document.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG' || !img.dataset.fallback) return;
    const div = document.createElement('div');
    div.className = 'placeholder';
    div.textContent = img.dataset.fallback || 'No cover';
    img.replaceWith(div);
  },
  true
);

window.addEventListener('hashchange', router);
window.addEventListener('focus', pollNotifications);
setInterval(pollNotifications, 60000);

navigator.serviceWorker?.addEventListener('message', (event) => {
  if (event.data?.type === 'notification') {
    pollNotifications();
    toast(event.data.title || 'New notification');
  }
});

(async function boot() {
  try {
    const { user } = await api.me();
    if (user) await onSignedIn(user);
    else {
      showApp(false);
      renderAuth();
    }
  } catch {
    showApp(false);
    renderAuth();
  }
})();
