import express from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { getVapidPublicKey } from '../notifications.js';

export const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100')
    .all(req.user.id);
  const unread = rows.filter((n) => !n.read_at).length;
  res.json({
    unread,
    notifications: rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      read: !!n.read_at,
      createdAt: n.created_at
    }))
  });
});

router.post('/read', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
  if (ids?.length) {
    const stmt = db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ?");
    for (const id of ids) stmt.run(id, req.user.id);
  } else {
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(
      req.user.id
    );
  }
  res.json({ ok: true });
});

router.delete('/', (req, res) => {
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------ web push */

router.get('/push/key', (_req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

router.post('/push/subscribe', (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Invalid push subscription.' });
  }
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
  ).run(req.user.id, endpoint, keys.p256dh, keys.auth);
  res.json({ ok: true });
});

router.post('/push/unsubscribe', (req, res) => {
  if (req.body?.endpoint) {
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(
      req.body.endpoint,
      req.user.id
    );
  }
  res.json({ ok: true });
});
