import { Telegraf, Markup } from 'telegraf';
import { Order, OrderStatus } from '@prisma/client';
import { BotContext } from '../types';
import { adminOnly, blockIfNotAdmin } from '../middlewares/adminOnly';
import {
  addAuditLog,
  getConnectedOrders,
  getExpectedNameservers,
  getCurrentNameservers,
  getOrderById,
  getPendingOrders,
  getRecentOrders,
  updateOrder,
} from '../services/orderService';
import {
  buildConnectedCustomerMessage,
  buildNotConnectedMessage,
  rdapErrorMessage,
  statusLabel,
  verifyOrder,
} from '../services/checkerService';
import { icannLookupUrl, rdapLookup } from '../services/rdap';
import { validateDomain } from '../utils/domain';

function nsTypeLabel(t: Order['nsType']): string {
  return t === 'CLOUDFLARE' ? 'Cloudflare' : 'Custom / Non-Cloudflare';
}

function bullet(list: string[]): string {
  if (!list.length) return '- (kosong)';
  return list.map((x) => `- ${x}`).join('\n');
}

/**
 * Keyboard inline untuk aksi admin pada sebuah order.
 */
export function buildAdminOrderKeyboard(orderId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🔍 Cek Nameserver', `admin_check:${orderId}`),
      Markup.button.callback('✅ Tandai Sudah Diubah', `admin_changed:${orderId}`),
    ],
    [
      Markup.button.callback('❌ Tolak Order', `admin_reject:${orderId}`),
      Markup.button.callback('💬 Hubungi Customer', `admin_contact:${orderId}`),
    ],
  ]);
}

/**
 * Pesan notifikasi order ke admin.
 */
export function buildAdminOrderNotification(order: Order): string {
  const expected = getExpectedNameservers(order);
  return [
    '🆕 Order Baru',
    '',
    `Order ID: #${order.id} (${order.orderCode})`,
    `Customer Telegram ID: ${order.telegramUserId.toString()}`,
    `Username: ${order.username ? '@' + order.username : '(tidak ada)'}`,
    `Domain: ${order.domain}`,
    `Tipe Nameserver: ${nsTypeLabel(order.nsType)}`,
    '',
    'Nameserver tujuan:',
    bullet(expected),
    '',
    `Status: ${statusLabel(order.status)}`,
  ].join('\n');
}

function formatOrderLine(order: Order): string {
  return [
    `#${order.id} • ${order.domain}`,
    `Status: ${statusLabel(order.status)}`,
    `Kode: ${order.orderCode}`,
    `Dibuat: ${order.createdAt.toLocaleString('id-ID')}`,
  ].join('\n');
}

