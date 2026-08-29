import express from 'express';
import { db } from '../db.js';
import { requireAuth, requireAdmin, hashPassword } from '../auth.js';

export const router = express.Router();
router.use(requireAuth);

/** Directory of members with public books, used by the Discover view. */
router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.display_name,
              (SELECT COUNT(*) FROM books b WHERE b.owner_id = u.id AND b.is_public = 1) AS publicBooks
       FROM users u
       WHERE u.is_active = 1 AND u.id != ?
       ORDER BY u.display_name COLLATE NOCASE`
    )
    .all(req.user.id)
    .filter((u) => u.publicBooks > 0);
  res.json({
    users: rows.map((u) => ({ id: u.id, username: u.username, name: u.display_name, publicBooks: u.publicBooks }))
  });
});

/** Full member directory (regardless of public books), used to pick an existing account as a loan's borrower. */
router.get('/directory', (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, username, display_name FROM users WHERE is_active = 1 AND id != ? ORDER BY display_name COLLATE NOCASE`
    )
    .all(req.user.id);
  res.json({ users: rows.map((u) => ({ id: u.id, username: u.username, name: u.display_name })) });
});

/* ----------------------------------------------------------- site admin */

router.get('/admin/overview', requireAdmin, (_req, res) => {
  const users = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.email, u.is_admin, u.is_active, u.created_at,
              (SELECT COUNT(*) FROM books b WHERE b.owner_id = u.id) AS books,
              (SELECT COUNT(*) FROM loans l WHERE l.owner_id = u.id AND l.status IN ('approved','lent','return_requested')) AS lentOut
       FROM users u ORDER BY u.username COLLATE NOCASE`
    )
    .all();
  const stats = {
    users: users.length,
    books: db.prepare('SELECT COUNT(*) AS n FROM books').get().n,
    publicBooks: db.prepare('SELECT COUNT(*) AS n FROM books WHERE is_public = 1').get().n,
    categories: db.prepare('SELECT COUNT(*) AS n FROM categories').get().n,
    activeLoans: db
      .prepare("SELECT COUNT(*) AS n FROM loans WHERE status IN ('approved','lent','return_requested')")
      .get().n,
    overdueLoans: db
      .prepare("SELECT COUNT(*) AS n FROM loans WHERE status IN ('lent','return_requested') AND due_at IS NOT NULL AND due_at < date('now')")
      .get().n
  };
  res.json({ stats, users });
});

router.get('/stats', requireAuth, (req, res) => {
  const stats = {
    books: db.prepare('SELECT COUNT(*) AS n FROM books WHERE owner_id = ?').get(req.user.id).n,
    publicBooks: db.prepare('SELECT COUNT(*) AS n FROM books WHERE owner_id = ? AND is_public = 1').get(req.user.id).n,
    categories: db.prepare('SELECT COUNT(*) AS n FROM categories WHERE user_id = ?').get(req.user.id).n,
    availableBooks: db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM books b
         LEFT JOIN loans l ON l.book_id = b.id AND l.status IN ('approved','lent','return_requested')
         WHERE b.owner_id = ? AND (l.id IS NULL OR l.status NOT IN ('approved','lent','return_requested'))`
      )
      .get(req.user.id).n,
    activeLoans: db
      .prepare("SELECT COUNT(*) AS n FROM loans WHERE owner_id = ? AND status IN ('approved','lent','return_requested')")
      .get(req.user.id).n,
    pendingRequests: db
      .prepare("SELECT COUNT(*) AS n FROM loans WHERE owner_id = ? AND status = 'requested'")
      .get(req.user.id).n,
    overdueLoans: db
      .prepare("SELECT COUNT(*) AS n FROM loans WHERE owner_id = ? AND status IN ('lent','return_requested') AND due_at IS NOT NULL AND due_at < date('now')")
      .get(req.user.id).n,
    borrowingCount: db
      .prepare("SELECT COUNT(*) AS n FROM loans WHERE borrower_id = ? AND status IN ('requested','approved','lent','return_requested')")
      .get(req.user.id).n
  };

  res.json({ stats });
});

router.put('/admin/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const isActive = req.body?.isActive === undefined ? target.is_active : req.body.isActive ? 1 : 0;
  const isAdmin = req.body?.isAdmin === undefined ? target.is_admin : req.body.isAdmin ? 1 : 0;

  if (id === req.user.id && (!isActive || !isAdmin)) {
    return res.status(400).json({ error: 'You cannot remove your own admin access or disable yourself.' });
  }

  db.prepare('UPDATE users SET is_active = ?, is_admin = ? WHERE id = ?').run(isActive, isAdmin, id);

  if (req.body?.newPassword) {
    if (String(req.body.newPassword).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.newPassword), id);
  }
  res.json({ ok: true });
});

router.delete('/admin/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});
