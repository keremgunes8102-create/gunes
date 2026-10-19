import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { config } from './config.ts';
import { sql } from './db.ts';
import { HttpError, Router, clientIp, parseCookies, readBody, sendJson, serializeCookie, validationError, type Ctx } from './http.ts';
import { loadSession } from './auth.ts';
import { ZodError } from 'zod';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerPublicRoutes } from './routes/public.ts';
import { registerMeRoutes } from './routes/me.ts';
import { registerPanelRoutes } from './routes/panel.ts';
import { registerAdminRoutes } from './routes/admin.ts';
import { registerUploadRoutes } from './routes/uploads.ts';
import './validation.ts';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC_DIR = join(ROOT, 'public');

export const router = new Router();
registerAuthRoutes(router);
registerPublicRoutes(router);
registerMeRoutes(router);
registerPanelRoutes(router);
registerAdminRoutes(router);
registerUploadRoutes(router);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  'frame-src https://www.openstreetmap.org',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

function securityHeaders(res: ServerResponse) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (config.isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

let indexTemplate: string | null = null;
function indexHtml() {
  if (!indexTemplate || !config.isProduction) indexTemplate = readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf8');
  return indexTemplate;
}

/** SPA kabuğu; işletme sayfalarında paylaşım önizlemesi için başlık/açıklama sunucuda doldurulur */
async function serveApp(res: ServerResponse, path: string) {
  let title = 'KOLTUK — Tarzına uygun yer, sana uygun saat.';
  let description = 'Çevrendeki berber, kuaför ve güzellik salonlarını keşfet; hizmetleri karşılaştır, sana uygun saati seç ve randevunu kolayca oluştur.';
  const m = path.match(/^\/isletme\/([a-z0-9-]+)\/?$/);
  if (m) {
    const [b] = await sql<{ name: string; description: string | null; district: string | null; city: string | null }[]>`
      SELECT name, description, district, city FROM businesses WHERE slug = ${m[1]} AND verification_status = 'approved' AND publication_status = 'published'`;
    if (b) {
      title = `${b.name} — KOLTUK'ta randevu al`;
      description = (b.description ?? `${[b.district, b.city].filter(Boolean).join(', ')} — online randevu`).slice(0, 160);
    }
  }
  const html = indexHtml()
    .replace('<title>KOLTUK</title>', `<title>${escapeHtml(title)}</title>`)
    .replace('__META_DESCRIPTION__', escapeHtml(description))
    .replace('__OG_TITLE__', escapeHtml(title));
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(html);
}

function serveStatic(res: ServerResponse, baseDir: string, relPath: string, cache: string): boolean {
  const file = resolve(baseDir, '.' + relPath);
  if (!file.startsWith(baseDir + sep)) return false;
  if (!existsSync(file)) return false;
  const st = statSync(file);
  if (!st.isFile()) return false;
  res.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': cache,
  });
  createReadStream(file).pipe(res);
  return true;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function checkCsrf(ctx: Ctx) {
  if (!MUTATING.has(ctx.method)) return;
  // 1) Özel başlık: tarayıcılar çapraz siteden bu başlığı CORS ön kontrolü olmadan gönderemez.
  if (ctx.req.headers['x-koltuk-client'] !== '1') throw new HttpError(403, 'csrf', 'Geçersiz istek kaynağı.');
  // 2) Origin kontrolü (varsa)
  const origin = ctx.req.headers.origin;
  if (origin) {
    const host = ctx.req.headers.host;
    let ok = false;
    try {
      const o = new URL(origin);
      ok = o.host === host || origin === config.appUrl;
    } catch {
      ok = false;
    }
    if (!ok) throw new HttpError(403, 'csrf', 'Geçersiz istek kaynağı.');
  }
  // 3) Oturum açıkken oturuma bağlı CSRF anahtarı
  if (ctx.session && ctx.req.headers['x-csrf-token'] !== ctx.session.csrf_token) {
    throw new HttpError(403, 'csrf', 'Oturum doğrulaması başarısız. Sayfayı yenileyip tekrar deneyin.');
  }
}