function buildOrderDetail(order: Order): string {
  const expected = getExpectedNameservers(order);
  const current = getCurrentNameservers(order);
  return [
    `📄 Detail Order #${order.id}`,
    '',
    `Kode: ${order.orderCode}`,
    `Domain: ${order.domain}`,
    `Tipe NS: ${nsTypeLabel(order.nsType)}`,
    `Customer ID: ${order.telegramUserId.toString()}`,
    `Username: ${order.username ? '@' + order.username : '(tidak ada)'}`,
    `Status: ${statusLabel(order.status)}`,
    '',
    'NS tujuan:',
    bullet(expected),
    '',
    'NS saat ini:',
    bullet(current),
    '',
    `Terakhir dicek: ${order.lastCheckedAt ? order.lastCheckedAt.toLocaleString('id-ID') : '-'}`,
    `Connected: ${order.connectedAt ? order.connectedAt.toLocaleString('id-ID') : '-'}`,
    order.rejectReason ? `Alasan ditolak: ${order.rejectReason}` : '',
    '',
    `ICANN: ${icannLookupUrl(order.domain)}`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/**
 * Parse & validasi order ID dari callback/command.
 */
function parseOrderId(raw: string | undefined): number | null {
  if (!raw) return null;
  const id = parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export function registerAdminCommands(bot: Telegraf<BotContext>): void {
  // ===== Commands (admin only) =====
  bot.command('admin', adminOnly, async (ctx) => {
    await ctx.reply(
      [
        '🛠 Panel Admin',
        '',
        '/orders - 10 order terbaru',
        '/pending - Order yang perlu diproses',
        '/connected - Order yang sudah connect',
        '/detail <id> atau /order_<id> - Detail order',
        '/lookup <domain> - Cek RDAP manual',
      ].join('\n'),
    );
  });

  bot.command('orders', adminOnly, async (ctx) => {
    const orders = await getRecentOrders(10);
    if (!orders.length) {
      await ctx.reply('Belum ada order.');
      return;
    }
    const text = orders.map(formatOrderLine).join('\n\n');
    await ctx.reply('📋 10 Order Terbaru\n\n' + text);
  });

  bot.command('pending', adminOnly, async (ctx) => {
    const orders = await getPendingOrders();
    if (!orders.length) {
      await ctx.reply('Tidak ada order pending. 🎉');
      return;
    }
    const text = orders.map(formatOrderLine).join('\n\n');
    await ctx.reply('⏳ Order Pending\n\n' + text);
  });

  bot.command('connected', adminOnly, async (ctx) => {
    const orders = await getConnectedOrders(10);
    if (!orders.length) {
      await ctx.reply('Belum ada order yang connect.');
      return;
    }
    const text = orders.map(formatOrderLine).join('\n\n');
    await ctx.reply('✅ Order Connected\n\n' + text);
  });

  // /detail 123
  bot.command('detail', adminOnly, async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const id = parseOrderId(parts[1]);
    if (id === null) {
      await ctx.reply('Format salah. Contoh: /detail 123');
      return;
    }
    await replyOrderDetail(ctx, id);
  });

  // /lookup example.com
  bot.command('lookup', adminOnly, async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const validation = validateDomain(parts[1] ?? '');
    if (!validation.ok || !validation.domain) {
      await ctx.reply('Format salah. Contoh: /lookup example.com');
      return;
    }
    await ctx.reply('🔍 Mengecek RDAP...');
    try {
      const result = await rdapLookup(validation.domain);
      await ctx.reply(
        [
          `🔎 Hasil RDAP: ${result.domain}`,
          '',
          'Nameserver:',
          bullet(result.nameservers),
          '',
          'Status:',
          bullet(result.status.length ? result.status : ['(tidak tersedia)']),
          '',
          `ICANN: ${icannLookupUrl(result.domain)}`,
        ].join('\n'),
      );
    } catch (err) {
      await ctx.reply('⚠️ ' + rdapErrorMessage(err));
    }
  });

  // /order_123 (dynamic command via regex on text)
  bot.hears(/^\/order_(\d+)$/, async (ctx) => {
    if (await blockIfNotAdmin(ctx)) return;
    const id = parseOrderId(ctx.match[1]);
    if (id === null) {
      await ctx.reply('Order ID tidak valid.');
      return;
    }
    await replyOrderDetail(ctx, id);
  });

  // ===== Callback actions (admin only) =====
  bot.action(/^admin_check:(\d+)$/, async (ctx) => {
    if (await blockIfNotAdmin(ctx)) return;
    const id = parseOrderId(ctx.match[1]);
    if (id === null) {
      await ctx.answerCbQuery('Order ID tidak valid.', { show_alert: true });
      return;
    }
    await ctx.answerCbQuery('Mengecek nameserver...');
    const order = await getOrderById(id);
    if (!order) {
      await ctx.reply('Order tidak ditemukan.');
      return;
    }

    const result = await verifyOrder(ctx.telegram, order, {
      notifyCustomer: true,
      notifyAdmins: false,
    });

    if (result.failed) {
      await ctx.reply('⚠️ ' + (result.errorMessage ?? 'Gagal lookup RDAP.'));
      return;
    }

    if (result.connected) {
      await ctx.reply(
        buildConnectedCustomerMessage(
          result.order,
          result.currentNameservers,
          result.status,
        ),
      );
    } else {
      await ctx.reply(
        buildNotConnectedMessage(
          result.order,
          getExpectedNameservers(result.order),
          result.currentNameservers,
        ),
      );
    }
  });

  bot.action(/^admin_changed:(\d+)$/, async (ctx) => {
    if (await blockIfNotAdmin(ctx)) return;
    const id = parseOrderId(ctx.match[1]);
    if (id === null) {
      await ctx.answerCbQuery('Order ID tidak valid.', { show_alert: true });
      return;
    }
    const order = await getOrderById(id);
    if (!order) {
      await ctx.answerCbQuery('Order tidak ditemukan.', { show_alert: true });
      return;
    }

    await updateOrder(id, { status: OrderStatus.ADMIN_CHANGED });
    await addAuditLog({
      orderId: id,
      actorTelegramId: ctx.from?.id,
      action: 'ADMIN_MARK_CHANGED',
    });
    await ctx.answerCbQuery('Ditandai sudah diubah.');

    try {
      await ctx.telegram.sendMessage(
        order.telegramUserId.toString(),
        'Admin sudah memproses perubahan nameserver. Bot akan mengecek status koneksi domain kamu.',
      );
    } catch {
      /* abaikan */
    }
    await ctx.reply(`✅ Order #${id} ditandai ADMIN_CHANGED. Customer diberi tahu.`);
  });

  bot.action(/^admin_reject:(\d+)$/, async (ctx) => {
    if (await blockIfNotAdmin(ctx)) return;
    const id = parseOrderId(ctx.match[1]);
    if (id === null) {
      await ctx.answerCbQuery('Order ID tidak valid.', { show_alert: true });
      return;
    }
    const order = await getOrderById(id);
    if (!order) {
      await ctx.answerCbQuery('Order tidak ditemukan.', { show_alert: true });
      return;
    }

    await updateOrder(id, {
      status: OrderStatus.REJECTED,
      rejectedAt: new Date(),
    });
    await addAuditLog({
      orderId: id,
      actorTelegramId: ctx.from?.id,
      action: 'ADMIN_REJECT',
    });
    await ctx.answerCbQuery('Order ditolak.');

    try {
      await ctx.telegram.sendMessage(
        order.telegramUserId.toString(),
        `❌ Maaf, order #${order.id} (${order.domain}) ditolak oleh admin. Silakan hubungi admin untuk info lebih lanjut.`,
      );
    } catch {
      /* abaikan */
    }
    await ctx.reply(
      `❌ Order #${id} ditolak. Untuk menambahkan alasan, kirim: /reject ${id} <alasan>`,
    );
  });

  // /reject <id> <alasan>
  bot.command('reject', adminOnly, async (ctx) => {
    const text = ctx.message.text.trim();
    const match = text.match(/^\/reject\s+(\d+)\s+(.+)$/);
    if (!match) {
      await ctx.reply('Format: /reject <id> <alasan>');
      return;
    }
    const id = parseOrderId(match[1]);
    const reason = match[2].trim();
    if (id === null) {
      await ctx.reply('Order ID tidak valid.');
      return;
    }
    const order = await getOrderById(id);
    if (!order) {
      await ctx.reply('Order tidak ditemukan.');
      return;
    }
    await updateOrder(id, {
      status: OrderStatus.REJECTED,
      rejectedAt: new Date(),
      rejectReason: reason,
    });
    await addAuditLog({
      orderId: id,
      actorTelegramId: ctx.from?.id,
      action: 'ADMIN_REJECT_REASON',
      metadata: { reason },
    });
    try {
      await ctx.telegram.sendMessage(
        order.telegramUserId.toString(),
        `❌ Order #${order.id} (${order.domain}) ditolak.\nAlasan: ${reason}`,
      );
    } catch {
      /* abaikan */
    }
    await ctx.reply(`❌ Order #${id} ditolak dengan alasan tercatat.`);
  });

  bot.action(/^admin_contact:(\d+)$/, async (ctx) => {
    if (await blockIfNotAdmin(ctx)) return;
    const id = parseOrderId(ctx.match[1]);
    if (id === null) {
      await ctx.answerCbQuery('Order ID tidak valid.', { show_alert: true });
      return;
    }
    const order = await getOrderById(id);
    if (!order) {
      await ctx.answerCbQuery('Order tidak ditemukan.', { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    const link = order.username
      ? `https://t.me/${order.username}`
      : `tg://user?id=${order.telegramUserId.toString()}`;
    await ctx.reply(
      [
        `💬 Hubungi customer order #${order.id}:`,
        order.username ? `Username: @${order.username}` : `User ID: ${order.telegramUserId.toString()}`,
        `Link: ${link}`,
      ].join('\n'),
    );
  });

  async function replyOrderDetail(ctx: BotContext, id: number): Promise<void> {
    const order = await getOrderById(id);
    if (!order) {
      await ctx.reply('Order tidak ditemukan.');
      return;
    }
    await ctx.reply(buildOrderDetail(order), buildAdminOrderKeyboard(order.id));
  }
}
