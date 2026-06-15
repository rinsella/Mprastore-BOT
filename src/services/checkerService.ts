import { Order, OrderStatus } from '@prisma/client';
import { Telegram } from 'telegraf';
import { config } from '../config';
import {
  addAuditLog,
  getCurrentNameservers,
  getExpectedNameservers,
  getOrderById,
  getOrdersForRecheck,
  updateOrder,
} from './orderService';
import {
  RdapError,
  icannLookupUrl,
  rdapLookup,
  trimRdapRaw,
} from './rdap';
import { nameserversMatch } from '../utils/nameserver';

/**
 * Label status dalam Bahasa Indonesia.
 */
export function statusLabel(status: OrderStatus): string {
  switch (status) {
    case OrderStatus.NEW:
      return 'Baru';
    case OrderStatus.WAITING_ADMIN:
      return 'Menunggu Admin';
    case OrderStatus.ADMIN_CHANGED:
      return 'Sudah Diproses Admin';
    case OrderStatus.WAITING_PROPAGATION:
      return 'Menunggu Propagasi';
    case OrderStatus.CONNECTED:
      return 'Terhubung ✅';
    case OrderStatus.REJECTED:
      return 'Ditolak ❌';
    case OrderStatus.FAILED_LOOKUP:
      return 'Gagal Lookup';
    default:
      return String(status);
  }
}

function bullet(list: string[]): string {
  if (list.length === 0) return '- (kosong)';
  return list.map((x) => `- ${x}`).join('\n');
}

async function safeSend(
  telegram: Telegram,
  chatId: number | bigint | string,
  text: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    await telegram.sendMessage(String(chatId), text, {
      // Hindari preview link agar pesan lebih ringkas.
      link_preview_options: { is_disabled: true },
      ...(extra as object),
    });
  } catch (err) {
    // Jangan crash hanya karena gagal kirim pesan (mis. user blokir bot).
    console.error('Gagal mengirim pesan Telegram:', (err as Error).message);
  }
}

export interface VerifyResult {
  order: Order;
  connected: boolean;
  failed: boolean;
  currentNameservers: string[];
  status: string[];
  errorMessage?: string;
}

/**
 * Lakukan verifikasi RDAP untuk satu order, perbarui status di DB,
 * dan kirim notifikasi ke customer / admin sesuai hasilnya.
 *
 * @param notifyCustomer kirim pesan ke customer hanya saat status berubah penting.
 * @param notifyAdmins   kirim ringkasan ke admin.
 */
export async function verifyOrder(
  telegram: Telegram,
  order: Order,
  opts: { notifyCustomer?: boolean; notifyAdmins?: boolean; source?: string; actorTelegramId?: number | bigint } = {},
): Promise<VerifyResult> {
  const expected = getExpectedNameservers(order);
  const source = opts.source ?? 'auto';

  try {
    const lookup = await rdapLookup(order.domain);
    const connected = nameserversMatch(expected, lookup.nameservers);

    const newStatus = connected
      ? OrderStatus.CONNECTED
      : OrderStatus.WAITING_PROPAGATION;

    const updated = await updateOrder(order.id, {
      status: newStatus,
      currentNameservers: lookup.nameservers,
      rdapRaw: trimRdapRaw(lookup),
      lastCheckedAt: new Date(),
      connectedAt: connected ? new Date() : undefined,
      // Bersihkan error sebelumnya saat lookup berhasil.
      lastError: null,
    });

    await addAuditLog({
      orderId: order.id,
      actorTelegramId: opts.actorTelegramId,
      action: connected ? 'STATUS_CONNECTED' : 'STATUS_WAITING_PROPAGATION',
      metadata: { current: lookup.nameservers, expected, source },
    });

    if (connected) {
      if (opts.notifyCustomer !== false) {
        await safeSend(
          telegram,
          order.telegramUserId,
          buildConnectedCustomerMessage(updated, lookup.nameservers, lookup.status),
        );
      }
      if (opts.notifyAdmins) {
        await notifyAdmins(
          telegram,
          `✅ Order #${updated.id} (${updated.domain}) sudah CONNECTED.`,
        );
      }
    } else {
      if (opts.notifyAdmins) {
        await notifyAdmins(
          telegram,
          buildNotConnectedMessage(updated, expected, lookup.nameservers),
        );
      }
    }

    return {
      order: updated,
      connected,
      failed: false,
      currentNameservers: lookup.nameservers,
      status: lookup.status,
    };
  } catch (err) {
    const message = rdapErrorMessage(err);

    // Order tetap dapat dikelola: simpan pesan error & set status FAILED_LOOKUP.
    // Customer TIDAK diberi tahu saat lookup gagal (anti-spam).
    const updated = await updateOrder(order.id, {
      status: OrderStatus.FAILED_LOOKUP,
      lastCheckedAt: new Date(),
      lastError: message,
    });

    await addAuditLog({
      orderId: order.id,
      actorTelegramId: opts.actorTelegramId,
      action: 'LOOKUP_FAILED',
      metadata: { error: message, source },
    });

    return {
      order: updated,
      connected: false,
      failed: true,
      currentNameservers: [],
      status: [],
      errorMessage: message,
    };
  }
}

