import { APPOINTMENT_STATUS_LABEL, VERIFICATION_STATUS_LABEL, type AppointmentStatus } from '../../shared/constants.ts';
import { Badge, cx } from './index.tsx';

export function Logo({ size = 22, inverse = false }: { size?: number; inverse?: boolean }) {
  return (
    <span className={cx('logo', inverse && 'logo-inverse')} style={{ fontSize: size }}>
      <svg width={size * 1.15} height={size * 1.15} viewBox="0 0 32 32" aria-hidden focusable={false}>
        <rect width="32" height="32" rx="9" fill={inverse ? '#F8F7F4' : '#235C45'} />
        <path d="M10 8.5h12a1.5 1.5 0 0 1 1.5 1.5v6H8.5v-6A1.5 1.5 0 0 1 10 8.5Z" fill={inverse ? '#235C45' : '#F8F7F4'} />
        <rect x="7" y="16" width="18" height="3.4" rx="1.2" fill={inverse ? '#235C45' : '#E8E0D4'} />
        <path d="M11 19.4 10 24M21 19.4l1 4.6M16 19.4V24" stroke={inverse ? '#235C45' : '#E8E0D4'} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <span className="logo-word">KOLTUK</span>
    </span>
  );
}

const PALETTES = [
  ['#E8E0D4', '#235C45'],
  ['#DCE5DF', '#1E4D3A'],
  ['#EFE7DC', '#5B4A3A'],
  ['#E4E1D8', '#222522'],
  ['#E9DED7', '#7A4E3C'],
];
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Fotoğrafı olmayan işletmeler için zarif, deterministik kapak görseli */
export function BusinessVisual({ name, type, url, className, rounded = true }: { name: string; type: string; url?: string | null; className?: string; rounded?: boolean }) {
  if (url) return <img src={url} alt="" className={cx('biz-visual', rounded && 'rounded', className)} loading="lazy" />;
  const h = hash(name);
  const [bg, fg] = PALETTES[h % PALETTES.length];
  const initial = name.replace(/^Örnek\s+/i, '').trim().charAt(0).toLocaleUpperCase('tr-TR');
  return (
    <div className={cx('biz-visual', 'biz-visual-gen', rounded && 'rounded', className)} style={{ background: bg, color: fg }} aria-hidden>
      <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" className="biz-visual-art">
        {type === 'barber' && (
          <g fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.22">
            {Array.from({ length: 9 }, (_, i) => (
              <path key={i} d={`M${-40 + i * 30} 130 L${40 + i * 30} -10`} />
            ))}
          </g>
        )}
        {type === 'hair_salon' && (
          <g fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.22">
            {Array.from({ length: 7 }, (_, i) => (
              <path key={i} d={`M-10 ${20 + i * 14} C 40 ${i * 14}, 80 ${40 + i * 14}, 210 ${10 + i * 14}`} />
            ))}
          </g>
        )}
        {type === 'beauty' && (
          <g fill="currentColor" opacity="0.13">
            {Array.from({ length: 24 }, (_, i) => (
              <circle key={i} cx={(i % 8) * 28 + ((Math.floor(i / 8) % 2) * 14) + 6} cy={Math.floor(i / 8) * 40 + 20} r={5 + ((h + i) % 4)} />
            ))}
          </g>
        )}
      </svg>
      <span className="biz-visual-initial">{initial}</span>
    </div>
  );
}

export function StatusBadge({ status }: { status: AppointmentStatus | string }) {
  const tone: Record<string, 'green' | 'amber' | 'red' | 'neutral' | 'dark' | 'beige'> = {
    pending: 'amber',
    confirmed: 'green',
    completed: 'dark',
    cancelled_by_customer: 'neutral',
    cancelled_by_business: 'red',
    rejected: 'red',
    no_show: 'red',
    expired: 'neutral',
  };
  return <Badge tone={tone[status] ?? 'neutral'}>{APPOINTMENT_STATUS_LABEL[status as AppointmentStatus] ?? status}</Badge>;
}

export function VerificationBadge({ status }: { status: string }) {
  const tone = status === 'approved' ? 'green' : status === 'pending_review' ? 'amber' : status === 'draft' ? 'beige' : 'red';
  return <Badge tone={tone}>{VERIFICATION_STATUS_LABEL[status] ?? status}</Badge>;
}
