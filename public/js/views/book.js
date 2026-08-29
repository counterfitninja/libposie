import { api } from '../api.js';
import { state, refreshCategories, navigate } from '../app.js';
import {
  coverMarkup, esc, formatDate, relativeDays, openModal, confirmDialog, toast, statusLabel, spinner
} from '../ui.js';

export async function renderBook({ param, mount }) {
  const bookId = Number(param);
  let book;
  try {
    book = (await api.book(bookId)).book;
  } catch (err) {
    mount.innerHTML = `<div class="empty"><h3>Book not available</h3><p class="small">${esc(err.message)}</p>
      <a class="btn" href="#/library">Back to library</a></div>`;
    return;
  }

  await refreshCategories();
  draw();

  function draw() {
    mount.innerHTML = `
      <button class="linkish" id="back">&larr; Back</button>

      <div class="detail-head">
        ${coverMarkup(book)}
        <div>
          <h1>${esc(book.title)}</h1>
          ${book.subtitle ? `<p class="muted">${esc(book.subtitle)}</p>` : ''}
          <p><strong>${esc(book.authors || 'Unknown author')}</strong></p>
          <div class="row tight">
            ${availabilityPill(book)}
            ${book.isOwner ? `<span class="pill ${book.isPublic ? 'public' : 'private'}">${book.isPublic ? 'Public' : 'Private'}</span>` : ''}
            ${!book.isOwner && book.owner ? `<span class="small muted">from ${esc(book.owner.name)}'s library</span>` : ''}
          </div>
          <div class="row" style="margin-top:.8rem">${actionButtons(book)}</div>
        </div>
      </div>

      ${book.isOwner && book.categories.length
        ? `<div class="row tight" style="margin-bottom:1rem">${book.categories
            .map((c) => `<span class="chip" style="border-color:${esc(c.colour)}"><span class="dot" style="background:${esc(c.colour)}"></span>${esc(c.name)}</span>`)
            .join('')}</div>`
        : ''}

      <div class="meta-grid card">
        ${meta('Publisher', book.publisher)}
        ${meta('Published', book.publishedDate)}
        ${meta('ISBN-13', book.isbn13)}
        ${meta('ISBN-10', book.isbn10)}
        ${meta('Pages', book.pageCount)}
        ${meta('Language', book.language)}
        ${book.isOwner ? meta('Shelf', book.shelf) : ''}
        ${book.isOwner ? meta('Condition', book.condition) : ''}
        ${meta('Source', book.source)}
      </div>

      ${book.description ? `<div class="section"><h2>Description</h2><p>${esc(book.description)}</p></div>` : ''}

      ${book.isOwner ? lendingPanel(book) : ''}

      <div class="section">
        <h2>Notes <button class="btn sm" id="addNote">+ Add note</button></h2>
        <div class="stack" id="notes">${notesMarkup(book)}</div>
      </div>`;

    mount.querySelector('#back').addEventListener('click', () => history.back());
    mount.querySelector('#addNote').addEventListener('click', () => noteModal());
    mount.querySelector('#editBook')?.addEventListener('click', editModal);
    mount.querySelector('#deleteBook')?.addEventListener('click', remove);
    mount.querySelector('#requestViaWhatsApp')?.addEventListener('click', requestViaWhatsApp);
    mount.querySelector('#requestLoan')?.addEventListener('click', requestLoan);
    mount.querySelector('#manualLoan')?.addEventListener('click', manualLoanModal);
    mount.querySelector('#cancelRequest')?.addEventListener('click', () => loanAction(book.myLoan.id, 'cancel'));
    mount.querySelector('#returnedNotice')?.addEventListener('click', () => loanAction(book.myLoan.id, 'returned-notice'));

    mount.querySelector('#notes').addEventListener('click', async (e) => {
      const edit = e.target.closest('[data-edit-note]');
      const del = e.target.closest('[data-del-note]');
      if (edit) {
        const note = book.notes.find((n) => n.id === Number(edit.dataset.editNote));
        noteModal(note);
      }
      if (del) {
        if (!(await confirmDialog('Delete this note permanently?', { confirmLabel: 'Delete' }))) return;
        await api.deleteNote(book.id, Number(del.dataset.delNote));
        toast('Note deleted', 'success');
        await reload();
      }
    });

    mount.querySelectorAll('[data-loan-action]').forEach((btn) => {
      btn.addEventListener('click', () => loanAction(Number(btn.dataset.loanId), btn.dataset.loanAction));
    });
  }

  async function reload() {
    book = (await api.book(bookId)).book;
    draw();
  }

  /* ------------------------------------------------------------- actions */

  async function loanAction(id, action, payload) {
    try {
      await api.loanAction(id, action, payload);
      toast('Done', 'success');
      await reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function requestLoan() {
    openModal({
      title: `Request "${book.title}"`,
      body: `<div class="field">
          <label for="msg">Message to ${esc(book.owner?.name || 'the owner')} (optional)</label>
          <textarea id="msg" placeholder="When would you like to collect it?"></textarea>
        </div>`,
      footer: `<button class="btn ghost" data-close>Cancel</button>
               <button class="btn primary" data-send>Send request</button>`,
      onMount(modal, close) {
        modal.querySelector('[data-send]').addEventListener('click', async () => {
          try {
            await api.requestLoan({ bookId: book.id, message: modal.querySelector('#msg').value });
            close();
            toast('Request sent to the owner', 'success');
            await reload();
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      }
    });
  }

  async function manualLoanModal() {
    let members = [];
    try {
      members = (await api.userDirectory()).users;
    } catch {
      /* directory is a nice-to-have; fall back to free text only */
    }

    openModal({
      title: `Loan "${book.title}"Loan`,
      body: `<div class="field">
          <label for="mlName">Borrower's name</label>
          <input id="mlName" list="mlMembers" placeholder="Type a name, or pick a member" autocomplete="off" />
          <datalist id="mlMembers">
            ${members.map((m) => `<option value="${esc(m.name)}"></option>`).join('')}
          </datalist>
          <p class="hint">${members.length ? "Pick an existing member to notify them, or type any other name." : 'Type the name of who is borrowing it.'}</p>
        </div>
        <div class="field">
          <label for="mlDays">Loan length (days)</label>
          <input id="mlDays" type="number" min="1" max="365" value="${state.user?.loanDays || 28}" />
        </div>
        <div class="field">
          <label for="mlNotes">Notes (optional)</label>
          <textarea id="mlNotes" placeholder="Contact details, where they live, why they borrowed it…"></textarea>
        </div>
        <p class="hint">Use this to skip the request flow — members you pick get notified as usual, but names you type won't be.</p>`,
      footer: `<button class="btn ghost" data-close>Cancel</button>
               <button class="btn primary" data-lend>Lend it out</button>`,
      onMount(modal, close) {
        modal.querySelector('[data-lend]').addEventListener('click', async () => {
          const typed = modal.querySelector('#mlName').value.trim();
          if (!typed) return toast('Enter a name for the borrower', 'error');
          const match = members.find((m) => m.name.toLowerCase() === typed.toLowerCase());
          try {
            await api.manualLoan({
              bookId: book.id,
              borrowerId: match?.id,
              borrowerName: match ? undefined : typed,
              days: Number(modal.querySelector('#mlDays').value) || undefined,
              notes: modal.querySelector('#mlNotes').value
            });
            close();
            toast('Book marked as on loan', 'success');
            await reload();
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      }
    });
  }

  async function remove() {
    if (!(await confirmDialog(`Remove "${book.title}" from your library? This also deletes its notes and loan history.`, { confirmLabel: 'Delete book' }))) return;
    await api.deleteBook(book.id);
    toast('Book removed', 'success');
    navigate('#/library');
  }

  function requestViaWhatsApp() {
    const bookUrl = new URL(`#/book/${book.id}`, window.location.href).href;
    const message = `Hi ${book.owner?.name || ''}, could I borrow "${book.title}"? ${bookUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  }

  function noteModal(existing) {
    openModal({
      title: existing ? 'Edit note' : 'New note',
      body: `
        <div class="field">
          <label for="noteBody">Note</label>
          <textarea id="noteBody" placeholder="Thoughts, quotes, where you bought it…">${esc(existing?.body || '')}</textarea>
        </div>
        <label class="switch">
          <input type="checkbox" id="notePublic" ${existing?.visibility === 'public' ? 'checked' : ''} />
          <span>Public note</span>
        </label>
        <p class="hint">Public notes are visible to anyone who can see this book. Private notes are only ever visible to you.</p>`,
      footer: `<button class="btn ghost" data-close>Cancel</button>
               <button class="btn primary" data-save>${existing ? 'Save note' : 'Add note'}</button>`,
      onMount(modal, close) {
        modal.querySelector('[data-save]').addEventListener('click', async () => {
          const payload = {
            body: modal.querySelector('#noteBody').value,
            visibility: modal.querySelector('#notePublic').checked ? 'public' : 'private'
          };
          try {
            if (existing) await api.updateNote(book.id, existing.id, payload);
            else await api.addNote(book.id, payload);
            close();
            toast('Note saved', 'success');
            await reload();
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      }
    });
  }

  function editModal() {
    const field = (id, label, value, type = 'text') =>
      `<div class="field"><label for="${id}">${label}</label>
        <input id="${id}" type="${type}" value="${esc(value ?? '')}" /></div>`;

    openModal({
      title: 'Edit book details',
      body: `
        <div class="field">
          <button type="button" class="btn ghost" id="lookupMeta">Look up metadata…</button>
          <p class="hint">Re-query Google Books, Open Library and ISBNdb and pick a source's record — useful if the cover or details are wrong or missing.</p>
        </div>
        <div id="lookupResults"></div>
        ${field('f_title', 'Title', book.title)}
        ${field('f_subtitle', 'Subtitle', book.subtitle)}
        ${field('f_authors', 'Authors', book.authors)}
        ${field('f_publisher', 'Publisher', book.publisher)}
        ${field('f_publishedDate', 'Published', book.publishedDate)}
        ${field('f_isbn13', 'ISBN-13', book.isbn13)}
        ${field('f_isbn10', 'ISBN-10', book.isbn10)}
        ${field('f_pageCount', 'Pages', book.pageCount, 'number')}
        ${field('f_language', 'Language', book.language)}
        ${field('f_shelf', 'Shelf / location', book.shelf)}
        ${field('f_condition', 'Condition', book.condition)}
        ${field('f_coverUrl', 'Cover image URL', book.coverUrl, 'url')}
        <div class="field"><label for="f_description">Description</label>
          <textarea id="f_description">${esc(book.description || '')}</textarea></div>

        <div class="field">
          <label>Categories</label>
          <div class="row tight" id="catPicker">
            ${state.categories.map((c) => `
              <button type="button" class="chip ${book.categories.some((b) => b.id === c.id) ? 'on' : ''}" data-cat="${c.id}">
                <span class="dot" style="background:${esc(c.colour)}"></span>${esc(c.name)}
              </button>`).join('') || '<span class="small muted">No categories yet — create some from the Categories page.</span>'}
          </div>
        </div>

        <label class="switch"><input type="checkbox" id="f_isPublic" ${book.isPublic ? 'checked' : ''} /><span>Show in the public catalogue</span></label>
        <p class="hint">Other members can then see this book and ask to borrow it.</p>
        <label class="switch" style="margin-top:.5rem"><input type="checkbox" id="f_lendable" ${book.lendable ? 'checked' : ''} /><span>Available to lend</span></label>
        <p class="hint">Turn this off for books you are happy to show but not lend out.</p>`,
      footer: `<button class="btn danger" id="deleteFromModal">Delete</button>
               <button class="btn ghost" data-close>Cancel</button>
               <button class="btn primary" data-save>Save changes</button>`,
      onMount(modal, close) {
        modal.querySelector('#catPicker').addEventListener('click', (e) => {
          const chip = e.target.closest('[data-cat]');
          if (chip) chip.classList.toggle('on');
        });
        modal.querySelector('#deleteFromModal').addEventListener('click', async () => {
          close();
          await remove();
        });
        modal.querySelector('#lookupMeta').addEventListener('click', () => runLookup(modal));
        modal.querySelector('[data-save]').addEventListener('click', async () => {
          const val = (id) => modal.querySelector(`#${id}`).value.trim();
          const payload = {
            title: val('f_title'),
            subtitle: val('f_subtitle'),
            authors: val('f_authors'),
            publisher: val('f_publisher'),
            publishedDate: val('f_publishedDate'),
            isbn13: val('f_isbn13'),
            isbn10: val('f_isbn10'),
            pageCount: val('f_pageCount'),
            language: val('f_language'),
            shelf: val('f_shelf'),
            condition: val('f_condition'),
            coverUrl: val('f_coverUrl'),
            description: val('f_description'),
            isPublic: modal.querySelector('#f_isPublic').checked,
            lendable: modal.querySelector('#f_lendable').checked,
            categoryIds: [...modal.querySelectorAll('[data-cat].on')].map((c) => Number(c.dataset.cat))
          };
          if (!payload.title) return toast('A title is required', 'error');
          try {
            await api.updateBook(book.id, payload);
            close();
            toast('Book updated', 'success');
            await reload();
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      }
    });
  }

  async function runLookup(modal) {
    const box = modal.querySelector('#lookupResults');
    const query = modal.querySelector('#f_isbn13').value.trim()
      || modal.querySelector('#f_isbn10').value.trim()
      || `${modal.querySelector('#f_title').value.trim()} ${modal.querySelector('#f_authors').value.trim()}`.trim();
    if (!query) return toast('Enter a title or ISBN first', 'error');

    box.innerHTML = spinner();
    try {
      const { results } = await api.lookup(query);
      if (!results.length) {
        box.innerHTML = '<p class="small muted">No matches found from any source.</p>';
        return;
      }
      box.innerHTML = `
        <p class="small muted">Pick a source to fill the fields below with its record:</p>
        <div class="stack" style="margin:.5rem 0 1rem">
          ${results.map((r, i) => `
            <div class="result-item">
              ${coverMarkup(r, 'thumb')}
              <div>
                <strong>${esc(r.title)}</strong>
                <div class="small">${esc(r.authors || 'Unknown author')}</div>
                <div class="small muted">${[r.publisher, r.publishedDate, r.isbn13 || r.isbn10, `via ${r.source}`]
                  .filter(Boolean).map(esc).join(' · ')}</div>
              </div>
              <button type="button" class="btn primary sm" data-pick="${i}">Use this</button>
            </div>`).join('')}
        </div>`;
      box.querySelectorAll('[data-pick]').forEach((btn) => {
        btn.addEventListener('click', () => applyCandidate(modal, results[Number(btn.dataset.pick)]));
      });
    } catch (err) {
      box.innerHTML = '';
      toast(err.message, 'error');
    }
  }

  function applyCandidate(modal, candidate) {
    const set = (id, value) => { modal.querySelector(`#${id}`).value = value ?? ''; };
    set('f_title', candidate.title);
    set('f_subtitle', candidate.subtitle);
    set('f_authors', candidate.authors);
    set('f_publisher', candidate.publisher);
    set('f_publishedDate', candidate.publishedDate);
    set('f_isbn13', candidate.isbn13);
    set('f_isbn10', candidate.isbn10);
    set('f_pageCount', candidate.pageCount);
    set('f_language', candidate.language);
    set('f_coverUrl', candidate.coverUrl);
    modal.querySelector('#f_description').value = candidate.description || '';
    modal.querySelector('#lookupResults').innerHTML = '';
    toast(`Filled from ${candidate.source}`, 'success');
  }
}

