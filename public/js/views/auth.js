import { api } from '../api.js';
import { toast } from '../ui.js';
import { onSignedIn } from '../app.js';

export async function renderAuth() {
  const screen = document.getElementById('authScreen');
  screen.hidden = false;

  let registrationOpen = true;
  try {
    registrationOpen = (await api.me()).registrationOpen !== false;
  } catch {
    /* keep default */
  }

  let mode = 'login';

  const draw = () => {
    const isLogin = mode === 'login';
    screen.innerHTML = `
      <div class="card auth-card">
        <div class="logo">&#128218;</div>
        <h1>Libposie</h1>
        <p class="tagline">${isLogin ? 'Welcome back to your shelves.' : 'Create your library account.'}</p>
        <form id="authForm" novalidate>
          <div class="field">
            <label for="username">${isLogin ? 'Username or email' : 'Username'}</label>
            <input id="username" name="username" type="text" autocomplete="username" required />
          </div>
          ${isLogin ? '' : `
          <div class="field">
            <label for="displayName">Display name</label>
            <input id="displayName" name="displayName" type="text" autocomplete="name" />
            <span class="hint">Shown to other members when you lend or borrow.</span>
          </div>
          <div class="field">
            <label for="email">Email (optional)</label>
            <input id="email" name="email" type="email" autocomplete="email" />
          </div>`}
          <div class="field">
            <label for="password">Password</label>
            <input id="password" name="password" type="password"
                   autocomplete="${isLogin ? 'current-password' : 'new-password'}" required />
            ${isLogin ? '' : '<span class="hint">At least 8 characters.</span>'}
          </div>
          <p class="small" id="authError" style="color:var(--accent)"></p>
          <button class="btn primary block" type="submit">${isLogin ? 'Sign in' : 'Create account'}</button>
        </form>
        ${registrationOpen
          ? `<button class="linkish block center" id="toggleMode" style="width:100%;text-align:center">
               ${isLogin ? 'No account yet? Register' : 'Already registered? Sign in'}
             </button>`
          : '<p class="small muted center" style="margin-top:.8rem">Registration is closed on this server.</p>'}
      </div>`;

    screen.querySelector('#toggleMode')?.addEventListener('click', () => {
      mode = isLogin ? 'register' : 'login';
      draw();
    });

    screen.querySelector('#authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      const payload = Object.fromEntries(form.entries());
      const button = e.target.querySelector('button[type=submit]');
      const errEl = screen.querySelector('#authError');

      button.disabled = true;
      errEl.textContent = '';
      try {
        const { user } = isLogin ? await api.login(payload) : await api.register(payload);
        screen.hidden = true;
        screen.innerHTML = '';
        toast(`Welcome, ${user.displayName}`, 'success');
        await onSignedIn(user);
      } catch (err) {
        errEl.textContent = err.message;
        button.disabled = false;
      }
    });
  };

  draw();
}
