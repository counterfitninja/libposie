import cron from 'node-cron';
import { db } from '../db.js';
import { notify } from '../notifications.js';

function daysBetween(a, b) {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Notifies borrowers when a loan is nearly due or overdue, and tells the owner
 * about overdue books. Each loan is reminded at most once per day.
 */
export function runReminderSweep() {
  const loans = db
    .prepare(
      `SELECT l.*, b.title AS book_title,
              ob.display_name AS owner_name, ob.reminder_days AS owner_reminder_days,
              br.display_name AS borrower_name
       FROM loans l
       JOIN books b ON b.id = l.book_id
       JOIN users ob ON ob.id = l.owner_id
       JOIN users br ON br.id = l.borrower_id
       WHERE l.status IN ('lent','return_requested') AND l.due_at IS NOT NULL`
    )
    .all();

  const today = new Date(new Date().toISOString().slice(0, 10));
  const stamp = db.prepare("UPDATE loans SET last_reminder_at = datetime('now') WHERE id = ?");
  let sent = 0;

  for (const loan of loans) {
    if (loan.last_reminder_at && new Date(loan.last_reminder_at).toISOString().slice(0, 10) === today.toISOString().slice(0, 10)) {
      continue;
    }

    const due = new Date(loan.due_at);
    const remaining = daysBetween(due, today);
    const lead = loan.owner_reminder_days ?? 3;

    if (remaining < 0) {
      const overdueBy = Math.abs(remaining);
      notify(loan.borrower_id, {
        type: 'loan_overdue',
        title: 'Book overdue',
        body: `"${loan.book_title}" was due back to ${loan.owner_name} ${overdueBy} day${overdueBy === 1 ? '' : 's'} ago.`,
        link: '#/borrowing'
      });
      notify(loan.owner_id, {
        type: 'loan_overdue_owner',
        title: 'Loan overdue',
        body: `${loan.borrower_name} still has "${loan.book_title}" — ${overdueBy} day${overdueBy === 1 ? '' : 's'} past the due date.`,
        link: '#/lending'
      });
      stamp.run(loan.id);
      sent++;
    } else if (remaining === 0) {
      notify(loan.borrower_id, {
        type: 'loan_due',
        title: 'Book due back today',
        body: `"${loan.book_title}" is due back to ${loan.owner_name} today.`,
        link: '#/borrowing'
      });
      stamp.run(loan.id);
      sent++;
    } else if (lead > 0 && remaining <= lead) {
      notify(loan.borrower_id, {
        type: 'loan_due_soon',
        title: 'Book due soon',
        body: `"${loan.book_title}" is due back to ${loan.owner_name} on ${formatDate(loan.due_at)}.`,
        link: '#/borrowing'
      });
      stamp.run(loan.id);
      sent++;
    }
  }

  return sent;
}

export function startReminderJob() {
  // Every day at 09:00 server time.
  cron.schedule('0 9 * * *', () => {
    try {
      const n = runReminderSweep();
      if (n) console.log(`Loan reminders: ${n} notification set(s) sent.`);
    } catch (err) {
      console.error('Reminder sweep failed:', err);
    }
  });
}
