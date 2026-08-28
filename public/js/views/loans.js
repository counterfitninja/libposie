import { api } from '../api.js';
import { state } from '../app.js';
import {
  esc, spinner, toast, emptyState, formatDate, relativeDays, statusLabel, coverMarkup, openModal, confirmDialog
} from '../ui.js';

const ACTIVE = ['requested', 'approved', 'lent', 'return_requested'];

/* --------------------------------------------------------------- borrowing */

export async function renderBorrowing({ mount }) {
  mount.innerHTML = `
    <div class="page-head">
      <h1>Borrowing</h1>
      <p class="muted small">Books you have asked for or currently have.</p>
    </div>
    <div id="results">${spinner()}</div>`;

  const results = mount.querySelector('#results');

  async function load() {
    const { loans } = await api.borrowing();
    const open = loans.filter((l) => ACTIVE.includes(l.status));
    const past = loans.filter((l) => !ACTIVE.includes(l.status));

    results.innerHTML = open.length || past.length
      ? `
        <h2>Current</h2>
        ${open.length ? `<div class="list">${open.map((l) => row(l, 'borrower')).join('')}</div>`
                      : '<p class="small muted">Nothing on loan to you right now.</p>'}
        ${past.length ? `<div class="section"><h2>Past</h2><div class="list">${past.map((l) => row(l, 'borrower')).join('')}</div></div>` : ''}`
      : emptyState('&#128230;', 'No loans yet', 'Find something to read in Discover.',
          '<a class="btn primary" href="#/discover" style="margin-top:.6rem">Browse public books</a>');

    wire(results, load);
  }

  await load();
}

/* ----------------------------------------------------------------- lending */

export async function renderLending({ mount }) {
  mount.innerHTML = `
    <div class="page-head">
      <h1>Lending desk</h1>
      <p class="muted small">Manage requests, see who has your books and chase them back.</p>
    </div>
    <div id="results">${spinner()}</div>`;

  const results = mount.querySelector('#results');

  async function load() {
    const { loans } = await api.lending();
    const requests = loans.filter((l) => l.status === 'requested');
    const out = loans.filter((l) => ['approved', 'lent', 'return_requested'].includes(l.status));
    const overdue = out.filter((l) => l.overdue);
    const past = loans.filter((l) => !ACTIVE.includes(l.status));

    results.innerHTML = `
      <div class="row" style="margin-bottom:1rem">
        ${stat('Pending requests', requests.length)}
        ${stat('Out on loan', out.length)}
        ${stat('Overdue', overdue.length, overdue.length ? 'var(--accent)' : '')}
      </div>

      <h2>Requests</h2>
      ${requests.length ? `<div class="list">${requests.map((l) => row(l, 'owner')).join('')}</div>`
                        : '<p class="small muted">No one is waiting on a book.</p>'}

      <div class="section"><h2>Out on loan</h2>
        ${out.length ? `<div class="list">${out.map((l) => row(l, 'owner')).join('')}</div>`
                     : '<p class="small muted">All of your books are on the shelf.</p>'}</div>

      ${past.length ? `<div class="section"><h2>History</h2><div class="list">${past.slice(0, 25).map((l) => row(l, 'owner')).join('')}</div></div>` : ''}`;

    wire(results, load);
  }

  await load();
}

/* ------------------------------------------------------------------ pieces */

function stat(label, value, colour) {
  return `<div class="card" style="flex:1;min-width:110px;text-align:center">
    <div style="font-size:1.6rem;font-family:var(--font-display);${colour ? `color:${colour}` : ''}">${value}</div>
    <div class="small muted">${esc(label)}</div>
  </div>`;
}

