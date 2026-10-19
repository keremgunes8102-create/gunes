import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Link } from '../lib/router.tsx';
import { IconAlert, IconCheckCircle, IconInfo, IconStarFilled, IconX, IconRefresh } from './icons.tsx';
import type { ApiError } from '../lib/api.ts';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// --- Düğmeler --------------------------------------------------------------
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark';
export function Button({
  variant = 'primary',
  size = 'md',
  busy,
  block,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; busy?: boolean; block?: boolean }) {
  return (
    <button
      type="button"
      className={cx('btn', `btn-${variant}`, `btn-${size}`, block && 'btn-block', busy && 'is-busy', className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy && <span className="spinner spinner-sm" aria-hidden />}
      <span className="btn-label">{children}</span>
    </button>
  );
}

export function ButtonLink({ to, variant = 'primary', size = 'md', block, className, children }: { to: string; variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; block?: boolean; className?: string; children: ReactNode }) {
  return (
    <Link to={to} className={cx('btn', `btn-${variant}`, `btn-${size}`, block && 'btn-block', className)}>
      <span className="btn-label">{children}</span>
    </Link>
  );
}

// --- Form alanları ---------------------------------------------------------
export function Field({ label, hint, error, children, id, optional, className }: { label: ReactNode; hint?: ReactNode; error?: string; children: (id: string, describedBy?: string) => ReactNode; id?: string; optional?: boolean; className?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  const hintId = hint ? `${fid}-hint` : undefined;
  const errId = error ? `${fid}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('field', error && 'has-error', className)}>
      <label htmlFor={fid} className="field-label">
        {label}
        {optional && <span className="field-optional"> (isteğe bağlı)</span>}
      </label>
      {children(fid, describedBy)}
      {hint && !error && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={errId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextInput({ label, hint, error, optional, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode; error?: string; optional?: boolean }) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional} className={className}>
      {(id, d) => <input id={id} className="input" aria-invalid={Boolean(error) || undefined} aria-describedby={d} {...rest} />}
    </Field>
  );
}

export function TextArea({ label, hint, error, optional, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: ReactNode; hint?: ReactNode; error?: string; optional?: boolean }) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional}>
      {(id, d) => <textarea id={id} className="input textarea" aria-invalid={Boolean(error) || undefined} aria-describedby={d} {...rest} />}
    </Field>
  );
}

export function Select({ label, hint, error, optional, children, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: ReactNode; hint?: ReactNode; error?: string; optional?: boolean }) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional} className={className}>
      {(id, d) => (
        <select id={id} className="input select" aria-invalid={Boolean(error) || undefined} aria-describedby={d} {...rest}>
          {children}
        </select>
      )}
    </Field>
  );
}

export function Checkbox({ label, checked, onChange, error, description, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; error?: string; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className={cx('check', error && 'has-error')}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? `${id}-e` : undefined} />
      <label htmlFor={id}>
        <span>{label}</span>
        {description && <span className="check-desc">{description}</span>}
      </label>
      {error && (
        <p className="field-error" id={`${id}-e`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Switch({ label, checked, onChange, description, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="switch-row">
      <div>
        <label htmlFor={id} className="switch-label">
          {label}
        </label>
        {description && <p className="field-hint">{description}</p>}
      </div>
      <button id={id} type="button" role="switch" aria-checked={checked} className={cx('switch', checked && 'on')} onClick={() => onChange(!checked)} disabled={disabled}>
        <span />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={cx(value === o.value && 'active')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// --- Durum bileşenleri -----------------------------------------------------
export function Spinner({ label = 'Yükleniyor' }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%', r = 8 }: { h?: number; w?: number | string; r?: number }) {
  return <span className="skeleton" style={{ height: h, width: w, borderRadius: r }} aria-hidden />;
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError | Error | null; onRetry?: () => void }) {
  const status = (error as ApiError)?.status;
  return (
    <div className="empty error-state" role="alert">
      <div className="empty-icon">
        <IconAlert size={28} />
      </div>
      <h3>{status === 404 ? 'Bulunamadı' : status === 0 ? 'Bağlantı sorunu' : 'Bir sorun oluştu'}</h3>
      <p>{error?.message ?? 'Beklenmeyen bir hata oluştu.'}</p>
      {onRetry && status !== 404 && (
        <Button variant="secondary" onClick={onRetry}>
          <IconRefresh size={16} /> Tekrar dene
        </Button>
      )}
    </div>
  );
}

export function Alert({ tone = 'info', title, children }: { tone?: 'info' | 'success' | 'warning' | 'error'; title?: ReactNode; children?: ReactNode }) {
  const Icon = tone === 'success' ? IconCheckCircle : tone === 'info' ? IconInfo : IconAlert;
  return (
    <div className={cx('alert', `alert-${tone}`)} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={18} />
      <div>
        {title && <strong>{title}</strong>}
        {children && <div className="alert-body">{children}</div>}
      </div>
    </div>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'green' | 'beige' | 'amber' | 'red' | 'dark'; children: ReactNode }) {
  return <span className={cx('badge', `badge-${tone}`)}>{children}</span>;
}

export function Rating({ value, count, size = 'md' }: { value: string | number | null; count: number; size?: 'sm' | 'md' }) {
  if (!value || !count) return <span className={cx('rating', 'rating-none', size === 'sm' && 'rating-sm')}>Henüz değerlendirme yok</span>;
  return (
    <span className={cx('rating', size === 'sm' && 'rating-sm')} aria-label={`5 üzerinden ${value} puan, ${count} değerlendirme`}>
      <IconStarFilled size={size === 'sm' ? 14 : 16} />
      <strong>{String(value).replace('.', ',')}</strong>
      <span className="muted">({count})</span>
    </span>
  );
}

export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <div className={cx('card', padded && 'card-pad', className)}>{children}</div>;
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="page-header">
      <div>
        {back && (
          <Link to={back.to} className="back-link">
            ← {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {description && <p className="page-desc">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

// --- Modal / Onay ----------------------------------------------------------
export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((x) => !x.hasAttribute('disabled'));
    setTimeout(() => (focusables()[1] ?? focusables()[0])?.focus(), 10);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('modal', `modal-${size}`)} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Kapat">
            <IconX />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmOpts {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  reason?: { label: string; required?: boolean; placeholder?: string };
}
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<{ ok: boolean; reason: string }>>(async () => ({ ok: false, reason: '' }));

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: { ok: boolean; reason: string }) => void }) | null>(null);
  const [reason, setReason] = useState('');
  const confirm = useCallback((o: ConfirmOpts) => new Promise<{ ok: boolean; reason: string }>((resolve) => {
    setReason('');
    setState({ ...o, resolve });
  }), []);
  const close = (ok: boolean) => {
    state?.resolve({ ok, reason: reason.trim() });
    setState(null);
  };
  const needReason = Boolean(state?.reason?.required) && !reason.trim();
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={Boolean(state)}
        onClose={() => close(false)}
        title={state?.title ?? ''}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              Vazgeç
            </Button>
            <Button variant={state?.tone === 'danger' ? 'danger' : 'primary'} onClick={() => close(true)} disabled={needReason}>
              {state?.confirmLabel ?? 'Onayla'}
            </Button>
          </>
        }
      >
        <div className="stack">
          <div className="muted-strong">{state?.message}</div>
          {state?.reason && (
            <TextArea label={state.reason.label} optional={!state.reason.required} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={state.reason.placeholder} rows={3} maxLength={300} />
          )}
        </div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

// --- Bildirim (toast) ------------------------------------------------------
type Toast = { id: number; tone: 'success' | 'error' | 'info'; text: string };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, tone, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={cx('toast', `toast-${t.tone}`)} role={t.tone === 'error' ? 'alert' : 'status'}>
            {t.tone === 'success' ? <IconCheckCircle size={18} /> : t.tone === 'error' ? <IconAlert size={18} /> : <IconInfo size={18} />}
            <span>{t.text}</span>
            <button type="button" className="icon-btn" aria-label="Kapat" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}>
              <IconX size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// --- Sekmeler --------------------------------------------------------------
export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[]; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((i) => (
        <button key={i.value} type="button" role="tab" aria-selected={value === i.value} className={cx('tab', value === i.value && 'active')} onClick={() => onChange(i.value)}>
          {i.label}
          {i.count !== undefined && i.count > 0 && <span className="tab-count">{i.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function TabLinks({ items, current }: { items: { to: string; label: ReactNode; count?: number }[]; current: string }) {
  return (
    <nav className="tabs" aria-label="Bölümler">
      {items.map((i) => (
        <Link key={i.to} to={i.to} className={cx('tab', current === i.to && 'active')} aria-current={current === i.to ? 'page' : undefined}>
          {i.label}
          {i.count !== undefined && i.count > 0 && <span className="tab-count">{i.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

export function DemoBadge() {
  return (
    <span className="badge badge-amber" title="Bu kayıt demo amaçlıdır; gerçek bir işletmeyi temsil etmez.">
      Örnek işletme
    </span>
  );
}