export async function handle(req: IncomingMessage, res: ServerResponse) {
  securityHeaders(res);
  const url = new URL(req.url ?? '/', 'http://local');
  const path = url.pathname;
  const method = (req.method ?? 'GET').toUpperCase();

  if (!path.startsWith('/api/')) {
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    if (path.startsWith('/assets/') && serveStatic(res, PUBLIC_DIR, path, config.isProduction ? 'public, max-age=31536000, immutable' : 'no-cache')) return;
    if (path.startsWith('/uploads/') && serveStatic(res, config.uploadDir, path.slice('/uploads'.length), 'public, max-age=86400')) return;
    if (/^\/(favicon\.svg|robots\.txt|manifest\.webmanifest)$/.test(path) && serveStatic(res, PUBLIC_DIR, path, 'public, max-age=86400')) return;
    if (path.startsWith('/assets/') || path.startsWith('/uploads/')) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Bulunamadı');
      return;
    }
    await serveApp(res, path);
    return;
  }

  const responseHeaders: Record<string, string | string[]> = {};
  const cookies: string[] = [];
  let bodyRead = false;
  const ctx: Ctx = {
    req,
    res,
    method,
    path,
    params: {},
    query: url.searchParams,
    ip: clientIp(req),
    cookies: parseCookies(req.headers.cookie),
    user: null,
    session: null,
    responseHeaders,
    async json(schema) {
      if (bodyRead) throw new Error('Gövde iki kez okunamaz');
      bodyRead = true;
      const ct = String(req.headers['content-type'] ?? '');
      if (!ct.includes('application/json')) throw new HttpError(415, 'unsupported_media_type', 'İstek JSON olmalıdır.');
      const buf = await readBody(req, 1_000_000);
      let data: unknown;
      try {
        data = buf.length ? JSON.parse(buf.toString('utf8')) : {};
      } catch {
        throw new HttpError(400, 'bad_json', 'Geçersiz JSON.');
      }
      const r = schema.safeParse(data);
      if (!r.success) throw validationError(r.error);
      return r.data;
    },
    setCookie(name, value, opts) {
      cookies.push(serializeCookie(name, value, opts));
    },
  };

  try {
    await loadSession(ctx);
    const m = router.match(method, path);
    if (m === null) throw new HttpError(404, 'not_found', 'İstenen kaynak bulunamadı.');
    if (m === 'method_not_allowed') throw new HttpError(405, 'method_not_allowed', 'Bu yöntem desteklenmiyor.');
    checkCsrf(ctx);
    ctx.params = m.params;
    const result = await m.handler(ctx);
    if (cookies.length) responseHeaders['Set-Cookie'] = cookies;
    if (res.headersSent) return;
    sendJson(res, ctx.status ?? 200, result ?? { ok: true }, responseHeaders);
  } catch (e) {
    if (cookies.length) responseHeaders['Set-Cookie'] = cookies;
    if (res.headersSent) return;
    if (e instanceof HttpError) {
      sendJson(res, e.status, { error: { code: e.code, message: e.message, fields: e.fields } }, responseHeaders);
      return;
    }
    if (e instanceof ZodError) {
      const v = validationError(e);
      sendJson(res, 422, { error: { code: v.code, message: v.message, fields: v.fields } }, responseHeaders);
      return;
    }
    const pgCode = (e as { code?: string }).code;
    if (pgCode === '23505') {
      sendJson(res, 409, { error: { code: 'duplicate', message: 'Bu kayıt zaten mevcut.' } }, responseHeaders);
      return;
    }
    if (pgCode === '22P02' || pgCode === '22007' || pgCode === '22008') {
      sendJson(res, 400, { error: { code: 'bad_request', message: 'Geçersiz parametre.' } }, responseHeaders);
      return;
    }
    // Hassas bilgi içermemesi için yalnızca hata türü ve mesajı loglanır; istek gövdesi loglanmaz.
    console.error(`[HATA] ${method} ${path}:`, (e as Error).message, config.isProduction ? '' : (e as Error).stack);
    sendJson(res, 500, { error: { code: 'internal', message: 'Beklenmeyen bir hata oluştu. Lütfen daha sonra tekrar deneyin.' } }, responseHeaders);
  }
}

export function createAppServer() {
  return createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error('[HATA] işlenmeyen:', (e as Error).message);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
}

export { sendJson };
