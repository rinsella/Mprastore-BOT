import { Telegraf } from 'telegraf';
import { Order } from '@prisma/client';
import { BotContext } from '../types';
import { getOrdersByTelegramUser } from '../services/orderService';
import { statusLabel } from '../services/checkerService';

function formatCustomerOrder(order: Order): string {
  return [
    `#${order.id} • ${order.domain}`,
    `Status: ${statusLabel(order.status)}`,
    `Dibuat: ${order.createdAt.toLocaleString('id-ID')}`,
    `Terakhir dicek: ${order.lastCheckedAt ? order.lastCheckedAt.toLocaleString('id-ID') : '-'}`,
  ].join('\n');
}

/**
 * Daftarkan command /status untuk customer.
 */
export function registerStatusCommands(bot: Telegraf<BotContext>): void {
  bot.command('status', async (ctx) => {
    const orders = await getOrdersByTelegramUser(ctx.from.id, 5);
    if (!orders.length) {
      await ctx.reply('Kamu belum punya pesanan. Buat dengan /order.');
      return;
    }
    const text = orders.map(formatCustomerOrder).join('\n\n');
    await ctx.reply('📦 5 Pesanan Terakhir Kamu\n\n' + text);
  });
}
