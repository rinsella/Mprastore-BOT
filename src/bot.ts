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

/**
 * Set menu command Telegram saat startup.
 * - Command global (default) untuk customer.
 * - Command tambahan ber-scope chat untuk tiap admin (best-effort).
 */
export async function setupBotCommands(bot: Telegraf<BotContext>): Promise<void> {
  const customerCommands = [
    { command: 'start', description: 'Mulai & info bot' },
    { command: 'order', description: 'Buat order ubah nameserver' },
    { command: 'status', description: 'Cek status pesanan kamu' },
    { command: 'cancel', description: 'Batalkan proses order' },
    { command: 'help', description: 'Bantuan' },
  ];

  const adminCommands = [
    { command: 'admin', description: 'Panel admin' },
    { command: 'orders', description: '10 order terbaru' },
    { command: 'pending', description: 'Order yang perlu diproses' },
    { command: 'connected', description: 'Order yang sudah connect' },
    { command: 'lookup', description: 'Cek RDAP manual' },
    { command: 'webadmin', description: 'Link panel web admin' },
    { command: 'help', description: 'Bantuan admin' },
  ];

  try {
    // Default (semua user).
    await bot.telegram.setMyCommands(customerCommands);

    // Scope khusus tiap admin.
    for (const adminId of config.adminIds) {
      try {
        await bot.telegram.setMyCommands(adminCommands, {
          scope: { type: 'chat', chat_id: Number(adminId) },
        });
      } catch (err) {
        console.error('Gagal set command admin:', (err as Error).message);
      }
    }
    console.log('Menu command Telegram berhasil diset.');
  } catch (err) {
    console.error('Gagal set menu command Telegram:', (err as Error).message);
  }
}
