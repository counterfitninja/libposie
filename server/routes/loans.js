import express from 'express';
import { db, ACTIVE_LOAN_STATUSES, OPEN_LOAN_STATUSES } from '../db.js';
import { requireAuth } from '../auth.js';
import { notify } from '../notifications.js';
import { shapeLoan, getActiveLoan } from '../shape.js';

export const router = express.Router();
router.use(requireAuth);

const LOAN_SELECT = `
  SELECT l.*, b.title AS book_title, b.cover_url,
         ob.display_name AS owner_name, ob.username AS owner_username,
         br.display_name AS borrower_name, br.username AS borrower_username
  FROM loans l
  JOIN books b ON b.id = l.book_id
  JOIN users ob ON ob.id = l.owner_id
  JOIN users br ON br.id = l.borrower_id`;

function loadLoan(id) {
  return db.prepare(`${LOAN_SELECT} WHERE l.id = ?`).get(Number(id));
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

/* ------------------------------------------------------------------ read */

router.get('/borrowing', (req, res) => {
  const rows = db
    .prepare(`${LOAN_SELECT} WHERE l.borrower_id = ? ORDER BY l.id DESC LIMIT 200`)
    .all(req.user.id);
  res.json({ loans: rows.map(shapeLoan) });
});

router.get('/lending', (req, res) => {
  const rows = db
    .prepare(`${LOAN_SELECT} WHERE l.owner_id = ? ORDER BY l.id DESC LIMIT 200`)
    .all(req.user.id);
  res.json({ loans: rows.map(shapeLoan) });
});

/* --------------------------------------------------------------- request */

router.post('/', (req, res) => {
  const bookId = Number(req.body?.bookId);
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
  if (!book || !book.is_public) return res.status(404).json({ error: 'Book not found.' });
  if (book.owner_id === req.user.id) return res.status(400).json({ error: 'You already own this book.' });
  if (!book.lendable) return res.status(400).json({ error: 'The owner has not made this book available to lend.' });

  const existing = db
    .prepare(
      `SELECT id FROM loans WHERE book_id = ? AND borrower_id = ? AND status IN (${OPEN_LOAN_STATUSES.map(() => '?').join(',')})`
    )
    .get(bookId, req.user.id, ...OPEN_LOAN_STATUSES);
  if (existing) return res.status(409).json({ error: 'You already have an open request for this book.' });

  const info = db
    .prepare('INSERT INTO loans (book_id, owner_id, borrower_id, status, message) VALUES (?, ?, ?, ?, ?)')
    .run(bookId, book.owner_id, req.user.id, 'requested', String(req.body?.message || '').slice(0, 500));

  notify(book.owner_id, {
    type: 'loan_requested',
    title: 'New loan request',
    body: `${req.user.display_name} would like to borrow "${book.title}".`,
    link: '#/lending'
  });

  res.status(201).json({ loan: shapeLoan(loadLoan(info.lastInsertRowid)) });
});

/* --------------------------------------------------------------- actions */

function guard(req, res, { owner = false, borrower = false, statuses }) {
  const loan = loadLoan(req.params.id);
  if (!loan) {
    res.status(404).json({ error: 'Loan not found.' });
    return null;
  }
  const isOwner = loan.owner_id === req.user.id;
  const isBorrower = loan.borrower_id === req.user.id;
  if ((owner && !isOwner) || (borrower && !isBorrower)) {
    res.status(403).json({ error: 'You are not allowed to perform that action.' });
    return null;
  }
  if (statuses && !statuses.includes(loan.status)) {
    res.status(409).json({ error: `This loan is "${loan.status}" and cannot be changed that way.` });
    return null;
  }
  return loan;
}

/** Owner approves and hands the book over in one step. */
router.post('/:id/approve', (req, res) => {
  const loan = guard(req, res, { owner: true, statuses: ['requested'] });
  if (!loan) return;

  const active = getActiveLoan(loan.book_id);
  if (active) return res.status(409).json({ error: 'That book is already out on loan.' });

  const days = Math.min(365, Math.max(1, Number(req.body?.days) || req.user.loan_days));
  const dueAt = req.body?.dueAt && /^\d{4}-\d{2}-\d{2}$/.test(req.body.dueAt) ? req.body.dueAt : addDays(days);
  const handedOver = req.body?.handedOver !== false;

  db.prepare(
    `UPDATE loans SET status = ?, decided_at = datetime('now'),
       lent_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END,
       due_at = ?
     WHERE id = ?`
  ).run(handedOver ? 'lent' : 'approved', handedOver ? 1 : 0, dueAt, loan.id);

  notify(loan.borrower_id, {
    type: 'loan_approved',
    title: 'Loan approved',
    body: `${loan.owner_name} approved your request for "${loan.book_title}". Due back ${formatDate(dueAt)}.`,
    link: '#/borrowing'
  });

  res.json({ loan: shapeLoan(loadLoan(loan.id)) });
});

/** Owner confirms the physical handover of an approved loan. */
router.post('/:id/lend', (req, res) => {
  const loan = guard(req, res, { owner: true, statuses: ['approved'] });
  if (!loan) return;

  const days = Math.min(365, Math.max(1, Number(req.body?.days) || req.user.loan_days));
  const dueAt = req.body?.dueAt && /^\d{4}-\d{2}-\d{2}$/.test(req.body.dueAt) ? req.body.dueAt : addDays(days);

  db.prepare("UPDATE loans SET status = 'lent', lent_at = datetime('now'), due_at = ? WHERE id = ?").run(dueAt, loan.id);

  notify(loan.borrower_id, {
    type: 'loan_lent',
    title: 'Book on loan to you',
    body: `"${loan.book_title}" is now on loan to you until ${formatDate(dueAt)}.`,
    link: '#/borrowing'
  });

  res.json({ loan: shapeLoan(loadLoan(loan.id)) });
});

router.post('/:id/decline', (req, res) => {
  const loan = guard(req, res, { owner: true, statuses: ['requested'] });
  if (!loan) return;

  db.prepare("UPDATE loans SET status = 'declined', decided_at = datetime('now'), message = ? WHERE id = ?").run(
    String(req.body?.reason || loan.message || '').slice(0, 500),
    loan.id
  );
  notify(loan.borrower_id, {
    type: 'loan_declined',
    title: 'Loan request declined',
    body: `${loan.owner_name} declined your request for "${loan.book_title}".`,
    link: '#/borrowing'
  });
  res.json({ loan: shapeLoan(loadLoan(loan.id)) });
});

router.post('/:id/cancel', (req, res) => {
  const loan = guard(req, res, { borrower: true, statuses: ['requested', 'approved'] });
  if (!loan) return;

  db.prepare("UPDATE loans SET status = 'cancelled', decided_at = datetime('now') WHERE id = ?").run(loan.id);
  notify(loan.owner_id, {
    type: 'loan_cancelled',
    title: 'Loan request withdrawn',
    body: `${loan.borrower_name} withdrew their request for "${loan.book_title}".`,
    link: '#/lending'
  });
  res.json({ loan: shapeLoan(loadLoan(loan.id)) });
});

/** Owner asks for the book back. */
router.post('/:id/request-return', (req, res) => {
  const loan = guard(req, res, { owner: true, statuses: ['lent', 'return_requested'] });
  if (!loan) return;

  db.prepare("UPDATE loans SET status = 'return_requested', return_requested_at = datetime('now') WHERE id = ?").run(
    loan.id
  );
  notify(loan.borrower_id, {
    type: 'return_requested',
    title: 'Please return this book',
    body: `${loan.owner_name} has asked for "${loan.book_title}" back.`,
    link: '#/borrowing'
  });
  res.json({ loan: shapeLoan(loadLoan(loan.id)) });
});

/** Owner extends the due date. */
router.post('/:id/extend', (req, res) => {
  const loan = guard(req, res, { owner: true, statuses: ACTIVE_LOAN_STATUSES });
  if (!loan) return;

  const days = Math.min(365, Math.max(1, Number(req.body?.days) || 14));
  const base = loan.due_at && new Date(loan.due_at) > new Date() ? new Date(loan.due_at) : new Date();
  base.setDate(base.getDate() + days);
  const dueAt = base.toISOString().slice(0, 10);

  db.prepare("UPDATE loans SET due_at = ?, last_reminder_at = NULL, status = 'lent' WHERE id = ?").run(dueAt, loan.id);
  notify(loan.borrower_id, {
    type: 'loan_extended',
    title: 'Loan extended',
    body: `"${loan.book_title}" is now due back on ${formatDate(dueAt)}.`,
    link: '#/borrowing'
  });
  res.json({ loan: shapeLoan(loadLoan(loan.id)) });
});

/** Owner confirms the book is back on the shelf. */
router.post('/:id/return', (req, res) => {
  const loan = guard(req, res, { owner: true, statuses: ACTIVE_LOAN_STATUSES });
  if (!loan) return;

  db.prepare("UPDATE loans SET status = 'returned', returned_at = datetime('now') WHERE id = ?").run(loan.id);
  notify(loan.borrower_id, {
    type: 'loan_returned',
    title: 'Return confirmed',
    body: `${loan.owner_name} confirmed the return of "${loan.book_title}". Thank you!`,
    link: '#/borrowing'
  });
  res.json({ loan: shapeLoan(loadLoan(loan.id)) });
});

/** Borrower tells the owner the book is on its way back. */
router.post('/:id/returned-notice', (req, res) => {
  const loan = guard(req, res, { borrower: true, statuses: ACTIVE_LOAN_STATUSES });
  if (!loan) return;

  notify(loan.owner_id, {
    type: 'return_notice',
    title: 'Book returned',
    body: `${loan.borrower_name} says they have returned "${loan.book_title}". Confirm it to close the loan.`,
    link: '#/lending'
  });
  res.json({ ok: true });
});
