import express from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { BOOK_SELECT, shapeBook } from '../shape.js';

export const router = express.Router();

router.use(requireAuth);

/* ------------------------------------------------------------------ read */

/** GET /api/books — the signed-in user's own library. */
router.get('/', (req, res) => {
  const { q = '', category, availability, visibility, sort = 'recent' } = req.query;

  const where = ['b.owner_id = @owner'];
  const params = { owner: req.user.id };

  if (q.trim()) {
    where.push('(b.title LIKE @q OR b.authors LIKE @q OR b.isbn13 LIKE @q OR b.isbn10 LIKE @q OR b.publisher LIKE @q)');
    params.q = `%${q.trim()}%`;
  }
  if (category) {
    where.push('EXISTS (SELECT 1 FROM book_categories bc WHERE bc.book_id = b.id AND bc.category_id = @category)');
    params.category = Number(category);
  }
  if (visibility === 'public') where.push('b.is_public = 1');
  if (visibility === 'private') where.push('b.is_public = 0');

  const order =
    { title: 'b.title COLLATE NOCASE ASC', author: 'b.authors COLLATE NOCASE ASC', recent: 'b.created_at DESC' }[sort] ||
    'b.created_at DESC';

  const rows = db.prepare(`${BOOK_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order}`).all(params);
  let books = rows.map((r) => shapeBook(r, req.user.id));

  if (availability === 'available') books = books.filter((b) => b.availability === 'available');
  if (availability === 'on_loan') books = books.filter((b) => b.availability === 'on_loan');

  res.json({ books });
});

/** GET /api/books/public — every other user's public shelf. */
router.get('/public', (req, res) => {
  const { q = '', ownerId } = req.query;
  const where = ['b.is_public = 1', 'b.owner_id != @me'];
  const params = { me: req.user.id };

  if (q.trim()) {
    where.push('(b.title LIKE @q OR b.authors LIKE @q OR b.isbn13 LIKE @q)');
    params.q = `%${q.trim()}%`;
  }
  if (ownerId) {
    where.push('b.owner_id = @ownerId');
    params.ownerId = Number(ownerId);
  }

  const rows = db
    .prepare(`${BOOK_SELECT} WHERE ${where.join(' AND ')} ORDER BY b.created_at DESC LIMIT 300`)
    .all(params);
  res.json({ books: rows.map((r) => shapeBook(r, req.user.id)) });
});

function loadVisibleBook(id, user) {
  const row = db.prepare(`${BOOK_SELECT} WHERE b.id = ?`).get(id);
  if (!row) return null;
  if (row.owner_id !== user.id && !row.is_public) return null;
  return row;
}

router.get('/:id', (req, res) => {
  const row = loadVisibleBook(Number(req.params.id), req.user);
  if (!row) return res.status(404).json({ error: 'Book not found.' });

  const book = shapeBook(row, req.user.id);
  const isOwner = row.owner_id === req.user.id;

  book.notes = db
    .prepare(
      `SELECT n.id, n.body, n.visibility, n.created_at, n.updated_at, n.user_id,
              u.display_name AS author_name
       FROM notes n JOIN users u ON u.id = n.user_id
       WHERE n.book_id = ? AND (n.visibility = 'public' OR n.user_id = ?)
       ORDER BY n.created_at DESC`
    )
    .all(row.id, req.user.id)
    .map((n) => ({
      id: n.id,
      body: n.body,
      visibility: n.visibility,
      createdAt: n.created_at,
      updatedAt: n.updated_at,
      authorName: n.author_name,
      canEdit: n.user_id === req.user.id
    }));

  if (isOwner) {
    book.loanHistory = db
      .prepare(
        `SELECT l.*, u.display_name AS borrower_name, u.username AS borrower_username
         FROM loans l LEFT JOIN users u ON u.id = l.borrower_id
         WHERE l.book_id = ? ORDER BY l.id DESC LIMIT 50`
      )
      .all(row.id)
      .map((l) => ({
        id: l.id,
        status: l.status,
        borrower: l.borrower_id
          ? { id: l.borrower_id, name: l.borrower_name, username: l.borrower_username }
          : l.manual_borrower_name
            ? { name: l.manual_borrower_name, manual: true }
            : null,
        manualNotes: l.manual_borrower_notes || null,
        requestedAt: l.requested_at,
        lentAt: l.lent_at,
        dueAt: l.due_at,
        returnedAt: l.returned_at
      }));
  }

  res.json({ book });
});

/* ----------------------------------------------------------------- write */

const FIELDS = {
  title: 'title',
  subtitle: 'subtitle',
  authors: 'authors',
  publisher: 'publisher',
  publishedDate: 'published_date',
  isbn10: 'isbn10',
  isbn13: 'isbn13',
  pageCount: 'page_count',
  language: 'language',
  description: 'description',
  coverUrl: 'cover_url',
  source: 'source',
  shelf: 'shelf',
  condition: 'condition',
  rating: 'rating',
  isPublic: 'is_public',
  lendable: 'lendable'
};

