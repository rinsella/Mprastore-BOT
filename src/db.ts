import { PrismaClient } from '@prisma/client';

/**
 * Instance Prisma tunggal (singleton) untuk seluruh aplikasi.
 */
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export async function connectDb(): Promise<void> {
  await prisma.$connect();
}

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
