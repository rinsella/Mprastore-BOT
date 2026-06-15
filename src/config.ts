import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Skema validasi environment variables.
 * Tidak ada nilai rahasia yang di-hardcode; semua diambil dari .env.
 */
const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN wajib diisi'),
  ADMIN_IDS: z.string().min(1, 'ADMIN_IDS wajib diisi'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL wajib diisi'),
  CHECK_INTERVAL_MINUTES: z
    .string()
    .optional()
    .default('10')
    .transform((v) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? n : 10;
    }),
  NODE_ENV: z.string().optional().default('production'),
  PORT: z
    .string()
    .optional()
    .default('3000')
    .transform((v) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? n : 3000;
    }),

  // ===== Konfigurasi Web Admin Panel =====
  WEB_PUBLIC_URL: z.string().optional().default(''),
  ADMIN_WEB_ENABLED: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true' || v === '1'),
  ADMIN_WEB_PATH: z
    .string()
    .optional()
    .default('/admin')
    .transform((v) => {
      // Pastikan diawali '/' dan tanpa trailing slash.
      let p = (v || '/admin').trim();
      if (!p.startsWith('/')) p = '/' + p;
      p = p.replace(/\/+$/, '');
      return p.length > 0 ? p : '/admin';
    }),
  ADMIN_WEB_USERNAME: z.string().optional().default('admin'),
  ADMIN_WEB_PASSWORD_HASH: z.string().optional().default(''),
  ADMIN_WEB_PASSWORD: z.string().optional().default(''),
  SESSION_SECRET: z.string().optional().default(''),
  SESSION_MAX_AGE_HOURS: z
    .string()
    .optional()
    .default('8')
    .transform((v) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? n : 8;
    }),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
  // Jangan pernah log token. Hanya tampilkan field yang gagal.
  console.error('Konfigurasi environment tidak valid:\n' + issues);
  process.exit(1);
}

const env = parsed.data;

/**
 * Daftar ID admin (mendukung banyak admin dipisahkan koma).
 */
const adminIds: bigint[] = env.ADMIN_IDS.split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
  .map((s) => {
    try {
      return BigInt(s);
    } catch {
      throw new Error(`ADMIN_IDS berisi nilai tidak valid: ${s}`);
    }
  });

if (adminIds.length === 0) {
  console.error('ADMIN_IDS tidak boleh kosong.');
  process.exit(1);
}

export const config = {
  botToken: env.BOT_TOKEN,
  adminIds,
  databaseUrl: env.DATABASE_URL,
  checkIntervalMinutes: env.CHECK_INTERVAL_MINUTES,
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  isProduction: env.NODE_ENV === 'production',

  // Web admin panel.
  webPublicUrl: env.WEB_PUBLIC_URL.replace(/\/+$/, ''),
  adminWebEnabled: env.ADMIN_WEB_ENABLED,
  adminWebPath: env.ADMIN_WEB_PATH,
  adminWebUsername: env.ADMIN_WEB_USERNAME,
  adminWebPasswordHash: env.ADMIN_WEB_PASSWORD_HASH,
  adminWebPassword: env.ADMIN_WEB_PASSWORD,
  sessionSecret: env.SESSION_SECRET,
  sessionMaxAgeHours: env.SESSION_MAX_AGE_HOURS,
};

/**
 * URL lengkap web admin (WEB_PUBLIC_URL + ADMIN_WEB_PATH) bila dikonfigurasi.
 * Mengembalikan null jika WEB_PUBLIC_URL kosong.
 */
export function webAdminUrl(): string | null {
  if (!config.webPublicUrl) return null;
  return config.webPublicUrl + config.adminWebPath;
}

/**
 * Cek apakah suatu Telegram ID merupakan admin.
 */
export function isAdmin(telegramId: number | bigint | undefined | null): boolean {
  if (telegramId === undefined || telegramId === null) return false;
  const id = BigInt(telegramId);
  return config.adminIds.some((a) => a === id);
}
