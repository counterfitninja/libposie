/** Tiny DOM/UI helpers shared by every view. */

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function html(strings, ...values) {
  return strings.reduce((out, str, i) => out + str + (i < values.length ? values[i] ?? '' : ''), '');
}

export function toast(message, kind = '') {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 320);
  }, 3200);
}

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function relativeDays(dateStr) {
  if (!dateStr) return '';
  const due = new Date(dateStr.length === 10 ? `${dateStr}T00:00:00` : dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((due - today) / 86400000);
  if (diff === 0) return 'due today';
  if (diff > 0) return `due in ${diff} day${diff === 1 ? '' : 's'}`;
  return `${Math.abs(diff)} day${Math.abs(diff) === 1 ? '' : 's'} overdue`;
}

/**
 * Opens a modal. `render` receives a close() callback and returns inner HTML;
 * `onMount` wires up the modal's own event handlers.
 */
export function openModal({ title, body, footer = '', onMount, size }) {
  const root = document.getElementById('modalRoot');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = html`
    <div class="modal" role="dialog" aria-modal="true" ${size ? `style="max-width:${size}"` : ''}>
      <div class="modal-head">
        <h2>${esc(title)}</h2>
        <button class="icon-btn" data-close aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-actions">${footer}</div>` : ''}
    </div>`;

  const close = () => {
    backdrop.remove();
    document.body.style.overflow = '';
  };

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKey);
    }
  });

  root.appendChild(backdrop);
  document.body.style.overflow = 'hidden';
  onMount?.(backdrop.querySelector('.modal'), close);
  backdrop.querySelector('input, textarea, select, button')?.focus();
  return close;
}

export function confirmDialog(message, { confirmLabel = 'Confirm', danger = true } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const close = openModal({
      title: 'Are you sure?',
      body: `<p>${esc(message)}</p>`,
      footer: `<button class="btn ghost" data-close>Cancel</button>
               <button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(confirmLabel)}</button>`,
      onMount(modal) {
        modal.querySelector('[data-ok]').addEventListener('click', () => {
          settled = true;
          resolve(true);
          close();
        });
        modal.closest('.modal-backdrop').addEventListener('click', () => {
          setTimeout(() => { if (!settled) resolve(false); }, 0);
        });
      }
    });
  });
}

export function coverMarkup(book, className = 'cover') {
  const badge = book.isOwner && !book.isPublic ? '<span class="flag">Private</span>' : '';
  if (book.coverUrl) {
    return `<div class="${className}">${badge}<img src="${esc(book.coverUrl)}" alt="Cover of ${esc(book.title)}" loading="lazy" data-fallback="${esc(book.title || '')}"></div>`;
  }
  return `<div class="${className}">${badge}<div class="placeholder">${esc(book.title || 'No cover')}</div></div>`;
}

export function statusLabel(status) {
  return {
    requested: 'Requested',
    approved: 'Approved — awaiting handover',
    lent: 'On loan',
    return_requested: 'Return requested',
    returned: 'Returned',
    declined: 'Declined',
    cancelled: 'Withdrawn'
  }[status] || status;
}

export function spinner() {
  return '<div class="spinner" role="status" aria-label="Loading"></div>';
}

export function emptyState(icon, title, message, actionHtml = '') {
  return html`<div class="empty">
    <span class="big">${icon}</span>
    <h3>${esc(title)}</h3>
    <p class="small">${esc(message)}</p>
    ${actionHtml}
  </div>`;
}
