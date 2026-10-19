// Veritabanı migration çalıştırıcısı.
// Kullanım: npm run db:migrate          -> bekleyen migration dosyalarını uygular
//           npm run db:migrate -- --reset -> TÜM tabloları siler ve baştan kurar (yalnızca geliştirme)
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../server/config.ts';
import { sql, closeDb } from '../server/db.ts';

export async function migrate({ reset = false, quiet = false } = {}) {
  const log = (m: string) => !quiet && console.log(m);
  if (reset) {
    if (config.isProduction) throw new Error('Üretim ortamında --reset kullanılamaz.');
    await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    log('Şema sıfırlandı.');
  }
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const dir = resolve(import.meta.dirname, '../migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set((await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = readFileSync(resolve(dir, file), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    log(`Uygulandı: ${file}`);
  }
  log('Migration tamam.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate({ reset: process.argv.includes('--reset') })
    .then(closeDb)
    .catch(async (e) => {
      console.error(e);
      await closeDb();
      process.exit(1);
    });
}