function coerce(key, value) {
  if (key === 'isPublic' || key === 'lendable') return value ? 1 : 0;
  if (key === 'pageCount' || key === 'rating') {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  }
  if (key === 'coverUrl') {
    const url = String(value || '').trim();
    return /^https?:\/\//i.test(url) ? url.slice(0, 1000) : '';
  }
  return value == null ? null : String(value).slice(0, 20000);
}

function syncCategories(bookId, userId, categoryIds) {
  if (!Array.isArray(categoryIds)) return;
  db.prepare('DELETE FROM book_categories WHERE book_id = ?').run(bookId);
  const owned = db.prepare('SELECT id FROM categories WHERE user_id = ?').all(userId).map((c) => c.id);
  const insert = db.prepare('INSERT OR IGNORE INTO book_categories (book_id, category_id) VALUES (?, ?)');
  for (const id of categoryIds) if (owned.includes(Number(id))) insert.run(bookId, Number(id));
}

router.post('/', (req, res) => {
  const body = req.body || {};
  if (!String(body.title || '').trim()) return res.status(400).json({ error: 'A title is required.' });

  const cols = ['owner_id'];
  const vals = [req.user.id];
  for (const [key, col] of Object.entries(FIELDS)) {
    if (key in body) {
      cols.push(col);
      vals.push(coerce(key, body[key]));
    }
  }

  const info = db
    .prepare(`INSERT INTO books (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...vals);

  syncCategories(info.lastInsertRowid, req.user.id, body.categoryIds);
  const row = db.prepare(`${BOOK_SELECT} WHERE b.id = ?`).get(info.lastInsertRowid);
  res.status(201).json({ book: shapeBook(row, req.user.id) });
});

function requireOwnedBook(req, res) {
  const row = db.prepare('SELECT * FROM books WHERE id = ?').get(Number(req.params.id));
  if (!row) {
    res.status(404).json({ error: 'Book not found.' });
    return null;
  }
  if (row.owner_id !== req.user.id) {
    res.status(403).json({ error: 'This book belongs to another user.' });
    return null;
  }
  return row;
}

router.put('/:id', (req, res) => {
  const existing = requireOwnedBook(req, res);
  if (!existing) return;

  const body = req.body || {};
  const sets = [];
  const vals = [];
  for (const [key, col] of Object.entries(FIELDS)) {
    if (key in body) {
      sets.push(`${col} = ?`);
      vals.push(coerce(key, body[key]));
    }
  }
  if (sets.length) {
    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE books SET ${sets.join(', ')} WHERE id = ? AND owner_id = ?`).run(
      ...vals,
      existing.id,
      req.user.id
    );
  }
  syncCategories(existing.id, req.user.id, body.categoryIds);

  const row = db.prepare(`${BOOK_SELECT} WHERE b.id = ?`).get(existing.id);
  res.json({ book: shapeBook(row, req.user.id) });
});

router.delete('/:id', (req, res) => {
  const existing = requireOwnedBook(req, res);
  if (!existing) return;
  db.prepare('DELETE FROM books WHERE id = ? AND owner_id = ?').run(existing.id, req.user.id);
  res.json({ ok: true });
});

/* ----------------------------------------------------------------- notes */

router.post('/:id/notes', (req, res) => {
  const row = loadVisibleBook(Number(req.params.id), req.user);
  if (!row) return res.status(404).json({ error: 'Book not found.' });

  const bodyText = String(req.body?.body || '').trim();
  if (!bodyText) return res.status(400).json({ error: 'A note cannot be empty.' });
  const visibility = req.body?.visibility === 'public' ? 'public' : 'private';

  const info = db
    .prepare('INSERT INTO notes (book_id, user_id, body, visibility) VALUES (?, ?, ?, ?)')
    .run(row.id, req.user.id, bodyText.slice(0, 20000), visibility);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/:id/notes/:noteId', (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ? AND book_id = ?').get(
    Number(req.params.noteId),
    Number(req.params.id)
  );
  if (!note) return res.status(404).json({ error: 'Note not found.' });
  if (note.user_id !== req.user.id) return res.status(403).json({ error: 'You can only edit your own notes.' });

  const bodyText = String(req.body?.body ?? note.body).trim();
  if (!bodyText) return res.status(400).json({ error: 'A note cannot be empty.' });
  const visibility = req.body?.visibility === 'public' ? 'public' : 'private';

  db.prepare("UPDATE notes SET body = ?, visibility = ?, updated_at = datetime('now') WHERE id = ?").run(
    bodyText.slice(0, 20000),
    visibility,
    note.id
  );
  res.json({ ok: true });
});

router.delete('/:id/notes/:noteId', (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ? AND book_id = ?').get(
    Number(req.params.noteId),
    Number(req.params.id)
  );
  if (!note) return res.status(404).json({ error: 'Note not found.' });
  if (note.user_id !== req.user.id) return res.status(403).json({ error: 'You can only delete your own notes.' });
  db.prepare('DELETE FROM notes WHERE id = ?').run(note.id);
  res.json({ ok: true });
});
