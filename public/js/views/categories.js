import { api } from '../api.js';
import { refreshCategories, state } from '../app.js';
import { esc, toast, openModal, confirmDialog, emptyState } from '../ui.js';

const PALETTE = ['#c9553d', '#b8862f', '#3f7d63', '#3f6b9e', '#7a5ea8', '#8a8f3c', '#c06a94', '#5b6670'];

export async function renderCategories({ mount }) {
  async function draw() {
    await refreshCategories();
    mount.innerHTML = `
      <div class="page-head spread">
        <div>
          <h1>Categories</h1>
          <p class="muted small">Your own shelf labels — only you can see them.</p>
        </div>
        <button class="btn primary" id="add">+ New category</button>
      </div>
      ${state.categories.length
        ? `<div class="list">${state.categories.map((c) => `
            <div class="list-item" style="grid-template-columns:1fr">
              <div class="spread">
                <div class="row tight">
                  <span class="dot" style="width:14px;height:14px;border-radius:50%;background:${esc(c.colour)}"></span>
                  <strong>${esc(c.name)}</strong>
                  <span class="small muted">${c.bookCount} book${c.bookCount === 1 ? '' : 's'}</span>
                </div>
                <div class="row tight">
                  <button class="btn sm ghost" data-edit="${c.id}">Edit</button>
                  <button class="btn sm danger" data-del="${c.id}">Delete</button>
                </div>
              </div>
            </div>`).join('')}</div>`
        : emptyState('&#127991;', 'No categories yet', 'Group your books by genre, room, shelf — whatever suits you.')}`;

    mount.querySelector('#add').addEventListener('click', () => editor());
    mount.querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener('click', () => editor(state.categories.find((c) => c.id === Number(b.dataset.edit))))
    );
    mount.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        const cat = state.categories.find((c) => c.id === Number(b.dataset.del));
        if (!(await confirmDialog(`Delete "${cat.name}"? The books themselves are kept.`, { confirmLabel: 'Delete' }))) return;
        await api.deleteCategory(cat.id);
        toast('Category deleted', 'success');
        await draw();
      })
    );
  }

  function editor(existing) {
    openModal({
      title: existing ? 'Edit category' : 'New category',
      body: `
        <div class="field">
          <label for="catName">Name</label>
          <input id="catName" type="text" value="${esc(existing?.name || '')}" placeholder="Science fiction" />
        </div>
        <div class="field">
          <label>Colour</label>
          <div class="row tight" id="palette">
            ${PALETTE.map((c) => `<button type="button" class="chip ${(existing?.colour || PALETTE[0]) === c ? 'on' : ''}" data-colour="${c}">
              <span class="dot" style="background:${c}"></span></button>`).join('')}
          </div>
        </div>`,
      footer: `<button class="btn ghost" data-close>Cancel</button>
               <button class="btn primary" data-save>Save</button>`,
      onMount(modal, close) {
        modal.querySelector('#palette').addEventListener('click', (e) => {
          const chip = e.target.closest('[data-colour]');
          if (!chip) return;
          modal.querySelectorAll('[data-colour]').forEach((c) => c.classList.remove('on'));
          chip.classList.add('on');
        });
        modal.querySelector('[data-save]').addEventListener('click', async () => {
          const payload = {
            name: modal.querySelector('#catName').value.trim(),
            colour: modal.querySelector('[data-colour].on')?.dataset.colour || PALETTE[0]
          };
          if (!payload.name) return toast('Give the category a name', 'error');
          try {
            if (existing) await api.updateCategory(existing.id, payload);
            else await api.createCategory(payload);
            close();
            toast('Saved', 'success');
            await draw();
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      }
    });
  }

  await draw();
}
