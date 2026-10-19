// Üretimde ilk platform yöneticisini oluşturur veya mevcut kullanıcıyı yönetici yapar.
// Kullanım: npm run create-admin -- eposta@ornek.com "Ad Soyad"
// Şifre ortam değişkeninden okunur (komut geçmişinde görünmemesi için): ADMIN_PASSWORD=... npm run create-admin -- ...
import { sql, closeDb } from '../server/db.ts';
import { hashPassword } from '../server/security.ts';
import { audit } from '../server/audit.ts';

async function main() {
  const [email, name] = process.argv.slice(2);
  if (!email) throw new Error('Kullanım: npm run create-admin -- eposta@ornek.com "Ad Soyad"');
  const [existing] = await sql<{ id: string }[]>`SELECT id FROM users WHERE lower(email) = lower(${email})`;
  if (existing) {
    await sql`UPDATE users SET platform_role = 'admin' WHERE id = ${existing.id}`;
    await audit({ action: 'cli.admin_grant', targetType: 'user', targetId: existing.id });
    console.log('Mevcut kullanıcı yönetici yapıldı.');
    return;
  }
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 12) throw new Error('Yeni yönetici için ADMIN_PASSWORD (en az 12 karakter) ortam değişkenini verin.');
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (full_name, email, password_hash, platform_role, email_verified_at)
    VALUES (${name ?? 'Platform Yöneticisi'}, ${email.toLowerCase()}, ${await hashPassword(password)}, 'admin', now()) RETURNING id`;
  await sql`INSERT INTO notification_preferences (user_id) VALUES (${u.id})`;
  await audit({ action: 'cli.admin_create', targetType: 'user', targetId: u.id });
  console.log('Yönetici oluşturuldu.');
}

main()
  .then(closeDb)
  .catch(async (e) => {
    console.error((e as Error).message);
    await closeDb();
    process.exit(1);
  });
