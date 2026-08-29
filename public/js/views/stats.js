import { api } from '../api.js';
import { esc } from '../ui.js';

export async function renderStats({ mount }) {
  const { stats } = await api.userStats();

  mount.innerHTML = `
    <div class="page-head">
      <h1>Stats</h1>
      <p class="muted small">A quick snapshot of your library and lending activity.</p>
    </div>

    <div class="row" style="margin-bottom:1.2rem">
      ${stat('Books', stats.books)}
      ${stat('Public', stats.publicBooks)}
      ${stat('Categories', stats.categories)}
      ${stat('Available', stats.availableBooks)}
    </div>

    <div class="row" style="margin-bottom:1.2rem">
      ${stat('Active loans', stats.activeLoans)}
      ${stat('Pending requests', stats.pendingRequests)}
      ${stat('Overdue', stats.overdueLoans)}
      ${stat('Borrowing', stats.borrowingCount)}
    </div>

    <div class="card">
      <h2>Library highlights</h2>
      <p class="small muted">
        You currently have ${stats.books} book${stats.books === 1 ? '' : 's'} across ${stats.categories} categor${stats.categories === 1 ? 'y' : 'ies'}.
        ${stats.publicBooks} are shared publicly, ${stats.activeLoans} are currently out on loan, and ${stats.overdueLoans} loan${stats.overdueLoans === 1 ? '' : 's'} need attention.
      </p>
    </div>`;
}

function stat(label, value) {
  return `<div class="card" style="flex:1;min-width:100px;text-align:center">
    <div style="font-size:1.6rem;font-family:var(--font-display)">${value}</div>
    <div class="small muted">${esc(label)}</div>
  </div>`;
}
