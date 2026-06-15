import { BotContext } from '../types';

/**
 * Rate limit sederhana berbasis memori untuk mencegah spam.
 * Default: maksimal 20 update per 10 detik per user.
 */
const WINDOW_MS = 10_000;
const MAX_HITS = 20;

const hits = new Map<number, { count: number; resetAt: number }>();

export async function rateLimit(
  ctx: BotContext,
  next: () => Promise<void>,
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) {
    await next();
    return;
  }

  const now = Date.now();
  const entry = hits.get(userId);

  if (!entry || now > entry.resetAt) {
    hits.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    await next();
    return;
  }

  entry.count += 1;
  if (entry.count > MAX_HITS) {
    // Diamkan kelebihan request agar tidak spam balasan.
    if (entry.count === MAX_HITS + 1) {
      try {
        await ctx.reply('⏳ Terlalu banyak permintaan. Mohon tunggu sebentar.');
      } catch {
        /* abaikan */
      }
    }
    return;
  }

  await next();
}
