import { db, ACTIVE_LOAN_STATUSES, OPEN_LOAN_STATUSES } from './db.js';

const activePlaceholders = ACTIVE_LOAN_STATUSES.map(() => '?').join(',');
const openPlaceholders = OPEN_LOAN_STATUSES.map(() => '?').join(',');

const selectCategories = db.prepare(
  `SELECT c.id, c.name, c.colour
   FROM book_categories bc JOIN categories c ON c.id = bc.category_id
   WHERE bc.book_id = ? ORDER BY c.name COLLATE NOCASE`
);

const selectActiveLoan = db.prepare(
  `SELECT l.*, u.username AS borrower_username, u.display_name AS borrower_name
   FROM loans l JOIN users u ON u.id = l.borrower_id
   WHERE l.book_id = ? AND l.status IN (${activePlaceholders})
   ORDER BY l.id DESC LIMIT 1`
);

const selectOpenLoanForUser = db.prepare(
  `SELECT * FROM loans
   WHERE book_id = ? AND borrower_id = ? AND status IN (${openPlaceholders})
   ORDER BY id DESC LIMIT 1`
);

export function getActiveLoan(bookId) {
  return selectActiveLoan.get(bookId, ...ACTIVE_LOAN_STATUSES) || null;
}

export function getOpenLoanForUser(bookId, userId) {
  return selectOpenLoanForUser.get(bookId, userId, ...OPEN_LOAN_STATUSES) || null;
}

export function shapeLoan(loan) {
  if (!loan) return null;
  return {
    id: loan.id,
    bookId: loan.book_id,
    ownerId: loan.owner_id,
    borrowerId: loan.borrower_id,
    status: loan.status,
    message: loan.message,
    requestedAt: loan.requested_at,
    decidedAt: loan.decided_at,
    lentAt: loan.lent_at,
    dueAt: loan.due_at,
    returnRequestedAt: loan.return_requested_at,
    returnedAt: loan.returned_at,
    bookTitle: loan.book_title,
    coverUrl: loan.cover_url,
    borrower: loan.borrower_name ? { id: loan.borrower_id, name: loan.borrower_name, username: loan.borrower_username } : null,
    owner: loan.owner_name ? { id: loan.owner_id, name: loan.owner_name, username: loan.owner_username } : null,
    overdue: !!(loan.due_at && !loan.returned_at && new Date(loan.due_at) < new Date())
  };
}

/**
 * Convert a book row into the API shape, hiding owner-only fields from other users.
 */
export function shapeBook(row, viewerId) {
  const isOwner = row.owner_id === viewerId;
  const loan = getActiveLoan(row.id);
  const book = {
    id: row.id,
    ownerId: row.owner_id,
    owner: row.owner_name ? { id: row.owner_id, name: row.owner_name, username: row.owner_username } : null,
    title: row.title,
    subtitle: row.subtitle,
    authors: row.authors,
    publisher: row.publisher,
    publishedDate: row.published_date,
    isbn10: row.isbn10,
    isbn13: row.isbn13,
    pageCount: row.page_count,
    language: row.language,
    description: row.description,
    coverUrl: row.cover_url,
    source: row.source,
    rating: row.rating,
    isPublic: !!row.is_public,
    lendable: !!row.lendable,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isOwner,
    categories: isOwner ? selectCategories.all(row.id) : [],
    availability: loan ? 'on_loan' : row.lendable ? 'available' : 'not_lendable',
    activeLoan: loan
      ? isOwner
        ? shapeLoan(loan)
        : { status: loan.status, dueAt: loan.due_at, id: loan.borrower_id === viewerId ? loan.id : null }
      : null
  };
  if (isOwner) {
    book.shelf = row.shelf;
    book.condition = row.condition;
  }
  if (viewerId) {
    const mine = getOpenLoanForUser(row.id, viewerId);
    book.myLoan = mine ? shapeLoan(mine) : null;
  }
  return book;
}

export const BOOK_SELECT = `
  SELECT b.*, u.display_name AS owner_name, u.username AS owner_username
  FROM books b JOIN users u ON u.id = b.owner_id`;
