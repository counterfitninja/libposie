# Libposie

A self-hosted, multi-user personal book library. Scan the barcode on a book, pick the right
edition from several metadata sources, and it lands in your catalogue. Share what you like,
lend it to other members, and get reminded when it is time to ask for it back.

Runs as a single Node.js process with a SQLite file for storage, and installs to your phone
or desktop as a PWA.

## Features

**Cataloguing**
- Barcode scanning with the device camera (native `BarcodeDetector`, falling back to ZXing).
- ISBN / title / author lookup across **Open Library**, **Google Books** and optionally **ISBNdb**,
  merged and de-duplicated so you can pick the edition that matches your copy.
- Every field is editable before and after saving — including the cover image URL.
- Duplicate detection when you scan something already on your shelves.
- Personal categories with colours, plus shelf location, condition and rating.

**Notes**
- Public notes are visible to anyone who can see the book.
- Private notes are only ever visible to you, even on books you have shared.

**Multi-user & lending**
- Each member has their own library. Books are private by default; flip a book to *public*
  to list it in the shared catalogue.
- Members request a loan, the owner approves and sets a loan period, and the app tracks the
  lend date and due date.
- Owners can chase a book back, extend the loan, or mark it returned. Borrowers can withdraw
  a request or tell the owner the book is on its way back.
- Full loan history per book.

**Notifications**
- In-app notification centre with an unread badge.
- Web push to mobile and desktop (install to home screen for the best results on iOS).
- A daily sweep at 09:00 sends "due soon", "due today" and "overdue" reminders. The lead time
  is configurable per member.

**Admin**
- Every member gets a lending desk for their own library: pending requests, who has what,
  what is overdue, and one-tap chase/extend/return.
- The first account created becomes the server administrator, who can promote, disable,
  reset passwords for or delete members, and trigger the reminder sweep manually.

## Requirements

- Node.js **22.5 or newer** (uses the built-in `node:sqlite` — no native build tools needed).

## Getting started

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
```

`JWT_SECRET` is generated automatically on first boot, but for a long-lived install it is better to
set it yourself so sessions survive a wiped data directory:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Then:

```bash
npm start
```

Open <http://localhost:3000>. **The first account you register becomes the administrator.**
Once everyone has signed up, set `ALLOW_REGISTRATION=0` in `.env` and restart to close registration.

## Configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port (default `3000`). |
| `DATA_DIR` | Where `libposie.sqlite` is written (default `./data`). |
| `JWT_SECRET` | Signs session cookies. If unset, one is generated on first boot and stored in `<DATA_DIR>/.jwt-secret`. |
| `SECURE_COOKIES` | Set to `1` when serving over HTTPS. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web push keys. Generated and stored automatically on first run if omitted — set them explicitly to keep subscriptions working across database resets. |
| `VAPID_SUBJECT` | Contact `mailto:` for push services. |
| `GOOGLE_BOOKS_API_KEY` | Optional. The anonymous Google Books quota is shared and frequently exhausted; a free key makes that source reliable. |
| `ISBNDB_API_KEY` | Optional third metadata source. |
| `ALLOW_REGISTRATION` | `0` closes sign-ups (the very first account is always allowed). |

Generate push keys explicitly with `npm run generate-vapid`.

## Hosting on Pelican Panel

An importable egg is included at [eggs/egg-libposie.json](eggs/egg-libposie.json).

1. In the Pelican admin area go to **Eggs → Import Egg** and upload `egg-libposie.json`.
2. Create a server using the **Libposie** egg. Pick the **Node.js 22** (or 24) Docker image.
3. Leave **Session secret** blank — one is generated on first boot and stored in `data/.jwt-secret`.
4. Start the server and open its allocation in a browser. **The first account you register becomes
   the administrator**; afterwards set **Allow registration** to `0` and restart.

The egg installs from Git, so **Reinstall** pulls the current branch again. Set **Auto update on boot**
to `1` to fetch and reinstall dependencies on every start. Point **Repository address** at your own
fork if you have one; private repositories work by filling in the Git username and access token.

Notes specific to panel hosting:

- The server binds `0.0.0.0` and uses the panel's `SERVER_PORT` automatically.
- Everything persistent lives in `data/`, which survives reinstalls — take backups from there.
- Put the allocation behind an HTTPS reverse proxy and set **Secure cookies (HTTPS)** to `1`.
  Without HTTPS, browsers block camera scanning and push notifications on anything but `localhost`.

## Camera scanning and HTTPS

Browsers only grant camera access and register service workers on **secure origins**:
`localhost` works for local testing, but to scan barcodes or receive push notifications from
another device on your network you must serve Libposie over HTTPS — typically by putting it
behind a reverse proxy (Caddy, nginx, Traefik) with a certificate.

When running behind a proxy, set `SECURE_COOKIES=1`.

If a camera is unavailable, every screen still lets you type or paste an ISBN.

## Data and backups

Everything lives in `data/libposie.sqlite` (plus its WAL sidecar files). Stop the server and
copy that directory to take a backup.

## Testing

With the server running:

```bash
node scripts/smoke-test.js
```

This registers two throwaway users and exercises registration, cataloguing, note visibility,
cross-user permission checks, the full lending workflow, notifications and the admin overview.

## Project layout

```
server/
  index.js              Express app, security headers, static hosting
  db.js                 SQLite schema and connection
  auth.js               Password hashing, JWT cookie sessions, guards
  shape.js              Row -> API shaping and per-viewer field hiding
  notifications.js      In-app notifications + web push delivery
  jobs/reminders.js     Daily due-date reminder sweep
  routes/               auth, books, categories, lookup, loans, notifications, users
  services/metadata.js  Open Library / Google Books / ISBNdb lookup
public/
  index.html sw.js manifest.webmanifest
  css/styles.css
  js/app.js api.js ui.js scanner.js views/*
```

## Security notes

- Passwords are hashed with bcrypt; sessions are httpOnly, `SameSite=Strict` JWT cookies.
- All SQL uses bound parameters; every book, note, category and loan route re-checks ownership.
- Login, registration, password change and metadata lookup are rate limited.
- A strict Content-Security-Policy is applied; the app contains no inline scripts.
