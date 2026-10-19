import postgres from 'postgres';
import { config } from './config.ts';

export const sql = postgres(config.databaseUrl, {
  max: Number(process.env.DB_POOL_MAX ?? 10),
  idle_timeout: 30,
  connect_timeout: 10,
  onnotice: () => {},
  // numeric -> string olarak gelir; para hesaplarında kayan nokta hatasından kaçınmak için öyle bırakıyoruz.
  transform: { undefined: null },
});

export type Sql = typeof sql;
export type Tx = postgres.TransactionSql<{}>;
/** Hem kök bağlantı hem de transaction içinde kullanılabilen sorgu fonksiyonu */
export type Db = postgres.ISql<{}>;

export async function closeDb() {
  await sql.end({ timeout: 5 });
}
