import { config } from './config.ts';
import { createAppServer } from './app.ts';
import { closeDb, sql } from './db.ts';
import { startJobRunner } from './jobs.ts';

const server = createAppServer();

async function main() {
  await sql`SELECT 1`; // bağlantıyı doğrula
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'schema_migrations'`;
  if (!n) {
    console.error('Veritabanı şeması bulunamadı. Önce "npm run db:migrate" çalıştırın.');
    process.exit(1);
  }
  server.listen(config.port, config.host, () => {
    console.log(`KOLTUK çalışıyor: ${config.appUrl} (${config.isProduction ? 'üretim' : 'geliştirme'})`);
  });
  if (process.env.RUN_JOBS_IN_PROCESS !== '0') startJobRunner();
}

async function shutdown() {
  server.close();
  await closeDb();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((e) => {
  console.error('Başlatma hatası:', (e as Error).message);
  process.exit(1);
});
