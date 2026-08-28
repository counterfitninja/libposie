import { api } from '../api.js';
import { state, enablePushNotifications, disablePushNotifications, pushEnabled } from '../app.js';
import { esc, toast } from '../ui.js';

export async function renderSettings({ mount }) {
  const { user } = await api.me();
  state.user = { ...state.user, ...user };
  const pushOn = await pushEnabled();

  mount.innerHTML = `
    <div class="page-head">
      <h1>Settings</h1>
      <p class="muted small">Signed in as <strong>${esc(user.username)}</strong></p>
    </div>

    <div class="card" style="margin-bottom:1rem">
      <h2>Profile &amp; lending defaults</h2>
      <form id="profileForm">
        <div class="field">
          <label for="displayName">Display name</label>
          <input id="displayName" type="text" value="${esc(user.displayName)}" />
        </div>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" type="email" value="${esc(user.email || '')}" />
        </div>
        <div class="field">
          <label for="loanDays">Default loan period (days)</label>
          <input id="loanDays" type="number" min="1" max="365" value="${user.loanDays}" />
          <span class="hint">Used to suggest a due date when you approve a request.</span>
        </div>
        <div class="field">
          <label for="reminderDays">Remind before due date (days)</label>
          <input id="reminderDays" type="number" min="0" max="60" value="${user.reminderDays}" />
          <span class="hint">Borrowers are nudged this many days ahead, then again on the due date and while overdue. Set 0 to only warn on and after the due date.</span>
        </div>
        <button class="btn primary" type="submit">Save changes</button>
      </form>
    </div>

    <div class="card" style="margin-bottom:1rem">
      <h2>Notifications</h2>
      <p class="small muted">Push notifications let Libposie reach you on your phone even when the app is closed.
        Install the app to your home screen first for the most reliable delivery on iOS.</p>
      <button class="btn ${pushOn ? '' : 'primary'}" id="pushBtn">${pushOn ? 'Turn off push notifications' : 'Enable push notifications'}</button>
      <p class="hint" id="pushHint">${pushOn ? 'This device is subscribed.' : 'You will be asked for permission.'}</p>
    </div>

    <div class="card">
      <h2>Change password</h2>
      <form id="pwForm">
        <div class="field">
          <label for="currentPassword">Current password</label>
          <input id="currentPassword" type="password" autocomplete="current-password" />
        </div>
        <div class="field">
          <label for="newPassword">New password</label>
          <input id="newPassword" type="password" autocomplete="new-password" />
          <span class="hint">At least 8 characters.</span>
        </div>
        <button class="btn primary" type="submit">Update password</button>
      </form>
    </div>`;

  mount.querySelector('#profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.updateProfile({
        displayName: mount.querySelector('#displayName').value,
        email: mount.querySelector('#email').value,
        loanDays: Number(mount.querySelector('#loanDays').value),
        reminderDays: Number(mount.querySelector('#reminderDays').value)
      });
      const refreshed = (await api.me()).user;
      state.user = { ...state.user, ...refreshed };
      toast('Settings saved', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  mount.querySelector('#pushBtn').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      if (await pushEnabled()) {
        await disablePushNotifications();
        toast('Push notifications turned off');
      } else {
        await enablePushNotifications();
        toast('Push notifications enabled', 'success');
      }
      await renderSettings({ mount });
    } catch (err) {
      toast(err.message, 'error');
      e.target.disabled = false;
    }
  });

  mount.querySelector('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.changePassword({
        currentPassword: mount.querySelector('#currentPassword').value,
        newPassword: mount.querySelector('#newPassword').value
      });
      e.target.reset();
      toast('Password updated', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
