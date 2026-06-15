-- AlterEnum: tambah status APPROVED & COMPLETED.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';

-- AlterTable: tambah kolom waktu disetujui & selesai.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
