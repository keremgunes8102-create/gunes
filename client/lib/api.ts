// API istemcisi: CSRF başlıkları, hata modeli, JSON
let csrfToken: string | null = null;
export const setCsrf = (t: string | null) => {
  csrfToken = t;
};

export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

async function request<T>(method: string, path: string, body?: unknown, opts: { raw?: Blob; contentType?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Koltuk-Client': '1', Accept: 'application/json' };
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let payload: BodyInit | undefined;
  if (opts.raw) {
    payload = opts.raw;
    headers['Content-Type'] = opts.contentType ?? 'application/octet-stream';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network', 'Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.');
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string; fields?: Record<string, string> } })?.error;
    throw new ApiError(res.status, err?.code ?? 'unknown', err?.message ?? 'Beklenmeyen bir hata oluştu.', err?.fields);
  }
  if (data && typeof data === 'object' && 'csrfToken' in data) setCsrf((data as { csrfToken: string | null }).csrfToken);
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>('GET', p),
  post: <T = any>(p: string, b: unknown = {}) => request<T>('POST', p, b),
  put: <T = any>(p: string, b: unknown = {}) => request<T>('PUT', p, b),
  patch: <T = any>(p: string, b: unknown = {}) => request<T>('PATCH', p, b),
  del: <T = any>(p: string) => request<T>('DELETE', p),
  upload: <T = any>(p: string, file: File) => request<T>('POST', p, undefined, { raw: file, contentType: file.type }),
};

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
