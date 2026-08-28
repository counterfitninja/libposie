import webpush from 'web-push';
import { db, getSetting, setSetting } from './db.js';

let pushReady = false;

export function initPush() {
  let publicKey = process.env.VAPID_PUBLIC_KEY || getSetting('vapid_public_key');
  let privateKey = process.env.VAPID_PRIVATE_KEY || getSetting('vapid_private_key');

  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    setSetting('vapid_public_key', publicKey);
    setSetting('vapid_private_key', privateKey);
    console.log('Generated and stored new VAPID keys in the database.');
  } else {
    setSetting('vapid_public_key', publicKey);
    setSetting('vapid_private_key', privateKey);
  }

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@localhost', publicKey, privateKey);
  pushReady = true;
}

export function getVapidPublicKey() {
  return getSetting('vapid_public_key');
}

const insertNotification = db.prepare(
  'INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)'
);
const selectSubs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?');
const deleteSub = db.prepare('DELETE FROM push_subscriptions WHERE id = ?');

/**
 * Store an in-app notification and best-effort deliver a web push message.
 */
export function notify(userId, { type, title, body = '', link = '/' }) {
  insertNotification.run(userId, type, title, body, link);
  if (!pushReady) return;

  const payload = JSON.stringify({ title, body, link, type });
  for (const sub of selectSubs.all(userId)) {
    webpush
      .sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      )
      .catch((err) => {
        if (err.statusCode === 404 || err.statusCode === 410) deleteSub.run(sub.id);
        else console.warn('Push delivery failed:', err.statusCode || err.message);
      });
  }
}
