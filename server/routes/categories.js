import express from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

export const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.colour,
              (SELECT COUNT(*) FROM book_categories bc WHERE bc.category_id = c.id) AS bookCount
       FROM categories c WHERE c.user_id = ? ORDER BY c.name COLLATE NOCASE`
    )
    .all(req.user.id);
  res.json({ categories: rows });
});

router.post('/', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 60);
  const colour = /^#[0-9a-f]{6}$/i.test(req.body?.colour || '') ? req.body.colour : '#6c8ae4';
  if (!name) return res.status(400).json({ error: 'A category name is required.' });

  try {
    const info = db
      .prepare('INSERT INTO categories (user_id, name, colour) VALUES (?, ?, ?)')
      .run(req.user.id, name, colour);
    res.status(201).json({ category: { id: info.lastInsertRowid, name, colour, bookCount: 0 } });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'You already have a category with that name.' });
    }
    throw err;
  }
});

router.put('/:id', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 60);
  const colour = /^#[0-9a-f]{6}$/i.test(req.body?.colour || '') ? req.body.colour : '#6c8ae4';
  if (!name) return res.status(400).json({ error: 'A category name is required.' });

  const info = db
    .prepare('UPDATE categories SET name = ?, colour = ? WHERE id = ? AND user_id = ?')
    .run(name, colour, Number(req.params.id), req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'Category not found.' });
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const info = db
    .prepare('DELETE FROM categories WHERE id = ? AND user_id = ?')
    .run(Number(req.params.id), req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'Category not found.' });
  res.json({ ok: true });
});
