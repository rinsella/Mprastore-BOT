import express from 'express';
import { config } from './config';
import { connectDb, disconnectDb } from './db';
import { createBot } from './bot';
import { startAutoRecheck, stopAutoRecheck } from './services/checkerService';

async function main(): Promise<void> {
  // Koneksi database.
  await connectDb();
  console.log('Database terhubung.');

  const bot = createBot();

  // Express health check server (opsional).
  const app = express();
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });
  const server = app.listen(config.port, () => {
    console.log(`Health check berjalan di port ${config.port} (/health).`);
  });

  // Jalankan auto-recheck berkala.
  startAutoRecheck(bot.telegram);

  // Jalankan bot (long polling).
  await bot.launch();
  console.log('Bot Telegram berjalan. 🚀');

  // Graceful shutdown.
  const shutdown = async (signal: string) => {
    console.log(`Menerima ${signal}, mematikan...`);
    stopAutoRecheck();
    bot.stop(signal);
    server.close();
    await disconnectDb();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Gagal memulai aplikasi:', (err as Error).message);
  process.exit(1);
});
