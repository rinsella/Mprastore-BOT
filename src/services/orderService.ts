import { NsType, OrderStatus, Order, OrderNote, AuditLog, Prisma } from '@prisma/client';
import { prisma } from '../db';

/**
 * Buat order code unik dengan format ORD-YYYY-000001.
 */
export async function generateOrderCode(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.order.count();
  const seq = (count + 1).toString().padStart(6, '0');
  return `ORD-${year}-${seq}`;
}

export interface UpsertUserInput {
  telegramId: number | bigint;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

/**
 * Buat atau perbarui data user berdasarkan telegramId.
 */
export async function upsertUser(input: UpsertUserInput) {
  const telegramId = BigInt(input.telegramId);
  return prisma.user.upsert({
    where: { telegramId },
    create: {
      telegramId,
      username: input.username ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
    },
    update: {
      username: input.username ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
    },
  });
}

export interface CreateOrderInput {
  telegramUserId: number | bigint;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  domain: string;
  nsType: NsType;
  expectedNameservers: string[];
}

/**
 * Buat order baru dan catat audit log.
 */
export async function createOrder(input: CreateOrderInput): Promise<Order> {
  const user = await upsertUser({
    telegramId: input.telegramUserId,
    username: input.username,
    firstName: input.firstName,
    lastName: input.lastName,
  });

  const orderCode = await generateOrderCode();

  const order = await prisma.order.create({
    data: {
      orderCode,
      userId: user.id,
      telegramUserId: BigInt(input.telegramUserId),
      username: input.username ?? null,
      domain: input.domain,
      nsType: input.nsType,
      expectedNameservers: input.expectedNameservers as unknown as Prisma.InputJsonValue,
      status: OrderStatus.WAITING_ADMIN,
    },
  });

  await addAuditLog({
    orderId: order.id,
    actorTelegramId: input.telegramUserId,
    action: 'ORDER_CREATED',
    metadata: { domain: input.domain, nsType: input.nsType },
  });

  return order;
}

export async function getOrderById(id: number): Promise<Order | null> {
  return prisma.order.findUnique({ where: { id } });
}

/**
 * Ambil order terbaru milik seorang user.
 */
export async function getOrdersByTelegramUser(
  telegramUserId: number | bigint,
  limit = 5,
): Promise<Order[]> {
  return prisma.order.findMany({
    where: { telegramUserId: BigInt(telegramUserId) },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getRecentOrders(limit = 10): Promise<Order[]> {
  return prisma.order.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getPendingOrders(): Promise<Order[]> {
  return prisma.order.findMany({
    where: {
      status: {
        in: [
          OrderStatus.WAITING_ADMIN,
          OrderStatus.ADMIN_CHANGED,
          OrderStatus.WAITING_PROPAGATION,
        ],
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getConnectedOrders(limit = 10): Promise<Order[]> {
  return prisma.order.findMany({
    where: { status: OrderStatus.CONNECTED },
    orderBy: { connectedAt: 'desc' },
    take: limit,
  });
}

/**
 * Ambil order yang perlu di-recheck otomatis.
 */
export async function getOrdersForRecheck(): Promise<Order[]> {
  return prisma.order.findMany({
    where: {
      status: {
        in: [OrderStatus.ADMIN_CHANGED, OrderStatus.WAITING_PROPAGATION],
      },
    },
    orderBy: { lastCheckedAt: 'asc' },
  });
}

export interface UpdateOrderStatusInput {
  status: OrderStatus;
  currentNameservers?: string[];
  rdapRaw?: Record<string, unknown>;
  rejectReason?: string;
  connectedAt?: Date;
  rejectedAt?: Date;
  lastCheckedAt?: Date;
  lastError?: string | null;
}

export async function updateOrder(
  id: number,
  input: UpdateOrderStatusInput,
): Promise<Order> {
  const data: Prisma.OrderUpdateInput = {
    status: input.status,
  };

  if (input.currentNameservers !== undefined) {
    data.currentNameservers = input.currentNameservers as unknown as Prisma.InputJsonValue;
  }
  if (input.rdapRaw !== undefined) {
    data.rdapRaw = input.rdapRaw as unknown as Prisma.InputJsonValue;
  }
  if (input.rejectReason !== undefined) data.rejectReason = input.rejectReason;
  if (input.connectedAt !== undefined) data.connectedAt = input.connectedAt;
  if (input.rejectedAt !== undefined) data.rejectedAt = input.rejectedAt;
  if (input.lastCheckedAt !== undefined) data.lastCheckedAt = input.lastCheckedAt;
  if (input.lastError !== undefined) data.lastError = input.lastError;

  return prisma.order.update({ where: { id }, data });
}

export interface AddAuditLogInput {
  orderId?: number | null;
  actorTelegramId?: number | bigint | null;
  action: string;
  metadata?: Record<string, unknown> | null;
}

export async function addAuditLog(input: AddAuditLogInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        orderId: input.orderId ?? null,
        actorTelegramId:
          input.actorTelegramId !== undefined && input.actorTelegramId !== null
            ? BigInt(input.actorTelegramId)
            : null,
        action: input.action,
        metadata: (input.metadata ?? undefined) as unknown as Prisma.InputJsonValue,
      },
    });
  } catch {
    // Audit log tidak boleh menggagalkan alur utama.
  }
}

/**
 * Helper untuk membaca expectedNameservers sebagai array string.
 */
export function getExpectedNameservers(order: Order): string[] {
  const ns = order.expectedNameservers;
  return Array.isArray(ns) ? (ns as string[]) : [];
}

export function getCurrentNameservers(order: Order): string[] {
  const ns = order.currentNameservers;
  return Array.isArray(ns) ? (ns as string[]) : [];
}

// =====================================================================
// Fungsi tambahan untuk Web Admin Panel
// =====================================================================

export interface DashboardStats {
  total: number;
  waitingAdmin: number;
  approved: number;
  adminChanged: number;
  waitingPropagation: number;
  connected: number;
  completed: number;
  rejected: number;
  failedLookup: number;
}

/**
 * Statistik ringkas untuk dashboard admin.
 */
export async function getDashboardStats(): Promise<DashboardStats> {
  const [
    total,
    waitingAdmin,
    approved,
    adminChanged,
    waitingPropagation,
    connected,
    completed,
    rejected,
    failedLookup,
  ] = await Promise.all([
    prisma.order.count(),
    prisma.order.count({ where: { status: OrderStatus.WAITING_ADMIN } }),
    prisma.order.count({ where: { status: OrderStatus.APPROVED } }),
    prisma.order.count({ where: { status: OrderStatus.ADMIN_CHANGED } }),
    prisma.order.count({ where: { status: OrderStatus.WAITING_PROPAGATION } }),
    prisma.order.count({ where: { status: OrderStatus.CONNECTED } }),
    prisma.order.count({ where: { status: OrderStatus.COMPLETED } }),
    prisma.order.count({ where: { status: OrderStatus.REJECTED } }),
    prisma.order.count({ where: { status: OrderStatus.FAILED_LOOKUP } }),
  ]);

  return {
    total,
    waitingAdmin,
    approved,
    adminChanged,
    waitingPropagation,
    connected,
    completed,
    rejected,
    failedLookup,
  };
}

export interface OrderFilters {
  domain?: string;
  username?: string;
  status?: OrderStatus;
  nsType?: NsType;
  page?: number;
  pageSize?: number;
}

export interface PaginatedOrders {
  orders: Order[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Ambil order dengan filter pencarian, status, tipe NS, dan pagination.
 * Selalu diurutkan dari yang terbaru.
 */
export async function getOrdersWithFilters(
  filters: OrderFilters,
): Promise<PaginatedOrders> {
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 100) : 20;

  const where: Prisma.OrderWhereInput = {};

  if (filters.domain && filters.domain.trim()) {
    where.domain = { contains: filters.domain.trim().toLowerCase(), mode: 'insensitive' };
  }
  if (filters.username && filters.username.trim()) {
    where.username = { contains: filters.username.trim().replace(/^@/, ''), mode: 'insensitive' };
  }
  if (filters.status) {
    where.status = filters.status;
  }
  if (filters.nsType) {
    where.nsType = filters.nsType;
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.order.count({ where }),
  ]);

  return {
    orders,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export type OrderWithRelations = Order & {
  user: { telegramId: bigint; username: string | null; firstName: string | null; lastName: string | null } | null;
};

/**
 * Detail lengkap satu order beserta relasi user.
 */
export async function getOrderDetail(id: number): Promise<OrderWithRelations | null> {
  return prisma.order.findUnique({
    where: { id },
    include: {
      user: {
        select: { telegramId: true, username: true, firstName: true, lastName: true },
      },
    },
  });
}

/**
 * Audit log untuk sebuah order (terbaru di atas).
 */
export async function getAuditLogsByOrder(orderId: number): Promise<AuditLog[]> {
  return prisma.auditLog.findMany({
    where: { orderId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

/**
 * Catatan internal admin untuk sebuah order (terbaru di atas).
 */
export async function getOrderNotesByOrder(orderId: number): Promise<OrderNote[]> {
  return prisma.orderNote.findMany({
    where: { orderId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

/**
 * Tambah catatan internal admin. Tidak ditampilkan ke customer.
 */
export async function addOrderNote(
  orderId: number,
  note: string,
  actorTelegramId?: number | bigint | null,
): Promise<OrderNote> {
  const created = await prisma.orderNote.create({
    data: {
      orderId,
      note: note.trim(),
      actorTelegramId:
        actorTelegramId !== undefined && actorTelegramId !== null
          ? BigInt(actorTelegramId)
          : null,
    },
  });
  await addAuditLog({
    orderId,
    actorTelegramId: actorTelegramId ?? null,
    action: 'ADMIN_NOTE',
    metadata: { note: note.trim().slice(0, 200) },
  });
  return created;
}

/**
 * Buka kembali order yang gagal/ditolak menjadi WAITING_ADMIN.
 */
export async function reopenOrder(
  orderId: number,
  actorTelegramId?: number | bigint | null,
): Promise<Order> {
  const updated = await prisma.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.WAITING_ADMIN,
      rejectedAt: null,
      approvedAt: null,
      completedAt: null,
      lastError: null,
    },
  });
  await addAuditLog({
    orderId,
    actorTelegramId: actorTelegramId ?? null,
    action: 'ADMIN_REOPEN',
  });
  return updated;
}

/**
 * Tandai order sebagai ADMIN_CHANGED (admin sudah memproses perubahan NS).
 */
export async function markOrderChanged(
  orderId: number,
  actorTelegramId?: number | bigint | null,
): Promise<Order> {
  const updated = await prisma.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.ADMIN_CHANGED, lastError: null },
  });
  await addAuditLog({
    orderId,
    actorTelegramId: actorTelegramId ?? null,
    action: 'ADMIN_MARK_CHANGED',
  });
  return updated;
}

/**
 * Setujui order (APPROVED). Admin menerima order & akan memprosesnya.
 */
export async function approveOrder(
  orderId: number,
  actorTelegramId?: number | bigint | null,
): Promise<Order> {
  const updated = await prisma.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.APPROVED, approvedAt: new Date(), lastError: null },
  });
  await addAuditLog({
    orderId,
    actorTelegramId: actorTelegramId ?? null,
    action: 'ADMIN_APPROVE',
  });
  return updated;
}

/**
 * Tandai order selesai (COMPLETED). Status final yang ditutup admin.
 */
export async function completeOrder(
  orderId: number,
  actorTelegramId?: number | bigint | null,
): Promise<Order> {
  const updated = await prisma.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.COMPLETED, completedAt: new Date() },
  });
  await addAuditLog({
    orderId,
    actorTelegramId: actorTelegramId ?? null,
    action: 'ADMIN_COMPLETE',
  });
  return updated;
}

/**
 * Tolak order dengan alasan opsional.
 */
export async function rejectOrder(
  orderId: number,
  reason?: string | null,
  actorTelegramId?: number | bigint | null,
): Promise<Order> {
  const trimmed = reason && reason.trim() ? reason.trim() : null;
  const updated = await prisma.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.REJECTED,
      rejectedAt: new Date(),
      rejectReason: trimmed,
    },
  });
  await addAuditLog({
    orderId,
    actorTelegramId: actorTelegramId ?? null,
    action: trimmed ? 'ADMIN_REJECT_REASON' : 'ADMIN_REJECT',
    metadata: trimmed ? { reason: trimmed } : undefined,
  });
  return updated;
}