/**
 * Pesan error RDAP yang ramah pengguna (Bahasa Indonesia).
 */
export function rdapErrorMessage(err: unknown): string {
  if (err instanceof RdapError) {
    switch (err.kind) {
      case 'SERVER_NOT_FOUND':
        return 'RDAP server untuk TLD domain ini tidak ditemukan. Mungkin TLD tidak didukung RDAP.';
      case 'TIMEOUT':
        return 'Permintaan ke RDAP timeout. Coba beberapa saat lagi.';
      case 'NOT_FOUND':
        return 'Domain tidak ditemukan di RDAP (mungkin belum terdaftar atau salah ketik).';
      case 'BOOTSTRAP':
        return 'Gagal mengambil daftar server RDAP dari IANA. Coba beberapa saat lagi.';
      default:
        return 'Maaf, bot gagal mengecek RDAP untuk domain ini. Coba beberapa saat lagi atau hubungi admin.';
    }
  }
  return 'Maaf, bot gagal mengecek RDAP untuk domain ini. Coba beberapa saat lagi atau hubungi admin.';
}

/**
 * Pesan ke customer saat domain sudah connect.
 */
export function buildConnectedCustomerMessage(
  order: Order,
  activeNs: string[],
  status: string[],
): string {
  return [
    '✅ Domain kamu sudah connect.',
    '',
    `Order ID: #${order.id}`,
    `Domain: ${order.domain}`,
    '',
    'Nameserver aktif:',
    bullet(activeNs),
    '',
    'Status RDAP:',
    bullet(status.length ? status : ['(tidak tersedia)']),
    '',
    'ICANN Lookup:',
    icannLookupUrl(order.domain),
  ].join('\n');
}

/**
 * Pesan saat nameserver belum match.
 */
export function buildNotConnectedMessage(
  order: Order,
  expected: string[],
  current: string[],
): string {
  return [
    '⏳ Nameserver belum match.',
    '',
    `Order ID: #${order.id}`,
    `Domain: ${order.domain}`,
    '',
    'Nameserver tujuan:',
    bullet(expected),
    '',
    'Nameserver saat ini:',
    bullet(current.length ? current : ['(tidak terbaca)']),
    '',
    'Kemungkinan masih propagasi atau nameserver belum diubah di registrar.',
  ].join('\n');
}

/**
 * Kirim pesan ke semua admin.
 */
export async function notifyAdmins(telegram: Telegram, text: string): Promise<void> {
  for (const adminId of config.adminIds) {
    await safeSend(telegram, adminId, text);
  }
}

let autoRecheckTimer: NodeJS.Timeout | null = null;
let isChecking = false;

/**
 * Jalankan auto-recheck berkala untuk order ADMIN_CHANGED & WAITING_PROPAGATION.
 */
export function startAutoRecheck(telegram: Telegram): void {
  const intervalMs = config.checkIntervalMinutes * 60 * 1000;

  const run = async () => {
    if (isChecking) return;
    isChecking = true;
    try {
      const orders = await getOrdersForRecheck();
      for (const order of orders) {
        const result = await verifyOrder(telegram, order, {
          notifyCustomer: true, // hanya terkirim jika berubah jadi CONNECTED
          notifyAdmins: false,
        });
        if (result.connected) {
          await notifyAdmins(
            telegram,
            `✅ [Auto] Order #${result.order.id} (${result.order.domain}) sekarang CONNECTED.`,
          );
        }
      }
    } catch (err) {
      console.error('Auto-recheck error:', (err as Error).message);
    } finally {
      isChecking = false;
    }
  };

  autoRecheckTimer = setInterval(run, intervalMs);
  console.log(
    `Auto-recheck aktif setiap ${config.checkIntervalMinutes} menit.`,
  );
}

export function stopAutoRecheck(): void {
  if (autoRecheckTimer) {
    clearInterval(autoRecheckTimer);
    autoRecheckTimer = null;
  }
}

/**
 * Jalankan pengecekan RDAP untuk sebuah order secara manual (mis. dari web admin).
 * Tidak men-spam customer: notifikasi hanya terkirim bila status menjadi CONNECTED.
 *
 * @param source label sumber aksi untuk audit log ('web', 'telegram', dll).
 */
export async function checkOrderNow(
  telegram: Telegram,
  orderId: number,
  source: string,
  actorTelegramId?: number | bigint,
): Promise<VerifyResult | null> {
  const order = await getOrderById(orderId);
  if (!order) return null;
  return verifyOrder(telegram, order, {
    notifyCustomer: true,
    notifyAdmins: false,
    source,
    actorTelegramId,
  });
}

export { getCurrentNameservers, getExpectedNameservers };
