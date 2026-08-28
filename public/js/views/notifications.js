import { api } from '../api.js';
import { pollNotifications } from '../app.js';
import { esc, formatDate, toast, emptyState, confirmDialog } from '../ui.js';

export async function renderNotifications({ mount }) {
  const { notifications } = await api.notifications();

  mount.innerHTML = `
    <div class="page-head spread">
      <div>
        <h1>Notifications</h1>
        <p class="muted small">Loan requests, returns and reminders.</p>
      </div>
      <div class="row tight">
        <button class="btn sm" id="markAll">Mark all read</button>
        <button class="btn sm danger" id="clear">Clear</button>
      </div>
    </div>
    ${notifications.length
      ? `<div class="list">${notifications.map((n) => `
          <a class="list-item" style="grid-template-columns:1fr" href="${esc(n.link || '#/library')}"
             ${n.read ? '' : 'data-unread="1"'}>
            <div>
              <div class="spread">
                <strong>${esc(n.title)}</strong>
                ${n.read ? '' : '<span class="pill public">New</span>'}
              </div>
              <div class="small">${esc(n.body || '')}</div>
              <div class="small muted">${formatDate(n.createdAt)}</div>
            </div>
          </a>`).join('')}</div>`
      : emptyState('&#128276;', 'All quiet', 'Nothing needs your attention.')}`;

  mount.querySelector('#markAll').addEventListener('click', async () => {
    await api.markRead();
    await pollNotifications();
    toast('All marked as read', 'success');
    await renderNotifications({ mount });
  });

  mount.querySelector('#clear').addEventListener('click', async () => {
    if (!(await confirmDialog('Delete all notifications?', { confirmLabel: 'Clear all' }))) return;
    await api.clearNotifications();
    await pollNotifications();
    await renderNotifications({ mount });
  });

  // Opening the page counts as reading it.
  if (notifications.some((n) => !n.read)) {
    await api.markRead().catch(() => {});
    await pollNotifications();
  }
}
