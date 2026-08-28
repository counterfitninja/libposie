import { api } from '../api.js';
import { state, refreshCategories } from '../app.js';
import { coverMarkup, esc, emptyState, spinner, toast } from '../ui.js';

const filters = { q: '', category: '', availability: '', visibility: '', sort: 'recent' };

export async function renderLibrary({ mount }) {
  await refreshCategories();

  mount.innerHTML = `
    <div class="page-head spread">
      <div>
        <h1>My library</h1>
        <p class="muted small" id="countLine">Loading your shelves…</p>
      </div>
      <a class="btn primary" href="#/scan">+ Add a book</a>
    </div>

    <div class="toolbar">
      <input class="grow" type="search" id="q" placeholder="Search title, author, ISBN…" value="${esc(filters.q)}" />
      <select id="sort" aria-label="Sort by">
        <option value="recent">Recently added</option>
        <option value="title">Title A–Z</option>
        <option value="author">Author A–Z</option>
      </select>
    </div>

    <div class="row tight" id="chips" style="margin-bottom:1rem"></div>
    <div id="results">${spinner()}</div>`;

  const results = mount.querySelector('#results');
  const chipsEl = mount.querySelector('#chips');
  mount.querySelector('#sort').value = filters.sort;

  function drawChips() {
    const chip = (key, value, label, extra = '') =>
      `<button class="chip ${filters[key] === value ? 'on' : ''}" data-key="${key}" data-value="${esc(value)}">${extra}${esc(label)}</button>`;

    chipsEl.innerHTML = [
      chip('availability', '', 'All'),
      chip('availability', 'available', 'On the shelf'),
      chip('availability', 'on_loan', 'On loan'),
      chip('visibility', 'public', 'Public'),
      chip('visibility', 'private', 'Private'),
      ...state.categories.map((c) =>
        chip('category', String(c.id), `${c.name} (${c.bookCount})`, `<span class="dot" style="background:${esc(c.colour)}"></span>`)
      )
    ].join('');
  }

  chipsEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const { key, value } = chip.dataset;
    filters[key] = filters[key] === value ? '' : value;
    drawChips();
    load();
  });

  let timer;
  mount.querySelector('#q').addEventListener('input', (e) => {
    filters.q = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(load, 250);
  });
  mount.querySelector('#sort').addEventListener('change', (e) => {
    filters.sort = e.target.value;
    load();
  });

  async function load() {
    results.innerHTML = spinner();
    try {
      const { books } = await api.books(filters);
      mount.querySelector('#countLine').textContent =
        `${books.length} book${books.length === 1 ? '' : 's'}${filters.q || filters.category || filters.availability || filters.visibility ? ' matching your filters' : ' on your shelves'}`;

      if (!books.length) {
        results.innerHTML = emptyState(
          '&#128218;',
          'Nothing here yet',
          'Scan an ISBN or search by title to add your first book.',
          '<a class="btn primary" href="#/scan" style="margin-top:.6rem">Add a book</a>'
        );
        return;
      }
      results.innerHTML = `<div class="book-grid">${books.map(card).join('')}</div>`;
    } catch (err) {
      toast(err.message, 'error');
      results.innerHTML = emptyState('&#9888;', 'Could not load your library', err.message);
    }
  }

  results.addEventListener('click', (e) => {
    const card = e.target.closest('[data-book]');
    if (card) location.hash = `#/book/${card.dataset.book}`;
  });

  drawChips();
  await load();
}

function card(book) {
  const cats = book.categories
    .slice(0, 2)
    .map((c) => `<span class="chip" style="border-color:${esc(c.colour)}">${esc(c.name)}</span>`)
    .join('');
  const loanLine =
    book.availability === 'on_loan' && book.activeLoan
      ? `<span class="pill ${book.activeLoan.overdue ? 'overdue' : 'on_loan'}">${
          book.activeLoan.overdue ? 'Overdue' : 'On loan'
        }</span> <span class="small muted">${esc(book.activeLoan.borrower?.name || '')}</span>`
      : '';

  return `<article class="book-card" data-book="${book.id}" tabindex="0">
    ${coverMarkup(book)}
    <div class="title">${esc(book.title)}</div>
    <div class="by">${esc(book.authors || 'Unknown author')}</div>
    <div class="row tight">${loanLine}${cats}</div>
  </article>`;
}
