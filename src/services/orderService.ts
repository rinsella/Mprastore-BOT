import { NsType, OrderStatus, Order, Prisma } from '@prisma/client';
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
