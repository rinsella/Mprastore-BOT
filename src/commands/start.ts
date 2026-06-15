import { Telegraf } from 'telegraf';
import { BotContext } from '../types';
import { upsertUser } from '../services/orderService';
import { isAdmin, webAdminUrl } from '../config';

const CUSTOMER_START = [
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

const CUSTOMER_HELP = [
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

/** Pesan /start untuk admin (termasuk link panel web bila dikonfigurasi). */
function adminStartMessage(): string {
  const web = webAdminUrl();
  return [
    'Halo Admin 👋',
    'Kamu login sebagai admin Mprastore Bot.',
    '',
    'Panel Telegram:',
    '/admin',
    '/orders',
    '/pending',
    '/connected',
    '/detail',
    '/lookup',
    '',
    'Panel Web:',
    web ?? '(WEB_PUBLIC_URL belum dikonfigurasi)',
  ].join('\n');
}

/** Pesan /help untuk admin (customer help + perintah admin). */
function adminHelpMessage(): string {
  const web = webAdminUrl();
  return [
    CUSTOMER_HELP,
    '',
    '— — —',
    '',
    'Perintah Admin:',
    '/admin - Panel admin',
    '/orders - 10 order terbaru',
    '/pending - Order yang perlu diproses',
    '/connected - Order yang sudah connect',
    '/detail <id> - Detail order',
    '/lookup <domain> - Cek RDAP manual',
    '/reject <id> <alasan> - Tolak order',
    '/webadmin - Link panel web admin',
    '',
    'Panel Web:',
    web ?? '(WEB_PUBLIC_URL belum dikonfigurasi)',
  ].join('\n');
}

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
    if (isAdmin(ctx.from.id)) {
      await ctx.reply(adminStartMessage(), { link_preview_options: { is_disabled: true } });
    } else {
      await ctx.reply(CUSTOMER_START);
    }
  });

  bot.help(async (ctx) => {
    if (isAdmin(ctx.from?.id)) {
      await ctx.reply(adminHelpMessage(), { link_preview_options: { is_disabled: true } });
    } else {
      await ctx.reply(CUSTOMER_HELP);
    }
  });
}
