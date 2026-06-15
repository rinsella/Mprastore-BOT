-- AlterTable: tambah kolom pesan error terakhir pada Order.
ALTER TABLE "Order" ADD COLUMN "lastError" TEXT;

-- CreateTable: catatan internal admin untuk order (tidak ditampilkan ke customer).
CREATE TABLE "OrderNote" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "actorTelegramId" BIGINT,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderNote_orderId_idx" ON "OrderNote"("orderId");

-- AddForeignKey
ALTER TABLE "OrderNote" ADD CONSTRAINT "OrderNote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
