import { Telegraf } from 'telegraf';
import { BotContext } from '../types';
import { upsertUser } from '../services/orderService';
import { isAdmin, webAdminUrl } from '../config';

const CUSTOMER_START = [
  'Halo 👋',
  'Selamat datang di *Mprastore Bot* — bot untuk mengubah *nameserver domain* kamu.',
  '',
  '🚀 Mulai pesanan: /order',
  '📦 Cek status pesanan: /status',
  'ℹ️ Panduan lengkap: /help',
  '',
  'Ketik /help dulu kalau kamu baru pertama kali agar paham alurnya.',
].join('\n');

const CUSTOMER_HELP = [
  '📖 *Panduan Mprastore Bot*',
  '',
  'Bot ini membantu kamu mengubah *nameserver* domain. Cukup kirim domain & nameserver tujuan, admin akan memproses, lalu bot mengecek koneksi otomatis.',
  '',
  '━━━━━━━━━━━━━━━━',
  '🧭 *Cara Order (Langkah demi Langkah)*',
  '━━━━━━━━━━━━━━━━',
  '*1.* Ketik /order untuk memulai.',
  '*2.* Masukkan nama domain kamu.',
  '    Contoh: `example.com`',
  '    (tanpa http://, tanpa www, tanpa garis miring)',
  '*3.* Pilih tipe nameserver lewat tombol:',
  '    • ☁️ *Cloudflare* — jika pakai Cloudflare',
  '    • 🔧 *Custom* — nameserver hosting lain',
  '*4.* Kirim nameserver tujuan (minimal 2), satu per baris.',
  '    Contoh:',
  '    `adam.ns.cloudflare.com`',
  '    `vera.ns.cloudflare.com`',
  '*5.* Periksa ringkasan, lalu tekan *✅ Buat Order*.',
  '',
  '━━━━━━━━━━━━━━━━',
  '🔄 *Setelah Order Dibuat*',
  '━━━━━━━━━━━━━━━━',
  '• Admin akan *meninjau & menyetujui* pesanan kamu.',
  '• Setelah diproses, bot mengecek nameserver otomatis via RDAP/ICANN.',
  '• Kamu akan dapat notifikasi saat domain *sudah terhubung* ✅.',
  '',
  '⚠️ *Penting:* Ubah nameserver di tempat kamu beli domain (registrar) sesuai instruksi admin, agar domain bisa terhubung.',
  '',
  '━━━━━━━━━━━━━━━━',
  '📊 *Arti Status Pesanan*',
  '━━━━━━━━━━━━━━━━',
  '• *Menunggu Admin* — pesanan masuk, menunggu ditinjau.',
  '• *Disetujui* — admin menerima & akan memproses.',
  '• *Sudah Diproses Admin* — sedang dicek koneksinya.',
  '• *Menunggu Propagasi* — nameserver sedang menyebar (bisa beberapa jam).',
  '• *Terhubung* ✅ — nameserver sudah cocok.',
  '• *Selesai* 🎉 — pesanan tuntas.',
  '• *Ditolak* ❌ — lihat alasan dari admin.',
  '',
  '━━━━━━━━━━━━━━━━',
  '⌨️ *Daftar Perintah*',
  '━━━━━━━━━━━━━━━━',
  '/order — Buat order ubah nameserver',
  '/status — Cek status pesanan kamu',
  '/cancel — Batalkan proses order yang sedang berjalan',
  '/help — Tampilkan panduan ini',
  '',
  '💬 Ada kendala? Tunggu balasan admin atau hubungi admin lewat kontak yang diberikan.',
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
      await ctx.reply(CUSTOMER_START, {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
      });
    }
  });

  bot.help(async (ctx) => {
    if (isAdmin(ctx.from?.id)) {
      await ctx.reply(adminHelpMessage(), {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
      });
    } else {
      await ctx.reply(CUSTOMER_HELP, {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
      });
    }
  });
}
