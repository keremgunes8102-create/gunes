import { sql } from './db.ts';
import { audit } from './audit.ts';
import { hashPassword, randomToken } from './security.ts';
import { notifyBusinessManagers } from './notify.ts';

/**
 * Hesabı kalıcı olarak anonimleştirir. Randevu kayıtları işletmelerin yasal/muhasebe ihtiyaçları için korunur
 * ancak kişiyle ilişkisi kaldırılır. Gelecekteki aktif randevular iptal edilir.
 */
export async function anonymizeUser(userId: string, actorId: string | null) {
  await sql.begin(async (tx) => {
    const future = await tx<{ id: string; business_id: string; public_reference: string }[]>`
      UPDATE appointments SET status = 'cancelled_by_customer', cancellation_reason = 'Hesap silindi'
      WHERE customer_user_id = ${userId} AND status IN ('pending', 'confirmed') AND start_at > now()
      RETURNING id, business_id, public_reference`;
    for (const a of future) {
      await tx`INSERT INTO appointment_events (appointment_id, event_type, to_status, note) VALUES (${a.id}, 'status_change', 'cancelled_by_customer', 'Hesap silindi')`;
      await notifyBusinessManagers(tx, a.business_id, { type: 'business_appointment_cancelled', title: 'Randevu iptal edildi', body: `${a.public_reference} numaralı randevu, müşteri hesabını sildiği için iptal edildi.`, dedupeKey: `cancelled:${a.id}` });
    }
    const placeholderHash = await hashPassword(randomToken(24));
    await tx`UPDATE users SET full_name = 'Silinmiş kullanıcı', email = ${`silindi-${userId}@koltuk.invalid`}, phone = NULL,
             password_hash = ${placeholderHash}, account_status = 'deleted', email_verified_at = NULL, phone_verified_at = NULL
             WHERE id = ${userId}`;
    await tx`DELETE FROM sessions WHERE user_id = ${userId}`;
    await tx`DELETE FROM favorites WHERE user_id = ${userId}`;
    await tx`DELETE FROM notifications WHERE user_id = ${userId}`;
    await tx`DELETE FROM verification_codes WHERE user_id = ${userId}`;
    await tx`DELETE FROM password_resets WHERE user_id = ${userId}`;
    await tx`UPDATE appointments SET customer_note = NULL WHERE customer_user_id = ${userId}`;
    await tx`UPDATE outbound_messages SET recipient = 'silindi', body = '[silindi]' WHERE user_id = ${userId}`;
    await tx`UPDATE data_requests SET status = 'completed', resolved_at = now(), resolution_note = COALESCE(resolution_note, 'Hesap anonimleştirildi')
             WHERE user_id = ${userId} AND request_type = 'deletion' AND status IN ('open', 'in_progress')`;
    await audit({ actor: actorId, action: 'user.anonymize', targetType: 'user', targetId: userId }, tx);
  });
}

/** KVKK erişim hakkı: kullanıcıya ait verilerin makinece okunabilir dökümü */
export async function exportUserData(userId: string) {
  const [user] = await sql`SELECT id, full_name, email, phone, account_status, email_verified_at, phone_verified_at, created_at FROM users WHERE id = ${userId}`;
  const appointments = await sql`
    SELECT a.public_reference, b.name AS business, a.start_at, a.end_at, a.status, a.price_snapshot, a.customer_note, a.created_at,
           (SELECT json_agg(s.name_snapshot ORDER BY s.position) FROM appointment_services s WHERE s.appointment_id = a.id) AS services
    FROM appointments a JOIN businesses b ON b.id = a.business_id WHERE a.customer_user_id = ${userId} ORDER BY a.start_at DESC`;
  const reviews = await sql`SELECT r.rating, r.comment, r.created_at, b.name AS business FROM reviews r JOIN businesses b ON b.id = r.business_id WHERE r.customer_user_id = ${userId}`;
  const favorites = await sql`SELECT b.name, b.slug, f.created_at FROM favorites f JOIN businesses b ON b.id = f.business_id WHERE f.user_id = ${userId}`;
  const consents = await sql`SELECT consent_type, granted, document_version, created_at FROM consents WHERE user_id = ${userId} ORDER BY created_at`;
  const preferences = await sql`SELECT email_service, sms_service, reminders, reminder_hours FROM notification_preferences WHERE user_id = ${userId}`;
  const businesses = await sql`SELECT b.name, m.role FROM business_members m JOIN businesses b ON b.id = m.business_id WHERE m.user_id = ${userId} AND m.invitation_status = 'accepted'`;
  return { generated_at: new Date().toISOString(), user, appointments, reviews, favorites, consents, notification_preferences: preferences[0] ?? null, business_memberships: businesses };
}
