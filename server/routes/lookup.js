import express from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { lookup, normaliseIsbn, isValidIsbn } from '../services/metadata.js';

export const router = express.Router();
router.use(requireAuth);

const lookupLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

/** GET /api/lookup?q=9780141036144 — search every metadata source. */
router.get('/', lookupLimiter, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Enter an ISBN, title or author to search.' });

  const isbn = normaliseIsbn(q);
  const duplicate =
    isValidIsbn(isbn) &&
    db
      .prepare('SELECT id, title FROM books WHERE owner_id = ? AND (isbn13 = ? OR isbn10 = ?)')
      .get(req.user.id, isbn, isbn);

  const results = await lookup(q);
  res.json({ query: q, isIsbn: isValidIsbn(isbn), duplicate: duplicate || null, results });
});
