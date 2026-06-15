import { Telegraf } from 'telegraf';
import { BotContext } from '../types';
import { upsertUser } from '../services/orderService';

const START_MESSAGE = [
  'Halo 👋',
  'Saya bot order nameserver domain.',
  '',
  'Kamu bisa membuat pesanan ubah nameserver dengan perintah:',
  '/order',
  '',
  'Cek status pesanan:',
  '/status',
  '',
  'Butuh bantuan? ketik /help',
].join('\n');

const HELP_MESSAGE = [
  'ℹ️ Bantuan',
  '',
  'Perintah yang tersedia:',
  '/order - Buat order ubah nameserver',
  '/status - Cek status pesanan kamu',
  '/cancel - Batalkan proses order yang sedang berjalan',
  '/help - Tampilkan bantuan ini',
  '',
  'Alur order:',
  '1. Masukkan nama domain',
  '2. Pilih tipe nameserver (Cloudflare / Custom)',
  '3. Kirim nameserver tujuan',
  '4. Konfirmasi order',
  '',
  'Setelah order dibuat, admin akan memproses dan bot akan',
  'mengecek koneksi domain secara otomatis melalui RDAP/ICANN.',
].join('\n');

/**
 * Daftarkan command /start dan /help.
 */
export function registerStartCommands(bot: Telegraf<BotContext>): void {
  bot.start(async (ctx) => {
    try {
      await upsertUser({
        telegramId: ctx.from.id,
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
      });
    } catch {
      /* abaikan kegagalan upsert agar /start tetap responsif */
    }
    await ctx.reply(START_MESSAGE);
  });

  bot.help(async (ctx) => {
    await ctx.reply(HELP_MESSAGE);
  });
}