/* ----------------------------------------------------------------- pieces */

function meta(label, value) {
  if (!value) return '';
  return `<div><span>${esc(label)}</span>${esc(value)}</div>`;
}

function availabilityPill(book) {
  if (book.availability === 'on_loan') {
    const overdue = book.activeLoan?.overdue;
    return `<span class="pill ${overdue ? 'overdue' : 'on_loan'}">${overdue ? 'Overdue' : 'On loan'}</span>`;
  }
  if (book.availability === 'not_lendable') return '<span class="pill private">Not for lending</span>';
  return '<span class="pill available">On the shelf</span>';
}

function actionButtons(book) {
  if (book.isOwner) {
    return `<button class="btn primary" id="editBook">Edit details</button>
            <button class="btn danger" id="deleteBook">Delete</button>`;
  }
  const loan = book.myLoan;
  if (!loan) {
    return book.availability === 'available'
      ? `<button class="btn primary" id="requestLoan">Ask to borrow</button>
         <button class="btn" id="requestViaWhatsApp">Share to WhatsApp</button>`
      : '<span class="small muted">Not available to borrow right now.</span>';
  }
  if (loan.status === 'requested' || loan.status === 'approved') {
    return `<span class="pill on_loan">${esc(statusLabel(loan.status))}</span>
            <button class="btn ghost" id="cancelRequest">Withdraw request</button>`;
  }
  if (['lent', 'return_requested'].includes(loan.status)) {
    return `<span class="pill ${loan.overdue ? 'overdue' : 'on_loan'}">You have this until ${formatDate(loan.dueAt)}</span>
            <button class="btn" id="returnedNotice">I've returned it</button>`;
  }
  return '';
}

