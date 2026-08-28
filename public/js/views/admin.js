import { api } from '../api.js';
import { state } from '../app.js';
import { esc, toast, formatDate, confirmDialog, openModal } from '../ui.js';

export async function renderAdmin({ mount }) {
  if (!state.user?.isAdmin) {
    mount.innerHTML = '<div class="empty"><h3>Administrators only</h3></div>';
    return;
  }

  async function draw() {
    const { stats, users } = await api.adminOverview();

    mount.innerHTML = `
      <div class="page-head">
        <h1>Server admin</h1>
        <p class="muted small">Members, accounts and scheduled reminders.</p>
      </div>

      <div class="row" style="margin-bottom:1.2rem">
        ${stat('Members', stats.users)}
        ${stat('Books', stats.books)}
        ${stat('Public', stats.publicBooks)}
        ${stat('Active loans', stats.activeLoans)}
      </div>

      <div class="card" style="margin-bottom:1.2rem">
        <h2>Reminders</h2>
        <p class="small muted">Due-date reminders run automatically at 09:00 each day. Run them now to test delivery.</p>
        <button class="btn" id="runReminders">Run reminder sweep</button>
      </div>

      <h2>Members</h2>
      <div class="list">
        ${users.map((u) => `
          <div class="list-item" style="grid-template-columns:1fr">
            <div class="spread">
              <div>
                <strong>${esc(u.display_name)}</strong> <span class="small muted">@${esc(u.username)}</span>
                ${u.is_admin ? '<span class="pill public">Admin</span>' : ''}
                ${u.is_active ? '' : '<span class="pill overdue">Disabled</span>'}
                <div class="small muted">${u.books} book${u.books === 1 ? '' : 's'} · ${u.lentOut} on loan · joined ${formatDate(u.created_at)}</div>
              </div>
              <div class="row tight">
                <button class="btn sm ghost" data-manage="${u.id}">Manage</button>
                <button class="btn sm danger" data-del="${u.id}" data-name="${esc(u.display_name)}">Delete</button>
              </div>
            </div>
          </div>`).join('')}
      </div>`;

    mount.querySelector('#runReminders').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const { sent } = await api.runReminders();
        toast(`Reminder sweep complete — ${sent} notification set(s) sent`, 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
      e.target.disabled = false;
    });

    mount.querySelectorAll('[data-manage]').forEach((b) =>
      b.addEventListener('click', () => manage(users.find((u) => u.id === Number(b.dataset.manage))))
    );

    mount.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!(await confirmDialog(
          `Delete ${b.dataset.name} and their entire library, notes and loan history? This cannot be undone.`,
          { confirmLabel: 'Delete account' }
        ))) return;
        try {
          await api.adminDeleteUser(Number(b.dataset.del));
          toast('Account deleted', 'success');
          await draw();
        } catch (err) {
          toast(err.message, 'error');
        }
      })
    );
  }

  function manage(user) {
    openModal({
      title: `Manage ${user.display_name}`,
      body: `
        <label class="switch"><input type="checkbox" id="a_active" ${user.is_active ? 'checked' : ''} /><span>Account active</span></label>
        <p class="hint">Disabled accounts cannot sign in, but their data is kept.</p>
        <label class="switch" style="margin-top:.6rem"><input type="checkbox" id="a_admin" ${user.is_admin ? 'checked' : ''} /><span>Administrator</span></label>
        <p class="hint">Administrators can manage every member on this server.</p>
        <div class="field" style="margin-top:1rem">
          <label for="a_pw">Reset password (optional)</label>
          <input id="a_pw" type="password" autocomplete="new-password" placeholder="Leave blank to keep the current one" />
        </div>`,
      footer: `<button class="btn ghost" data-close>Cancel</button>
               <button class="btn primary" data-save>Save</button>`,
      onMount(modal, close) {
        modal.querySelector('[data-save]').addEventListener('click', async () => {
          const payload = {
            isActive: modal.querySelector('#a_active').checked,
            isAdmin: modal.querySelector('#a_admin').checked
          };
          const pw = modal.querySelector('#a_pw').value;
          if (pw) payload.newPassword = pw;
          try {
            await api.adminUpdateUser(user.id, payload);
            close();
            toast('Member updated', 'success');
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

function stat(label, value) {
  return `<div class="card" style="flex:1;min-width:100px;text-align:center">
    <div style="font-size:1.6rem;font-family:var(--font-display)">${value}</div>
    <div class="small muted">${esc(label)}</div>
  </div>`;
}
