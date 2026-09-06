import { api } from '../api.js';
import { state, refreshCategories } from '../app.js';
import { coverMarkup, esc, emptyState, spinner, toast } from '../ui.js';

const SORT_PREFERENCE_KEY = 'libposie.librarySort';
const SORT_OPTIONS = ['recent', 'title', 'author'];
const savedSort = localStorage.getItem(SORT_PREFERENCE_KEY);
const filters = {
  q: '', category: '', availability: '', visibility: '',
  sort: SORT_OPTIONS.includes(savedSort) ? savedSort : 'title'
};

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
    localStorage.setItem(SORT_PREFERENCE_KEY, filters.sort);
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

      if (filters.sort === 'title' || filters.sort === 'author') {
        renderShelfWithIndex(books);
      } else {
        results.innerHTML = `<div class="book-grid">${books.map(card).join('')}</div>`;
      }
    } catch (err) {
      toast(err.message, 'error');
      results.innerHTML = emptyState('&#9888;', 'Could not load your library', err.message);
    }
  }

  results.addEventListener('click', (e) => {
    const card = e.target.closest('[data-book]');
    if (!card) return;
    state.libraryScroll = {
      viewX: mount.scrollLeft,
      viewY: mount.scrollTop,
      windowX: window.scrollX,
      windowY: window.scrollY
    };
    location.hash = `#/book/${card.dataset.book}`;
  });

  function renderShelfWithIndex(books) {
    const sections = [];
    let current = null;
    for (const b of books) {
      const letter = groupLetter(b);
      if (!current || current.letter !== letter) {
        current = { letter, books: [] };
        sections.push(current);
      }
      current.books.push(b);
    }
    const present = new Set(sections.map((s) => s.letter));

    const sectionsHtml = sections
      .map(
        (s) => `<div class="letter-header" id="${sectionId(s.letter)}" data-letter="${s.letter}">${s.letter}</div>
      <div class="book-grid">${s.books.map(card).join('')}</div>`
      )
      .join('');

    const azHtml = ALPHABET.map(
      (l) => `<button type="button" data-letter="${l}" ${present.has(l) ? '' : 'disabled'}>${l}</button>`
    ).join('');

    results.innerHTML = `<div class="shelf-layout">
      <div class="shelf-main">${sectionsHtml}</div>
      <nav class="az-index" aria-label="Jump to letter">${azHtml}</nav>
    </div>`;

    const az = results.querySelector('.az-index');
    az.querySelectorAll('button[data-letter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        results.querySelector(`#${sectionId(btn.dataset.letter)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    setupScrollSpy(results, az);
  }

  drawChips();
  await load();
}

function groupLetter(book) {
  const src = (filters.sort === 'author' ? book.authors : book.title) || '';
  const ch = src.trim().charAt(0).toUpperCase();
  return ch >= 'A' && ch <= 'Z' ? ch : '#';
}

function sectionId(letter) {
  return `shelf-${letter === '#' ? 'hash' : letter}`;
}

const ALPHABET = ['#', ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))];

function setupScrollSpy(container, az) {
  const headers = [...container.querySelectorAll('.letter-header')];
  if (!headers.length) return;
  const buttons = new Map([...az.querySelectorAll('button[data-letter]')].map((b) => [b.dataset.letter, b]));
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        buttons.forEach((b) => b.classList.remove('active'));
        buttons.get(entry.target.dataset.letter)?.classList.add('active');
      });
    },
    { rootMargin: '-10% 0px -80% 0px', threshold: 0 }
  );
  headers.forEach((h) => observer.observe(h));
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
