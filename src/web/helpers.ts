import { NsType, OrderStatus } from '@prisma/client';

/**
 * Helper tampilan untuk web admin (Bahasa Indonesia).
 */

/** Label status order dalam Bahasa Indonesia. */
export function statusLabelId(status: OrderStatus | string): string {
  switch (status) {
    case OrderStatus.NEW:
      return 'Baru';
    case OrderStatus.WAITING_ADMIN:
      return 'Menunggu Admin';
    case OrderStatus.APPROVED:
      return 'Disetujui';
    case OrderStatus.ADMIN_CHANGED:
      return 'Sudah Diproses Admin';
    case OrderStatus.WAITING_PROPAGATION:
      return 'Menunggu Propagasi';
    case OrderStatus.CONNECTED:
      return 'Terhubung';
    case OrderStatus.COMPLETED:
      return 'Selesai';
    case OrderStatus.REJECTED:
      return 'Ditolak';
    case OrderStatus.FAILED_LOOKUP:
      return 'Gagal Lookup';
    default:
      return String(status);
  }
}

/** Kelas CSS badge sesuai status. */
export function statusBadgeClass(status: OrderStatus | string): string {
  switch (status) {
    case OrderStatus.CONNECTED:
    case OrderStatus.COMPLETED:
      return 'badge-green';
    case OrderStatus.WAITING_PROPAGATION:
    case OrderStatus.ADMIN_CHANGED:
      return 'badge-orange';
    case OrderStatus.WAITING_ADMIN:
    case OrderStatus.APPROVED:
      return 'badge-blue';
    case OrderStatus.REJECTED:
    case OrderStatus.FAILED_LOOKUP:
      return 'badge-red';
    default:
      return 'badge-gray';
  }
}

/** Label tipe nameserver. */
export function nsTypeLabelId(t: NsType | string): string {
  return t === NsType.CLOUDFLARE ? 'Cloudflare' : 'Custom / Non-Cloudflare';
}

/** Format tanggal lokal Indonesia, aman untuk nilai null. */
export function formatDate(d: Date | null | undefined): string {
  if (!d) return '-';
  try {
    return new Date(d).toLocaleString('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return '-';
  }
}

/** Pastikan nilai BigInt aman dikonversi ke string untuk tampilan. */
export function bigIntToString(v: bigint | number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return v.toString();
}

/** Ambil array string dari nilai JSON nameserver. */
export function nsArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]).filter((x) => typeof x === 'string') : [];
}

/** Label aksi audit log dalam Bahasa Indonesia. */
export function auditActionLabel(action: string): string {
  const map: Record<string, string> = {
    ORDER_CREATED: 'Order Dibuat',
    ADMIN_APPROVE: 'Order Disetujui',
    ADMIN_MARK_CHANGED: 'Admin Menandai Sudah Diubah',
    STATUS_CONNECTED: 'Status: Terhubung',
    STATUS_WAITING_PROPAGATION: 'Status: Menunggu Propagasi',
    LOOKUP_FAILED: 'Lookup Gagal',
    ADMIN_COMPLETE: 'Order Selesai',
    ADMIN_REJECT: 'Order Ditolak',
    ADMIN_REJECT_REASON: 'Order Ditolak (dengan alasan)',
    ADMIN_REOPEN: 'Order Dibuka Kembali',
    ADMIN_NOTE: 'Catatan Admin',
  };
  return map[action] ?? action;
}

/** Link kontak Telegram customer. */
export function telegramContactLink(username: string | null, telegramId: bigint | number): string {
  if (username) return `https://t.me/${username}`;
  return `tg://user?id=${telegramId.toString()}`;
}