function row(loan, perspective) {
  const other = perspective === 'owner' ? loan.borrower : loan.owner;
  const overdue = loan.overdue;

  return `<div class="list-item">
    ${coverMarkup({ coverUrl: loan.coverUrl, title: loan.bookTitle }, 'thumb')}
    <div>
      <div class="spread">
        <div>
          <a href="#/book/${loan.bookId}"><strong>${esc(loan.bookTitle)}</strong></a>
          <div class="small muted">${perspective === 'owner' ? 'Borrower' : 'Owner'}: ${esc(other?.name || 'Unknown')}</div>
        </div>
        <span class="pill ${overdue ? 'overdue' : ACTIVE.includes(loan.status) ? 'on_loan' : 'private'}">${esc(statusLabel(loan.status))}</span>
      </div>
      <div class="small muted" style="margin-top:.25rem">
        ${loan.lentAt ? `Lent ${formatDate(loan.lentAt)}` : `Requested ${formatDate(loan.requestedAt)}`}
        ${loan.dueAt && ACTIVE.includes(loan.status) ? ` · due ${formatDate(loan.dueAt)} (${esc(relativeDays(loan.dueAt))})` : ''}
        ${loan.returnedAt ? ` · returned ${formatDate(loan.returnedAt)}` : ''}
      </div>
      ${loan.message && loan.status === 'requested' ? `<p class="small" style="margin:.35rem 0 0">“${esc(loan.message)}”</p>` : ''}
      <div class="row tight" style="margin-top:.5rem">${actions(loan, perspective)}</div>
    </div>
  </div>`;
}

function actions(loan, perspective) {
  const btn = (action, label, cls = '') =>
    `<button class="btn sm ${cls}" data-action="${action}" data-id="${loan.id}" data-title="${esc(loan.bookTitle)}">${label}</button>`;

  if (perspective === 'owner') {
    if (loan.status === 'requested') return btn('approve', 'Approve &amp; lend', 'primary') + btn('decline', 'Decline');
    if (loan.status === 'approved') return btn('lend', 'Mark handed over', 'primary') + btn('return', 'Cancel loan');
    if (loan.status === 'lent') return btn('request-return', 'Ask for it back') + btn('extend', 'Extend') + btn('return', 'Mark returned', 'primary');
    if (loan.status === 'return_requested') return btn('request-return', 'Chase again') + btn('return', 'Mark returned', 'primary');
    return '';
  }

  if (loan.status === 'requested' || loan.status === 'approved') return btn('cancel', 'Withdraw request');
  if (['lent', 'return_requested'].includes(loan.status)) return btn('returned-notice', "I've returned it");
  return '';
}

function wire(root, reload) {
  root.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { action, id, title } = btn.dataset;
      try {
        if (action === 'approve') return approveModal(Number(id), title, reload);
        if (action === 'extend') return extendModal(Number(id), reload);
        if (action === 'decline' && !(await confirmDialog(`Decline the request for "${title}"?`, { confirmLabel: 'Decline' }))) return;
        if (action === 'return' && !(await confirmDialog(`Mark "${title}" as back on your shelf?`, { confirmLabel: 'Confirm return', danger: false }))) return;

        btn.disabled = true;
        await api.loanAction(Number(id), action);
        toast('Updated', 'success');
        await reload();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });
}

function approveModal(id, title, reload) {
  const defaultDays = state.user?.loanDays || 28;
  openModal({
    title: `Lend "${title}"`,
    body: `
      <div class="field">
        <label for="days">Loan period (days)</label>
        <input id="days" type="number" min="1" max="365" value="${defaultDays}" />
        <span class="hint">Reminders are sent as the due date approaches and once it passes.</span>
      </div>
      <label class="switch"><input type="checkbox" id="handed" checked /><span>The book has been handed over</span></label>
      <p class="hint">Leave this off to approve now and start the clock when you actually pass it on.</p>`,
    footer: `<button class="btn ghost" data-close>Cancel</button>
             <button class="btn primary" data-ok>Approve</button>`,
    onMount(modal, close) {
      modal.querySelector('[data-ok]').addEventListener('click', async () => {
        try {
          await api.loanAction(id, 'approve', {
            days: Number(modal.querySelector('#days').value),
            handedOver: modal.querySelector('#handed').checked
          });
          close();
          toast('Loan approved', 'success');
          await reload();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }
  });
}

function extendModal(id, reload) {
  openModal({
    title: 'Extend the loan',
    body: `<div class="field"><label for="exDays">Extra days</label>
      <input id="exDays" type="number" min="1" max="365" value="14" /></div>`,
    footer: `<button class="btn ghost" data-close>Cancel</button>
             <button class="btn primary" data-ok>Extend</button>`,
    onMount(modal, close) {
      modal.querySelector('[data-ok]').addEventListener('click', async () => {
        try {
          await api.loanAction(id, 'extend', { days: Number(modal.querySelector('#exDays').value) });
          close();
          toast('Due date updated', 'success');
          await reload();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }
  });
}
