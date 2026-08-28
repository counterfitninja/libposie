import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const dataDir = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'libposie.sqlite'));

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  loan_days     INTEGER NOT NULL DEFAULT 28,
  reminder_days INTEGER NOT NULL DEFAULT 3,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS books (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  subtitle       TEXT,
  authors        TEXT,
  publisher      TEXT,
  published_date TEXT,
  isbn10         TEXT,
  isbn13         TEXT,
  page_count     INTEGER,
  language       TEXT,
  description    TEXT,
  cover_url      TEXT,
  source         TEXT,
  shelf          TEXT,
  condition      TEXT,
  rating         INTEGER,
  is_public      INTEGER NOT NULL DEFAULT 0,
  lendable       INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_books_owner ON books(owner_id);
CREATE INDEX IF NOT EXISTS idx_books_public ON books(is_public);
CREATE INDEX IF NOT EXISTS idx_books_isbn13 ON books(isbn13);

CREATE TABLE IF NOT EXISTS categories (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  colour  TEXT NOT NULL DEFAULT '#6c8ae4',
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS book_categories (
  book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, category_id)
);

CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_book ON notes(book_id);

CREATE TABLE IF NOT EXISTS loans (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id            INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  owner_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  borrower_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'requested',
  message            TEXT,
  requested_at       TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at         TEXT,
  lent_at            TEXT,
  due_at             TEXT,
  return_requested_at TEXT,
  returned_at        TEXT,
  last_reminder_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_loans_book ON loans(book_id);
CREATE INDEX IF NOT EXISTS idx_loans_owner ON loans(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_loans_borrower ON loans(borrower_id, status);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`);

/** Active loan statuses: the book is not on the owner's shelf. */
export const ACTIVE_LOAN_STATUSES = ['approved', 'lent', 'return_requested'];
export const OPEN_LOAN_STATUSES = ['requested', ...ACTIVE_LOAN_STATUSES];

export function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}
