import { api } from '../api.js';
import { coverMarkup, esc, spinner, emptyState, toast } from '../ui.js';

export async function renderDiscover({ mount }) {
  mount.innerHTML = `
    <div class="page-head">
      <h1>Discover</h1>
      <p class="muted small">Books other members have made public. Ask to borrow anything on the shelf.</p>
    </div>
    <div class="toolbar">
      <input class="grow" type="search" id="q" placeholder="Search public books…" />
      <select id="owner" aria-label="Filter by member"><option value="">All members</option></select>
    </div>
    <div id="results">${spinner()}</div>`;

  const results = mount.querySelector('#results');
  const ownerSel = mount.querySelector('#owner');

  try {
    const { users } = await api.users();
    ownerSel.insertAdjacentHTML(
      'beforeend',
      users.map((u) => `<option value="${u.id}">${esc(u.name)} (${u.publicBooks})</option>`).join('')
    );
  } catch {
    /* non-fatal */
  }

  let timer;
  mount.querySelector('#q').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(load, 250);
  });
  ownerSel.addEventListener('change', load);

  results.addEventListener('click', (e) => {
    const card = e.target.closest('[data-book]');
    if (card) location.hash = `#/book/${card.dataset.book}`;
  });

  async function load() {
    results.innerHTML = spinner();
    try {
      const { books } = await api.publicBooks({
        q: mount.querySelector('#q').value.trim(),
        ownerId: ownerSel.value
      });
      if (!books.length) {
        results.innerHTML = emptyState('&#128270;', 'Nothing to show yet', 'No public books match your search.');
        return;
      }
      results.innerHTML = `<div class="book-grid">${books.map(card).join('')}</div>`;
    } catch (err) {
      toast(err.message, 'error');
      results.innerHTML = emptyState('&#9888;', 'Could not load', err.message);
    }
  }

  await load();
}

function card(book) {
  const status =
    book.myLoan && ['requested', 'approved'].includes(book.myLoan.status)
      ? '<span class="pill on_loan">Requested</span>'
      : book.availability === 'on_loan'
        ? '<span class="pill on_loan">On loan</span>'
        : book.availability === 'available'
          ? '<span class="pill available">Available</span>'
          : '<span class="pill private">Not for lending</span>';

  return `<article class="book-card" data-book="${book.id}" tabindex="0">
    ${coverMarkup(book)}
    <div class="title">${esc(book.title)}</div>
    <div class="by">${esc(book.authors || 'Unknown author')}</div>
    <div class="row tight">${status}<span class="small muted">${esc(book.owner?.name || '')}</span></div>
  </article>`;
}
