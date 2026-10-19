// Görsel yükleme: istemci dosyayı ham gövde olarak gönderir (Content-Type: image/jpeg|png|webp).
// Uzantı değil dosyanın gerçek imzası (magic bytes) kontrol edilir; boyut sınırı 5 MB.
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { sql } from '../db.ts';
import { HttpError, badRequest, notFound, readBody, type Router } from '../http.ts';
import { requireMember, requireUser } from '../auth.ts';
import { rateLimit } from '../security.ts';
import { audit } from '../audit.ts';
import { optionalText, uuid, z } from '../validation.ts';

const MAX = 5 * 1024 * 1024;

export function sniffImage(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

export function registerUploadRoutes(r: Router) {
  /** purpose: logo | cover | gallery | employee | service */
  r.post('/api/panel/:bid/uploads', async (ctx) => {
    const user = requireUser(ctx);
    const m = await requireMember(ctx, uuid.parse(ctx.params.bid), ['owner', 'manager']);
    rateLimit(`upload:${user.id}`, 60, 3_600_000);
    const purpose = z.enum(['logo', 'cover', 'gallery', 'employee', 'service']).parse(ctx.query.get('purpose'));
    const declared = String(ctx.req.headers['content-type'] ?? '');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(declared)) throw new HttpError(415, 'unsupported_media_type', 'Yalnızca JPG, PNG veya WEBP görseller yüklenebilir.');
    const len = Number(ctx.req.headers['content-length'] ?? 0);
    if (len > MAX) throw new HttpError(413, 'payload_too_large', 'Dosya en fazla 5 MB olabilir.');
    const buf = await readBody(ctx.req, MAX);
    const kind = sniffImage(buf);
    if (!kind || kind.mime !== declared) throw badRequest('Dosya geçerli bir görsel değil.');
    mkdirSync(config.uploadDir, { recursive: true });
    const fileName = `${randomUUID()}.${kind.ext}`;
    writeFileSync(join(config.uploadDir, fileName), buf, { mode: 0o644 });
    await sql`INSERT INTO uploads (owner_user_id, business_id, file_name, mime_type, size_bytes) VALUES (${user.id}, ${m.business_id}, ${fileName}, ${kind.mime}, ${buf.length})`;
    const url = `/uploads/${fileName}`;
    if (purpose === 'logo') await sql`UPDATE businesses SET logo_url = ${url} WHERE id = ${m.business_id}`;
    if (purpose === 'cover') await sql`UPDATE businesses SET cover_url = ${url} WHERE id = ${m.business_id}`;
    if (purpose === 'gallery') {
      const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM business_photos WHERE business_id = ${m.business_id}`;
      if (n >= 24) throw badRequest('Galeriye en fazla 24 fotoğraf eklenebilir.');
      await sql`INSERT INTO business_photos (business_id, url, sort_order) VALUES (${m.business_id}, ${url}, ${n})`;
    }
    await audit({ actor: user.id, businessId: m.business_id, action: `upload.${purpose}`, targetType: 'upload', targetId: fileName, ip: ctx.ip });
    ctx.status = 201;
    return { url };
  });

  r.get('/api/panel/:bid/photos', async (ctx) => {
    const m = await requireMember(ctx, uuid.parse(ctx.params.bid));
    return sql`SELECT id, url, caption, sort_order FROM business_photos WHERE business_id = ${m.business_id} ORDER BY sort_order, created_at`;
  });

  r.patch('/api/panel/:bid/photos/:id', async (ctx) => {
    const m = await requireMember(ctx, uuid.parse(ctx.params.bid), ['owner', 'manager']);
    const { caption } = await ctx.json(z.object({ caption: optionalText(120) }));
    const res = await sql`UPDATE business_photos SET caption = ${caption} WHERE id = ${uuid.parse(ctx.params.id)} AND business_id = ${m.business_id}`;
    if (!res.count) throw notFound();
    return { ok: true };
  });

  r.delete('/api/panel/:bid/photos/:id', async (ctx) => {
    const m = await requireMember(ctx, uuid.parse(ctx.params.bid), ['owner', 'manager']);
    const [p] = await sql<{ url: string }[]>`DELETE FROM business_photos WHERE id = ${uuid.parse(ctx.params.id)} AND business_id = ${m.business_id} RETURNING url`;
    if (!p) throw notFound();
    removeFile(p.url);
    return { ok: true };
  });

  r.delete('/api/panel/:bid/branding/:kind', async (ctx) => {
    const m = await requireMember(ctx, uuid.parse(ctx.params.bid), ['owner', 'manager']);
    const kind = z.enum(['logo', 'cover']).parse(ctx.params.kind);
    if (kind === 'logo') await sql`UPDATE businesses SET logo_url = NULL WHERE id = ${m.business_id}`;
    else await sql`UPDATE businesses SET cover_url = NULL WHERE id = ${m.business_id}`;
    return { ok: true };
  });
}

function removeFile(url: string) {
  const name = url.replace(/^\/uploads\//, '');
  if (!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(name)) return;
  try {
    unlinkSync(join(config.uploadDir, name));
  } catch {
    /* dosya zaten yoksa sorun değil */
  }
  sql`DELETE FROM uploads WHERE file_name = ${name}`.catch(() => {});
}
