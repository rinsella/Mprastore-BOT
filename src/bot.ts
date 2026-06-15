import { Telegraf, session } from 'telegraf';
import { config } from './config';
import { BotContext, BotSession } from './types';
import { rateLimit } from './middlewares/rateLimit';
import { registerStartCommands } from './commands/start';
import { registerStatusCommands } from './commands/status';
import { registerAdminCommands } from './commands/admin';
import { registerOrderCommands, handleOrderText } from './commands/order';

/**
 * Buat dan konfigurasikan instance bot Telegraf.
 */
export function createBot(): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(config.botToken);

  // Session middleware (in-memory). Untuk multi-instance, ganti store sesuai kebutuhan.
  bot.use(
    session<BotSession, BotContext>({
      defaultSession: (): BotSession => ({ order: { step: 'idle' } }),
    }),
  );

  // Rate limit sederhana untuk mencegah spam.
  bot.use(rateLimit);

  // Daftarkan command-command.
  registerStartCommands(bot);
  registerOrderCommands(bot);
  registerStatusCommands(bot);
  registerAdminCommands(bot);

  // Handler teks umum: routing ke alur order bila sesi aktif.
  bot.on('text', async (ctx, next) => {
    const handled = await handleOrderText(ctx);
    if (!handled) {
      await next();
    }
  });

  // Fallback untuk teks yang tidak dikenali.
  bot.on('text', async (ctx) => {
    await ctx.reply('Perintah tidak dikenali. Ketik /help untuk bantuan.');
  });

  // Error handler global.
  bot.catch((err, ctx) => {
    // Jangan log token; cukup pesan error.
    console.error(`Error pada update ${ctx.updateType}:`, (err as Error).message);
  });

  return bot;
}