function lendingPanel(book) {
  const loan = book.activeLoan;
  const history = (book.loanHistory || []).filter((l) => !loan || l.id !== loan.id);

  const pending = (book.loanHistory || []).filter((l) => l.status === 'requested');

  return `<div class="section">
    <h2>Lending</h2>
    ${loan
      ? `<div class="card stack">
          <div class="spread">
            <div>
              <strong>${esc(loan.borrower?.name || '')}</strong>
              ${loan.borrower?.manual ? '<span class="pill">No account</span>' : ''}
              <div class="small muted">Lent ${formatDate(loan.lentAt)} · ${esc(relativeDays(loan.dueAt))}</div>
              ${loan.manualNotes ? `<div class="small muted">${esc(loan.manualNotes)}</div>` : ''}
            </div>
            <span class="pill ${loan.overdue ? 'overdue' : 'on_loan'}">${esc(statusLabel(loan.status))}</span>
          </div>
          <div class="row">
            ${loan.status === 'approved' ? `<button class="btn primary" data-loan-action="lend" data-loan-id="${loan.id}">Mark as handed over</button>` : ''}
            ${loan.status !== 'return_requested' && loan.status !== 'approved' ? `<button class="btn" data-loan-action="request-return" data-loan-id="${loan.id}">Ask for it back</button>` : ''}
            <button class="btn" data-loan-action="extend" data-loan-id="${loan.id}">Extend 14 days</button>
            <button class="btn primary" data-loan-action="return" data-loan-id="${loan.id}">Mark returned</button>
          </div>
        </div>`
      : `<p class="small muted">This book is on your shelf.</p>
         <button class="btn" id="manualLoan"></button>`}

    ${pending.length
      ? `<h3 style="margin-top:1rem">Pending requests</h3>
         <div class="stack">${pending.map((l) => `
           <div class="card spread">
             <div><strong>${esc(l.borrower.name)}</strong>
               <div class="small muted">Requested ${formatDate(l.requestedAt)}</div></div>
             <div class="row tight">
               <button class="btn primary sm" data-loan-action="approve" data-loan-id="${l.id}">Approve &amp; lend</button>
               <button class="btn sm" data-loan-action="decline" data-loan-id="${l.id}">Decline</button>
             </div>
           </div>`).join('')}</div>`
      : ''}

    ${history.length
      ? `<h3 style="margin-top:1rem">History</h3>
         <div class="stack">${history.slice(0, 10).map((l) => `
           <div class="card spread">
             <div><strong>${esc(l.borrower?.name || '')}</strong>${l.borrower?.manual ? ' <span class="pill">No account</span>' : ''}
               <div class="small muted">${esc(statusLabel(l.status))} · ${formatDate(l.returnedAt || l.lentAt || l.requestedAt)}</div></div>
           </div>`).join('')}</div>`
      : ''}
  </div>`;
}

function notesMarkup(book) {
  if (!book.notes?.length) return '<p class="small muted">No notes yet.</p>';
  return book.notes
    .map(
      (n) => `<div class="note ${n.visibility}">
        <div class="spread">
          <div class="small muted">${esc(n.authorName)} · ${formatDate(n.createdAt)}
            <span class="pill ${n.visibility}">${n.visibility === 'public' ? 'Public' : 'Private'}</span></div>
          ${n.canEdit
            ? `<div class="row tight">
                 <button class="btn sm ghost" data-edit-note="${n.id}">Edit</button>
                 <button class="btn sm danger" data-del-note="${n.id}">Delete</button>
               </div>`
            : ''}
        </div>
        <div class="body">${esc(n.body)}</div>
      </div>`
    )
    .join('');
}
