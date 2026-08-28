import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';

import { attachUser, requireAdmin, requireAuth } from './auth.js';
import { initPush } from './notifications.js';
import { startReminderJob, runReminderSweep } from './jobs/reminders.js';

import { router as authRoutes } from './routes/auth.js';
import { router as bookRoutes } from './routes/books.js';
import { router as categoryRoutes } from './routes/categories.js';
import { router as lookupRoutes } from './routes/lookup.js';
import { router as loanRoutes } from './routes/loans.js';
import { router as notificationRoutes } from './routes/notifications.js';
import { router as userRoutes } from './routes/users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'", 'blob:'],
        workerSrc: ["'self'", 'blob:'],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);
app.use(compression());
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(attachUser);

app.use('/api/auth', authRoutes);
app.use('/api/books', bookRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/lookup', lookupRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/users', userRoutes);

app.post('/api/admin/run-reminders', requireAuth, requireAdmin, (_req, res) => {
  res.json({ sent: runReminderSweep() });
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Barcode scanning library, served locally so the PWA works offline / on a LAN.
app.use(
  '/vendor/zxing',
  express.static(path.join(__dirname, '..', 'node_modules', '@zxing', 'library', 'umd'), {
    maxAge: '30d',
    immutable: true
  })
);

app.use(
  express.static(publicDir, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    }
  })
);

// SPA fallback for client-side routes.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

initPush();
startReminderJob();

const port = Number(process.env.PORT || process.env.SERVER_PORT) || 3000;
const host = process.env.BIND_ADDRESS || '0.0.0.0';
app.listen(port, host, () => {
  console.log(`Libposie listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
});
