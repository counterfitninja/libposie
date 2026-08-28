import express from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
import {
  hashPassword,
  verifyPassword,
  issueSession,
  clearSession,
  requireAuth,
  publicUser
} from '../auth.js';

export const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' }
});

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null, registrationOpen: isRegistrationOpen() });
  res.json({
    user: {
      ...publicUser(req.user),
      email: req.user.email,
      loanDays: req.user.loan_days,
      reminderDays: req.user.reminder_days
    }
  });
});

function isRegistrationOpen() {
  if (process.env.ALLOW_REGISTRATION === '0') return false;
  return true;
}

function userCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

router.post('/register', authLimiter, (req, res) => {
  const { username, email, displayName, password } = req.body || {};
  const first = userCount() === 0;

  if (!first && !isRegistrationOpen()) {
    return res.status(403).json({ error: 'Registration is closed on this server.' });
  }
  if (!USERNAME_RE.test(username || '')) {
    return res.status(400).json({ error: 'Username must be 3-32 characters (letters, numbers, . _ -).' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (email && !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  try {
    const info = db
      .prepare(
        `INSERT INTO users (username, email, display_name, password_hash, is_admin)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(username, email || null, (displayName || username).trim().slice(0, 80), hashPassword(password), first ? 1 : 0);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    issueSession(res, user);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'That username or email is already registered.' });
    }
    throw err;
  }
});

router.post('/login', authLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const user = db
    .prepare('SELECT * FROM users WHERE username = ? OR email = ?')
    .get(username || '', username || '');

  if (!user || !verifyPassword(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  if (!user.is_active) return res.status(403).json({ error: 'This account has been disabled.' });

  issueSession(res, user);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.put('/profile', requireAuth, (req, res) => {
  const { displayName, email, loanDays, reminderDays } = req.body || {};
  const loan = Math.min(365, Math.max(1, Number(loanDays) || req.user.loan_days));
  const remind = Math.min(60, Math.max(0, Number(reminderDays) ?? req.user.reminder_days));

  db.prepare(
    `UPDATE users SET display_name = ?, email = ?, loan_days = ?, reminder_days = ? WHERE id = ?`
  ).run(
    (displayName || req.user.display_name).trim().slice(0, 80),
    email || null,
    loan,
    remind,
    req.user.id
  );
  res.json({ ok: true });
});

router.put('/password', requireAuth, authLimiter, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(currentPassword || '', row.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  res.json({ ok: true });
});
