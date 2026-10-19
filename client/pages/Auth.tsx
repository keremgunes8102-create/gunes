import { useState } from 'react';
import { Link, navigate, useSearchParams } from '../lib/router.tsx';
import { api } from '../lib/api.ts';
import { useApi, useDocumentTitle, useSubmit } from '../lib/hooks.ts';
import { useAuth, type MeResponse } from '../lib/auth.tsx';
import { Alert, Button, ButtonLink, Card, Checkbox, ErrorState, Spinner, TextInput, useToast } from '../ui/index.tsx';
import { Logo } from '../ui/brand.tsx';
import { MEMBER_ROLE_LABEL, type MemberRole } from '../../shared/constants.ts';

const safeNext = (n: string | null, fallback = '/') => (n && n.startsWith('/') && !n.startsWith('//') ? n : fallback);

export function Login() {
  useDocumentTitle('Giriş yap');
  const [params] = useSearchParams();
  const { setSession, user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const next = safeNext(params.get('next'));
  const { data: meta } = useApi<{ demoMode?: boolean }>('/api/meta');
  const { run, busy, error, fields } = useSubmit(async () => {
    const d = await api.post<MeResponse>('/api/auth/login', { email, password });
    setSession(d);
    navigate(next);
  });
  if (user) {
    return (
      <div className="auth-wrap">
        <Card className="auth-card">
          <h1>Zaten giriş yaptınız</h1>
          <ButtonLink to={next}>Devam et</ButtonLink>
        </Card>
      </div>
    );
  }
  return (
    <div className="auth-wrap">
      <Card className="auth-card">
        <div style={{ marginBottom: 20 }}><Logo /></div>
        <h1>Giriş yap</h1>
        <p className="muted">Randevularını yönetmek için hesabına giriş yap.</p>
        {meta?.demoMode && (
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            <div className="small">
              <strong>Demo hesapları</strong> (şifre: <span className="mono">Demo1234</span>) — tıklayınca doldurulur:
              <div className="chips" style={{ marginTop: 8 }}>
                {[['Müşteri', 'musteri@koltuk.demo'], ['İşletme', 'isletme@koltuk.demo'], ['Çalışan', 'calisan@koltuk.demo'], ['Yönetici', 'admin@koltuk.demo']].map(([l, e]) => (
                  <button key={e} type="button" className="chip" onClick={() => { setEmail(e); setPassword('Demo1234'); }}>{l}</button>
                ))}
              </div>
            </div>
          </div>
        )}
        <form className="stack" onSubmit={(e) => { e.preventDefault(); run(); }} noValidate>
          {error && !Object.keys(fields).length && <Alert tone="error">{error}</Alert>}
          <TextInput label="E-posta" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} required />
          <TextInput label="Şifre" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} required />
          <div className="row-between">
            <Link to="/sifremi-unuttum" className="small">Şifremi unuttum</Link>
          </div>
          <Button type="submit" size="lg" block busy={busy}>Giriş yap</Button>
        </form>
        <p className="muted small" style={{ marginTop: 20, marginBottom: 0, textAlign: 'center' }}>
          Hesabın yok mu? <Link to={`/uye-ol${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} style={{ color: 'var(--green)', fontWeight: 600 }}>Üye ol</Link>
        </p>
      </Card>
    </div>
  );
}

export function Register({ businessFlow = false }: { businessFlow?: boolean }) {
  useDocumentTitle(businessFlow ? 'İşletme hesabı oluştur' : 'Üye ol');
  const [params] = useSearchParams();
  const { setSession } = useAuth();
  const [f, setF] = useState({ full_name: '', email: '', phone: '', password: '', accept_terms: false, privacy_notice_ack: false, marketing_email: false, marketing_sms: false });
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const next = businessFlow ? '/panel/yeni' : safeNext(params.get('next'), '/');
  const { run, busy, error, fields } = useSubmit(async () => {
    const d = await api.post<MeResponse>('/api/auth/register', { ...f, phone: f.phone || null });
    setSession(d);
    navigate(next);
  });
  return (
    <div className="auth-wrap">
      <Card className="auth-card">
        <div style={{ marginBottom: 20 }}><Logo /></div>
        {businessFlow && <p className="muted small" style={{ marginBottom: 4 }}>Adım 1 / 9 — Hesap oluştur</p>}
        <h1>{businessFlow ? 'İşletme hesabı oluştur' : 'Üye ol'}</h1>
        <p className="muted">{businessFlow ? 'Önce kendi hesabınızı oluşturun; ardından işletme bilgilerinizi adım adım ekleyeceğiz.' : 'Randevularını tek yerden yönet.'}</p>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); run(); }} noValidate>
          {error && !Object.keys(fields).length && <Alert tone="error">{error}</Alert>}
          <TextInput label="Ad soyad" autoComplete="name" value={f.full_name} onChange={(e) => set('full_name', e.target.value)} error={fields.full_name} required />
          <TextInput label="E-posta" type="email" autoComplete="email" value={f.email} onChange={(e) => set('email', e.target.value)} error={fields.email} required />
          <TextInput label="Cep telefonu" type="tel" autoComplete="tel" inputMode="tel" placeholder="05xx xxx xx xx" value={f.phone} onChange={(e) => set('phone', e.target.value)} error={fields.phone} optional={!businessFlow} hint="Randevu bildirimleri için kullanılır." />
          <TextInput label="Şifre" type="password" autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} error={fields.password} hint="En az 8 karakter; en az bir harf ve bir rakam." required />
          <div className="stack-sm">
            <Checkbox checked={f.privacy_notice_ack} onChange={(v) => set('privacy_notice_ack', v)} error={fields.privacy_notice_ack} label={<>
              <Link to="/kvkk" target="_blank" style={{ color: 'var(--green)', fontWeight: 600 }}>KVKK aydınlatma metnini</Link> okudum.
            </>} />
            <Checkbox checked={f.accept_terms} onChange={(v) => set('accept_terms', v)} error={fields.accept_terms} label={<>
              <Link to="/kullanim-kosullari" target="_blank" style={{ color: 'var(--green)', fontWeight: 600 }}>Kullanım koşullarını</Link> kabul ediyorum.
            </>} />
            <Checkbox checked={f.marketing_email} onChange={(v) => set('marketing_email', v)} label="Kampanya ve duyuruları e-posta ile almak istiyorum." description="İsteğe bağlıdır; randevu bildirimlerinizi etkilemez. İstediğiniz zaman geri alabilirsiniz." />
            <Checkbox checked={f.marketing_sms} onChange={(v) => set('marketing_sms', v)} label="Kampanya ve duyuruları SMS ile almak istiyorum." description="İsteğe bağlıdır (ticari elektronik ileti onayı)." />
          </div>
          <Button type="submit" size="lg" block busy={busy}>{businessFlow ? 'Hesabı oluştur ve devam et' : 'Üye ol'}</Button>
        </form>
        <p className="muted small" style={{ marginTop: 20, marginBottom: 0, textAlign: 'center' }}>
          Zaten hesabın var mı? <Link to={`/giris?next=${encodeURIComponent(next)}`} style={{ color: 'var(--green)', fontWeight: 600 }}>Giriş yap</Link>
        </p>
      </Card>
    </div>
  );
}

export function ForgotPassword() {
  useDocumentTitle('Şifremi unuttum');
  const [email, setEmail] = useState('');
  const [done, setDone] = useState<{ message: string; devLink?: string; emailConfigured: boolean } | null>(null);
  const { run, busy, error, fields } = useSubmit(async () => setDone(await api.post('/api/auth/password/forgot', { email })));
  return (
    <div className="auth-wrap">
      <Card className="auth-card">
        <h1>Şifremi unuttum</h1>
        {done ? (
          <div className="stack">
            <Alert tone="success">{done.message}</Alert>
            {!done.emailConfigured && <Alert tone="warning">E-posta servisi henüz yapılandırılmadığı için gerçek e-posta gönderilmedi.</Alert>}
            {done.devLink && (
              <Alert tone="info" title="Geliştirme modu">
                Sıfırlama bağlantısı: <Link to={done.devLink} style={{ wordBreak: 'break-all' }}>{done.devLink.slice(0, 48)}…</Link>
              </Alert>
            )}
            <ButtonLink to="/giris" variant="secondary">Girişe dön</ButtonLink>
          </div>
        ) : (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); run(); }} noValidate>
            <p className="muted">Hesabınıza kayıtlı e-posta adresini girin; şifre sıfırlama bağlantısı göndereceğiz.</p>
            {error && !fields.email && <Alert tone="error">{error}</Alert>}
            <TextInput label="E-posta" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} autoComplete="email" />
            <Button type="submit" size="lg" block busy={busy}>Bağlantı gönder</Button>
          </form>
        )}
      </Card>
    </div>
  );
}

export function ResetPassword() {
  useDocumentTitle('Yeni şifre');
  const [params] = useSearchParams();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const { run, busy, error, fields } = useSubmit(async () => {
    await api.post('/api/auth/password/reset', { token: params.get('token') ?? '', password });
    toast('Şifreniz güncellendi. Yeni şifrenizle giriş yapabilirsiniz.');
    navigate('/giris');
  });
  return (
    <div className="auth-wrap">
      <Card className="auth-card">
        <h1>Yeni şifre belirle</h1>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); run(); }} noValidate>
          {error && !fields.password && <Alert tone="error">{error}</Alert>}
          <TextInput label="Yeni şifre" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} hint="En az 8 karakter; en az bir harf ve bir rakam." />
          <Button type="submit" size="lg" block busy={busy}>Şifreyi güncelle</Button>
        </form>
      </Card>
    </div>
  );
}

export function Invitation({ token }: { token: string }) {
  const { user, refresh } = useAuth();
  const { data, loading, error } = useApi<{ business_name: string; role: MemberRole; expired: boolean; email_hint: string }>(`/api/invitations/${token}`);
  const { run, busy, error: accErr } = useSubmit(async () => {
    const r = await api.post<{ business_id: string }>(`/api/invitations/${token}/accept`);
    await refresh();
    navigate(`/panel/${r.business_id}`);
  });
  useDocumentTitle('Ekip daveti');
  if (loading) return <Spinner />;
  if (error || !data) return <div className="container section"><ErrorState error={error} /></div>;
  const here = `/davet/${token}`;
  return (
    <div className="auth-wrap">
      <Card className="auth-card">
        <h1>Ekip daveti</h1>
        <p><strong>{data.business_name}</strong> sizi KOLTUK'ta <strong>{MEMBER_ROLE_LABEL[data.role].toLocaleLowerCase('tr-TR')}</strong> olarak ekibine davet etti.</p>
        <p className="muted small">Davet şu adrese gönderildi: {data.email_hint}</p>
        {data.expired ? (
          <Alert tone="warning">Bu davetin süresi dolmuş. İşletmeden yeni bir davet isteyin.</Alert>
        ) : !user ? (
          <div className="stack-sm">
            <Alert tone="info">Daveti kabul etmek için davetin gönderildiği e-posta adresiyle giriş yapın veya üye olun.</Alert>
            <ButtonLink to={`/giris?next=${encodeURIComponent(here)}`} block>Giriş yap</ButtonLink>
            <ButtonLink to={`/uye-ol?next=${encodeURIComponent(here)}`} variant="secondary" block>Üye ol</ButtonLink>
          </div>
        ) : (
          <div className="stack-sm">
            {accErr && <Alert tone="error">{accErr}</Alert>}
            {!user.email_verified_at && (
              <Alert tone="warning">
                Daveti kabul etmeden önce e-posta adresinizi doğrulamanız gerekir. <Link to={`/hesabim/profil?next=${encodeURIComponent(here)}`} style={{ fontWeight: 600 }}>Şimdi doğrula</Link>
              </Alert>
            )}
            <Button onClick={() => run()} busy={busy} block size="lg">Daveti kabul et</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
