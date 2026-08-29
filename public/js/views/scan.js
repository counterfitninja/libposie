import { api } from '../api.js';
import { state, refreshCategories } from '../app.js';
import { esc, spinner, toast, emptyState, coverMarkup, openModal } from '../ui.js';
import { startScanner, cameraSupported } from '../scanner.js';

export async function renderScan({ mount }) {
  await refreshCategories();
  let stopScanner = null;
  let lastCode = '';
  let pending = [];
  let pendingSeq = 0;

  mount.innerHTML = `
    <div class="page-head">
      <h1>Add a book</h1>
      <p class="muted small">Scan the barcode on the back cover, or search by ISBN, title or author.</p>
    </div>

    <div class="card stack" style="margin-bottom:1rem">
      <div class="row">
        <button class="btn primary" id="startCam">Scan a barcode</button>
        <button class="btn ghost hidden" id="stopCam">Done scanning</button>
      </div>
      <div id="camWrap" class="hidden">
        <div class="scanner-frame">
          <video id="video" muted playsinline></video>
          <div class="reticle"></div>
          <div class="laser"></div>
        </div>
        <p class="small muted center" style="margin-top:.5rem">Hold the barcode inside the frame. Add a match to keep scanning, or tap "Done scanning" when you're finished.</p>
      </div>
      <p class="small muted" id="camNote"></p>
    </div>

    <form class="toolbar" id="searchForm">
      <input class="grow" type="search" id="q" placeholder="9780141036144, or “Dune Herbert”" />
      <button class="btn primary" type="submit">Search</button>
      <button class="btn ghost" type="button" id="manual">Enter manually</button>
    </form>

    <div id="results"></div>

    <div id="pendingSection" class="hidden" style="margin-top:1.2rem">
      <h2>Scanned books ready to confirm</h2>
      <p class="small muted">Keep scanning — confirm each one whenever you're ready.</p>
      <div class="stack" id="pendingList"></div>
    </div>`;

  const results = mount.querySelector('#results');
  const pendingSection = mount.querySelector('#pendingSection');
  const pendingList = mount.querySelector('#pendingList');
  const camWrap = mount.querySelector('#camWrap');
  const startBtn = mount.querySelector('#startCam');
  const stopBtn = mount.querySelector('#stopCam');

  if (!cameraSupported()) {
    mount.querySelector('#camNote').textContent =
      'Camera scanning needs a browser with camera access over HTTPS (or localhost). You can still search by ISBN below.';
    startBtn.disabled = true;
  } else {
    startCamera();
  }

  async function startCamera() {
    camWrap.classList.remove('hidden');
    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    stopScanner = await startScanner(
      mount.querySelector('#video'),
      (code) => {
        if (code === lastCode) return;
        lastCode = code;
        navigator.vibrate?.(60);
        mount.querySelector('#q').value = code;
        queueFromScan(code);
      },
      (message) => {
        mount.querySelector('#camNote').textContent = message;
        stopCamera();
      }
    );
  }
  startBtn.addEventListener('click', startCamera);

  function stopCamera() {
    stopScanner?.();
    stopScanner = null;
    camWrap.classList.add('hidden');
    startBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
  }
  stopBtn.addEventListener('click', stopCamera);

  mount.querySelector('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    search(mount.querySelector('#q').value.trim());
  });

  mount.querySelector('#manual').addEventListener('click', () => openEditor({ title: '' }));

  function renderPending() {
    if (!pending.length) {
      pendingSection.classList.add('hidden');
      pendingList.innerHTML = '';
      return;
    }
    pendingSection.classList.remove('hidden');
    pendingList.innerHTML = pending.map((p) => `
      <div class="result-item">
        ${coverMarkup(p.candidate, 'thumb')}
        <div>
          <strong>${esc(p.candidate.title)}</strong>
          <div class="small">${esc(p.candidate.authors || 'Unknown author')}</div>
          <div class="small muted">${[p.candidate.publisher, p.candidate.publishedDate, p.candidate.isbn13 || p.candidate.isbn10]
            .filter(Boolean).map(esc).join(' · ')}</div>
        </div>
        <div class="row tight">
          <button class="btn primary sm" data-confirm="${p.id}">Confirm</button>
          <button class="btn ghost sm" data-discard="${p.id}">Discard</button>
        </div>
      </div>`).join('');
    pendingList.querySelectorAll('[data-confirm]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.confirm);
        const item = pending.find((p) => p.id === id);
        if (item) openEditor(item.candidate, id);
      });
    });
    pendingList.querySelectorAll('[data-discard]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.discard);
        pending = pending.filter((p) => p.id !== id);
        renderPending();
      });
    });
  }

  async function queueFromScan(query) {
    if (!query) return;
    results.innerHTML = spinner();
    try {
      const data = await api.lookup(query);
      if (data.duplicate) {
        results.innerHTML = '';
        toast(`Already in your library: "${data.duplicate.title}"`, 'error');
        return;
      }
      if (!data.results.length) {
        results.innerHTML = emptyState(
          '&#128269;',
          'No matches found',
          'Nothing came back for that barcode. You can enter it manually below.',
          '<button class="btn primary" id="manual2" style="margin-top:.6rem">Enter details manually</button>'
        );
        results.querySelector('#manual2').addEventListener('click', () =>
          openEditor({ title: '', isbn13: data.isIsbn ? query : '' })
        );
        return;
      }
      const candidate = data.results[0];
      const dupe = pending.some((p) =>
        (candidate.isbn13 && p.candidate.isbn13 === candidate.isbn13) ||
        (candidate.isbn10 && p.candidate.isbn10 === candidate.isbn10));
      results.innerHTML = '';
      if (dupe) {
        toast(`"${candidate.title}" is already in your scan queue`, 'error');
        return;
      }
      pending.push({ id: pendingSeq++, candidate });
      renderPending();
      toast(`"${candidate.title}" queued — keep scanning`, 'success');
    } catch (err) {
      toast(err.message, 'error');
      results.innerHTML = emptyState('&#9888;', 'Search failed', err.message);
    }
  }

  async function search(query) {
    if (!query) return;
    results.innerHTML = spinner();
    try {
      const data = await api.lookup(query);
      if (!data.results.length) {
        results.innerHTML = emptyState(
          '&#128269;',
          'No matches found',
          'Nothing came back from the metadata sources. You can still add the book by hand.',
          '<button class="btn primary" id="manual2" style="margin-top:.6rem">Enter details manually</button>'
        );
        results.querySelector('#manual2').addEventListener('click', () =>
          openEditor({ title: '', isbn13: data.isIsbn ? query : '' })
        );
        return;
      }

      results.innerHTML = `
        ${data.duplicate
          ? `<div class="card" style="margin-bottom:.8rem;border-color:var(--gold)">
              <strong>Already in your library:</strong> ${esc(data.duplicate.title)}
              <a class="btn sm" href="#/book/${data.duplicate.id}" style="margin-left:.5rem">Open</a>
             </div>`
          : ''}
        <h2>${data.results.length} match${data.results.length === 1 ? '' : 'es'}</h2>
        <p class="small muted">Pick the edition that matches your copy — you can correct anything before saving.</p>
        <div class="stack" style="margin-top:.7rem">
          ${data.results.map((r, i) => `
            <div class="result-item">
              ${coverMarkup(r, 'thumb')}
              <div>
                <strong>${esc(r.title)}</strong>
                <div class="small">${esc(r.authors || 'Unknown author')}</div>
                <div class="small muted">${[r.publisher, r.publishedDate, r.isbn13 || r.isbn10, `via ${r.source}`]
                  .filter(Boolean).map(esc).join(' · ')}</div>
              </div>
              <button class="btn primary sm" data-pick="${i}">Choose</button>
            </div>`).join('')}
        </div>`;

      results.querySelectorAll('[data-pick]').forEach((btn) => {
        btn.addEventListener('click', () => openEditor(data.results[Number(btn.dataset.pick)]));
      });
    } catch (err) {
      toast(err.message, 'error');
      results.innerHTML = emptyState('&#9888;', 'Search failed', err.message);
    }
  }

  function openEditor(candidate, pendingId) {
    const field = (id, label, value, type = 'text') =>
      `<div class="field"><label for="${id}">${label}</label>
        <input id="${id}" type="${type}" value="${esc(value ?? '')}" /></div>`;

    openModal({
      title: 'Add to your library',
      body: `
        ${field('n_title', 'Title', candidate.title)}
        ${field('n_subtitle', 'Subtitle', candidate.subtitle)}
        ${field('n_authors', 'Authors', candidate.authors)}
        ${field('n_publisher', 'Publisher', candidate.publisher)}
        ${field('n_publishedDate', 'Published', candidate.publishedDate)}
        ${field('n_isbn13', 'ISBN-13', candidate.isbn13)}
        ${field('n_isbn10', 'ISBN-10', candidate.isbn10)}
        ${field('n_pageCount', 'Pages', candidate.pageCount, 'number')}
        ${field('n_shelf', 'Shelf / location', '')}
        ${field('n_coverUrl', 'Cover image URL', candidate.coverUrl, 'url')}
        <div class="field"><label for="n_description">Description</label>
          <textarea id="n_description">${esc(candidate.description || '')}</textarea></div>

        <div class="field">
          <label>Categories</label>
          <div class="row tight" id="catPicker">
            ${state.categories.map((c) => `
              <button type="button" class="chip" data-cat="${c.id}">
                <span class="dot" style="background:${esc(c.colour)}"></span>${esc(c.name)}
              </button>`).join('') || '<span class="small muted">No categories yet — add some from the Categories page.</span>'}
          </div>
        </div>

        <div class="field">
          <label for="n_note">First note (optional)</label>
          <textarea id="n_note" placeholder="Where it came from, why you bought it…"></textarea>
        </div>
        <label class="switch"><input type="checkbox" id="n_notePublic" /><span>Make this note public</span></label>

        <label class="switch" style="margin-top:.9rem"><input type="checkbox" id="n_isPublic" checked /><span>Show in the public catalogue</span></label>
        <p class="hint">Other members will be able to see it and ask to borrow it.</p>
        <label class="switch" style="margin-top:.5rem"><input type="checkbox" id="n_lendable" checked /><span>Available to lend</span></label>`,
      footer: `<button class="btn ghost" data-close>Cancel</button>
               <button class="btn primary" data-save>Add book</button>`,
      onMount(modal, close) {
        modal.querySelector('#catPicker').addEventListener('click', (e) => {
          const chip = e.target.closest('[data-cat]');
          if (chip) chip.classList.toggle('on');
        });
        modal.querySelector('[data-save]').addEventListener('click', async () => {
          const val = (id) => modal.querySelector(`#${id}`).value.trim();
          if (!val('n_title')) return toast('A title is required', 'error');

          const payload = {
            title: val('n_title'),
            subtitle: val('n_subtitle'),
            authors: val('n_authors'),
            publisher: val('n_publisher'),
            publishedDate: val('n_publishedDate'),
            isbn13: val('n_isbn13'),
            isbn10: val('n_isbn10'),
            pageCount: val('n_pageCount'),
            language: candidate.language || '',
            description: val('n_description'),
            coverUrl: val('n_coverUrl'),
            shelf: val('n_shelf'),
            source: candidate.source || 'Manual entry',
            isPublic: modal.querySelector('#n_isPublic').checked,
            lendable: modal.querySelector('#n_lendable').checked,
            categoryIds: [...modal.querySelectorAll('[data-cat].on')].map((c) => Number(c.dataset.cat))
          };

          try {
            const { book } = await api.createBook(payload);
            const noteText = val('n_note');
            if (noteText) {
              await api.addNote(book.id, {
                body: noteText,
                visibility: modal.querySelector('#n_notePublic').checked ? 'public' : 'private'
              });
            }
            close();
            toast(`"${book.title}" added to your library`, 'success');
            if (pendingId !== undefined) {
              pending = pending.filter((p) => p.id !== pendingId);
              renderPending();
            } else {
              lastCode = '';
              results.innerHTML = '';
              mount.querySelector('#q').value = '';
            }
            if (!stopScanner) mount.querySelector('#q').focus();
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      }
    });
  }

  return () => stopCamera();
}
