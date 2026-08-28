import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db, dataDir } from './db.js';

/** Uses JWT_SECRET when supplied, otherwise generates one and keeps it beside the database. */
function resolveSecret() {
  const fromEnv = (process.env.JWT_SECRET || '').trim();
  if (fromEnv.length >= 24) return fromEnv;
  if (fromEnv) console.warn('JWT_SECRET is shorter than 24 characters and has been ignored.');

  const secretFile = path.join(dataDir, '.jwt-secret');
  try {
    const stored = fs.readFileSync(secretFile, 'utf8').trim();
    if (stored.length >= 24) return stored;
  } catch {
    /* first run */
  }

  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  console.log(`No JWT_SECRET provided — generated one and stored it in ${secretFile}`);
  return generated;
}

const SECRET = resolveSecret();
const COOKIE_NAME = 'libposie_session';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 12);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

export function issueSession(res, user) {
  const token = jwt.sign({ sub: user.id }, SECRET, { expiresIn: '30d' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.SECURE_COOKIES === '1',
    maxAge: MAX_AGE_MS,
    path: '/'
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

const selectUser = db.prepare(
  `SELECT id, username, email, display_name, is_admin, is_active, loan_days, reminder_days, created_at
   FROM users WHERE id = ?`
);

export function attachUser(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      const payload = jwt.verify(token, SECRET);
      const user = selectUser.get(payload.sub);
      if (user && user.is_active) req.user = user;
    } catch {
      /* invalid or expired token -> anonymous */
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Administrator access required' });
  next();
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    isAdmin: !!user.is_admin
  };
}
