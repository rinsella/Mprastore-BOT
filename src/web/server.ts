import path from 'path';
import { randomBytes } from 'crypto';
import express, { Express } from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Telegram } from 'telegraf';
import { config } from '../config';
import { buildAdminRouter } from './adminRoutes';

/** Lokasi folder views & public (berlaku untuk src maupun hasil build dist). */
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const VIEWS_DIR = path.join(ROOT_DIR, 'views');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

/**
 * Buat Express app: selalu menyediakan /health, dan (opsional) web admin panel
 * bila ADMIN_WEB_ENABLED=true.
 */
export function createWebServer(telegram: Telegram): Express {
  const app = express();

  app.set('trust proxy', 1); // penting di belakang reverse proxy (Railway, Nginx) untuk secure cookie.

  // Health check selalu publik.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  if (!config.adminWebEnabled) {
    console.log('Web admin dinonaktifkan (ADMIN_WEB_ENABLED=false). Hanya /health yang aktif.');
    return app;
  }

  // Validasi minimal konfigurasi keamanan.
  if (!config.sessionSecret) {
    console.warn(
      '[WebAdmin] SESSION_SECRET kosong. Menggunakan secret acak sementara (sesi akan invalid saat restart). Set SESSION_SECRET untuk produksi.',
    );
  }
  if (!config.adminWebPasswordHash && !config.adminWebPassword) {
    console.error(
      '[WebAdmin] ADMIN_WEB_PASSWORD_HASH / ADMIN_WEB_PASSWORD belum diset. Login web admin tidak akan berhasil.',
    );
  }

  const basePath = config.adminWebPath;

  // Keamanan header HTTP.
  // Catatan: header yang hanya berfungsi di origin tepercaya (HTTPS) dimatикan
  // saat NODE_ENV bukan production agar akses langsung via http://IP:PORT tidak
  // memaksa upgrade ke https (yang menyebabkan CSS gagal dimuat / SSL error).
  const httpsAware = config.isProduction;
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          // Jangan paksa upgrade ke https; biarkan reverse proxy yang menangani HTTPS.
          upgradeInsecureRequests: null,
        },
      },
      // Header berikut diabaikan/menimbulkan warning di origin non-HTTPS.
      crossOriginOpenerPolicy: httpsAware,
      originAgentCluster: httpsAware,
      // HSTS hanya relevan di HTTPS.
      hsts: httpsAware,
    }),
  );

  // View engine.
  app.set('view engine', 'ejs');
  app.set('views', VIEWS_DIR);

  // Parser body & cookie.
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  // Static assets (CSS) di bawah base path, tanpa perlu login.
  app.use(`${basePath}/assets`, express.static(PUBLIC_DIR, { maxAge: '7d' }));

  // Session.
  app.use(
    session({
      name: 'mprastore.sid',
      secret: config.sessionSecret || randomBytes(32).toString('hex'),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: config.isProduction,
        sameSite: 'lax',
        maxAge: config.sessionMaxAgeHours * 60 * 60 * 1000,
        path: '/',
      },
    }),
  );

  // Router web admin.
  app.use(basePath, buildAdminRouter(telegram, basePath));

  console.log(`Web admin aktif di path "${basePath}" (mis. /login, /orders).`);

  return app;
}
