import { Telegraf, Markup } from 'telegraf';
import { NsType } from '@prisma/client';
import { BotContext } from '../types';
import { validateDomain } from '../utils/domain';
import { parseNameservers } from '../utils/nameserver';
import { createOrder } from '../services/orderService';
import {
  buildAdminOrderKeyboard,
  buildAdminOrderNotification,
} from './admin';
import { config } from '../config';

function resetSession(ctx: BotContext): void {
  ctx.session.order = { step: 'idle' };
}

function nsTypeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('☁️ Cloudflare', 'ns_type:cloudflare')],
    [Markup.button.callback('🔧 Non-Cloudflare / Custom', 'ns_type:custom')],
  ]);
}

function confirmKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Buat Order', 'order_confirm')],
    [Markup.button.callback('❌ Batal', 'order_cancel')],
  ]);
}

function buildSummary(ctx: BotContext): string {
  const o = ctx.session.order!;
  const nsTypeText = o.nsType === NsType.CLOUDFLARE ? 'Cloudflare' : 'Custom / Non-Cloudflare';
  const username = ctx.from?.username ? '@' + ctx.from.username : '(tidak ada)';
  return [
    '📝 Ringkasan Order',
    '',
    `Domain: ${o.domain}`,
    `Tipe Nameserver: ${nsTypeText}`,
    '',
    'Nameserver tujuan:',
    (o.nameservers ?? []).map((n) => `- ${n}`).join('\n'),
    '',
    `Username Telegram: ${username}`,
    '',
    'Lanjut buat order?',
  ].join('\n');
}

export function registerOrderCommands(bot: Telegraf<BotContext>): void {
  bot.command('order', async (ctx) => {
    ctx.session.order = { step: 'awaiting_domain' };
    await ctx.reply('Masukkan nama domain kamu. Contoh: example.com');
  });

  bot.command('cancel', async (ctx) => {
    const had = ctx.session.order && ctx.session.order.step !== 'idle';
    resetSession(ctx);
    await ctx.reply(
      had
        ? '✅ Proses order dibatalkan.'
        : 'Tidak ada proses order yang berjalan.',
    );
  });

  // Pilih tipe nameserver
  bot.action('ns_type:cloudflare', async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.session.order || ctx.session.order.step !== 'awaiting_ns_type') {
      await ctx.reply('Sesi order tidak aktif. Ketik /order untuk memulai.');
      return;
    }
    ctx.session.order.nsType = NsType.CLOUDFLARE;
    ctx.session.order.step = 'awaiting_nameservers';
    await ctx.reply(
      [
        'Kirim 2 nameserver Cloudflare kamu, contoh:',
        'adam.ns.cloudflare.com',
        'vera.ns.cloudflare.com',
      ].join('\n'),
    );
  });

  bot.action('ns_type:custom', async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.session.order || ctx.session.order.step !== 'awaiting_ns_type') {
      await ctx.reply('Sesi order tidak aktif. Ketik /order untuk memulai.');
      return;
    }
    ctx.session.order.nsType = NsType.CUSTOM;
    ctx.session.order.step = 'awaiting_nameservers';
    await ctx.reply(
      [
        'Kirim nameserver tujuan, contoh:',
        'ns1.hosting.com',
        'ns2.hosting.com',
      ].join('\n'),
    );
  });

  // Konfirmasi buat order
  bot.action('order_confirm', async (ctx) => {
    await ctx.answerCbQuery();
    const o = ctx.session.order;
    if (
      !o ||
      o.step !== 'awaiting_confirm' ||
      !o.domain ||
      !o.nsType ||
      !o.nameservers
    ) {
      await ctx.reply('Sesi order tidak lengkap. Ketik /order untuk memulai ulang.');
      return;
    }

    try {
      const order = await createOrder({
        telegramUserId: ctx.from!.id,
        username: ctx.from?.username,
        firstName: ctx.from?.first_name,
        lastName: ctx.from?.last_name,
        domain: o.domain,
        nsType: o.nsType,
        expectedNameservers: o.nameservers,
      });

      resetSession(ctx);

      await ctx.reply(
        [
          '✅ Order kamu berhasil dibuat!',
          '',
          `Order ID: #${order.id}`,
          `Kode: ${order.orderCode}`,
          `Domain: ${order.domain}`,
          '',
          'Admin akan segera memproses. Cek status dengan /status.',
        ].join('\n'),
      );

      // Notifikasi admin
      if (config.adminIds.length === 0) {
        console.error('ADMIN_IDS tidak dikonfigurasi; notifikasi admin dilewati.');
      } else {
        for (const adminId of config.adminIds) {
          try {
            await ctx.telegram.sendMessage(
              adminId.toString(),
              buildAdminOrderNotification(order),
              buildAdminOrderKeyboard(order.id),
            );
          } catch (err) {
            console.error('Gagal kirim notifikasi ke admin:', (err as Error).message);
          }
        }
      }
    } catch (err) {
      console.error('Gagal membuat order:', (err as Error).message);
      await ctx.reply('⚠️ Maaf, terjadi kesalahan saat menyimpan order. Coba lagi nanti.');
    }
  });

  bot.action('order_cancel', async (ctx) => {
    await ctx.answerCbQuery();
    resetSession(ctx);
    await ctx.reply('❌ Order dibatalkan.');
  });
}

/**
 * Tangani input teks sesuai langkah sesi order.
 * Mengembalikan true jika teks tersebut sudah ditangani oleh alur order.
 */
export async function handleOrderText(ctx: BotContext): Promise<boolean> {
  const o = ctx.session.order;
  if (!o || o.step === 'idle') return false;

  const message = ctx.message;
  if (!message || !('text' in message)) return false;
  const text = message.text;

  // Abaikan command lain di tengah alur (mis. /status), biar ditangani handler command.
  if (text.startsWith('/')) return false;

  if (o.step === 'awaiting_domain') {
    const validation = validateDomain(text);
    if (!validation.ok || !validation.domain) {
      await ctx.reply(
        '❌ Domain tidak valid. Masukkan domain yang benar, contoh: example.com',
      );
      return true;
    }
    o.domain = validation.domain;
    o.step = 'awaiting_ns_type';
    await ctx.reply(
      `Domain: ${o.domain}\n\nPilih tipe nameserver tujuan:`,
      nsTypeKeyboard(),
    );
    return true;
  }

  if (o.step === 'awaiting_nameservers') {
    const result = parseNameservers(text);
    if (!result.ok || !result.nameservers) {
      await ctx.reply(`❌ ${result.error ?? 'Nameserver tidak valid.'}\n\nKirim minimal 2 nameserver yang valid.`);
      return true;
    }
    o.nameservers = result.nameservers;
    o.step = 'awaiting_confirm';
    await ctx.reply(buildSummary(ctx), confirmKeyboard());
    return true;
  }

  if (o.step === 'awaiting_ns_type') {
    await ctx.reply('Silakan pilih tipe nameserver menggunakan tombol di atas.');
    return true;
  }

  if (o.step === 'awaiting_confirm') {
    await ctx.reply('Silakan konfirmasi order menggunakan tombol di atas.');
    return true;
  }

  return false;
}
