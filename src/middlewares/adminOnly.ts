import { isAdmin } from '../config';
import { BotContext } from '../types';

/**
 * Middleware yang hanya melanjutkan jika pemanggil adalah admin.
 * Mencegah non-admin menjalankan command/aksi admin.
 */
export async function adminOnly(
  ctx: BotContext,
  next: () => Promise<void>,
): Promise<void> {
  const fromId = ctx.from?.id;
  if (!isAdmin(fromId)) {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('Akses ditolak. Hanya admin.', { show_alert: true });
    } else {
      await ctx.reply('⛔ Maaf, perintah ini hanya untuk admin.');
    }
    return;
  }
  await next();
}

/**
 * Helper guard untuk dipakai langsung di dalam handler.
 * Mengembalikan true bila pemanggil bukan admin (dan sudah membalas pesan tolak).
 */
export async function blockIfNotAdmin(ctx: BotContext): Promise<boolean> {
  const fromId = ctx.from?.id;
  if (!isAdmin(fromId)) {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('Akses ditolak. Hanya admin.', { show_alert: true });
    } else {
      await ctx.reply('⛔ Maaf, perintah ini hanya untuk admin.');
    }
    return true;
  }
  return false;
}
