import { config } from './config';
import { connectDb, disconnectDb } from './db';
import { createBot, setupBotCommands } from './bot';
import { startAutoRecheck, stopAutoRecheck } from './services/checkerService';
import { createWebServer } from './web/server';

async function main(): Promise<void> {
  // Koneksi database.
  await connectDb();
  console.log('Database terhubung.');

  const bot = createBot();

  // Web server: /health selalu aktif, web admin panel opsional (ADMIN_WEB_ENABLED).
  const app = createWebServer(bot.telegram);
  const server = app.listen(config.port, () => {
    console.log(`Web server berjalan di port ${config.port} (/health).`);
  });

  // Jalankan auto-recheck berkala.
  startAutoRecheck(bot.telegram);

  // Set menu command Telegram (best-effort).
  await setupBotCommands(bot);

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
