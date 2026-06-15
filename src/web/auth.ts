import { randomBytes, timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config';

/**
 * Augmentasi tipe session express-session untuk data login admin.
 */
declare module 'express-session' {
  interface SessionData {
    authenticated?: boolean;
    username?: string;
    csrfToken?: string;
    flash?: { type: 'success' | 'error' | 'info'; message: string };
  }
}

let warnedPlainPassword = false;

/**
 * Verifikasi kredensial login admin web.
 * - Prioritaskan ADMIN_WEB_PASSWORD_HASH (bcrypt).
 * - Jika hanya ADMIN_WEB_PASSWORD yang ada, tetap diizinkan namun beri peringatan di log.
 * - Tidak pernah mencatat password asli.
 */
export async function verifyAdminLogin(username: string, password: string): Promise<boolean> {
  // Bandingkan username secara timing-safe.
  if (!safeEqual(username, config.adminWebUsername)) {
    return false;
  }

  if (config.adminWebPasswordHash) {
    try {
      return await bcrypt.compare(password, config.adminWebPasswordHash);
    } catch {
      return false;
    }
  }

  if (config.adminWebPassword) {
    if (!warnedPlainPassword) {
      console.warn(
        '[WebAdmin] Menggunakan ADMIN_WEB_PASSWORD (teks biasa). Sangat disarankan memakai ADMIN_WEB_PASSWORD_HASH (bcrypt).',
      );
      warnedPlainPassword = true;
    }
    return safeEqual(password, config.adminWebPassword);
  }

  return false;
}

/** Perbandingan string timing-safe untuk mengurangi kebocoran via waktu. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Middleware: hanya lanjut bila session sudah terautentikasi.
 * Jika belum, redirect ke halaman login.
 */
export function requireAuth(basePath: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.session && req.session.authenticated) {
      next();
      return;
    }
    res.redirect(`${basePath}/login`);
  };
}

/**
 * Pastikan token CSRF ada di session dan tersedia untuk view.
 */
export function ensureCsrfToken(req: Request, res: Response, next: NextFunction): void {
  if (req.session && !req.session.csrfToken) {
    req.session.csrfToken = randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session?.csrfToken ?? '';
  next();
}

/**
 * Verifikasi token CSRF untuk request POST.
 */
export function verifyCsrf(req: Request, res: Response, next: NextFunction): void {
  const sent = (req.body && (req.body._csrf as string)) || (req.headers['x-csrf-token'] as string);
  const expected = req.session?.csrfToken;
  if (!expected || !sent || !safeEqual(String(sent), String(expected))) {
    res.status(403).send('Token CSRF tidak valid. Muat ulang halaman dan coba lagi.');
    return;
  }
  next();
}

interface LoginAttempt {
  count: number;
  firstAt: number;
  blockedUntil: number;
}

const loginAttempts = new Map<string, LoginAttempt>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 menit
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;

function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Rate limit sederhana untuk percobaan login (anti brute-force).
 * Mengembalikan true bila request diblokir.
 */
export function isLoginBlocked(req: Request): boolean {
  const key = clientKey(req);
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  const now = Date.now();
  if (entry.blockedUntil > now) return true;
  if (now - entry.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }
  return false;
}

/** Catat percobaan login gagal. */
export function registerFailedLogin(req: Request): void {
  const key = clientKey(req);
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAt: now, blockedUntil: 0 });
    return;
  }
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    entry.blockedUntil = now + LOGIN_BLOCK_MS;
  }
}

/** Reset percobaan login setelah berhasil. */
export function clearLoginAttempts(req: Request): void {
  loginAttempts.delete(clientKey(req));
}
