import { useEffect, useRef, useState } from 'react';
import { cx } from '../ui/index.tsx';

/** Sessiz, döngülü ürün videosu. Hareket azaltma tercihinde otomatik oynatmaz; görünür değilken durur (pil/veri tasarrufu). */
export function LoopVideo({ src, poster, label, className }: { src: string; poster: string; label: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [paused, setPaused] = useState(reduced);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (reduced) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) v.play().then(() => setPaused(false)).catch(() => setPaused(true));
      else v.pause();
    }, { threshold: 0.2 });
    io.observe(v);
    return () => io.disconnect();
  }, [reduced]);
  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) v.play().then(() => setPaused(false)).catch(() => {});
    else { v.pause(); setPaused(true); }
  };
  return (
    <div className={cx('loop-video', className)}>
      <video ref={ref} poster={poster} muted loop playsInline preload="metadata" aria-label={label}>
        <source src={src.replace(/\.mp4$/, '.webm')} type="video/webm" />
        <source src={src} type="video/mp4" />
      </video>
      <button type="button" className="loop-video-btn" onClick={toggle} aria-label={paused ? 'Videoyu oynat' : 'Videoyu durdur'}>
        {paused ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M7 4.5v15l13-7.5z" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M6 4.5h4v15H6zM14 4.5h4v15h-4z" /></svg>
        )}
      </button>
    </div>
  );
}

export function PhoneFrame({ src, poster, label }: { src: string; poster: string; label: string }) {
  return (
    <div className="phone-frame">
      <div className="phone-notch" aria-hidden />
      <LoopVideo src={src} poster={poster} label={label} />
    </div>
  );
}

export function BrowserFrame({ src, poster, label, url = 'koltuk.onrender.com/panel' }: { src: string; poster: string; label: string; url?: string }) {
  return (
    <div className="browser-frame">
      <div className="browser-bar" aria-hidden>
        <span /><span /><span />
        <em>{url}</em>
      </div>
      <LoopVideo src={src} poster={poster} label={label} />
    </div>
  );
}

/** Tam genişlik, video arka planlı bant. Metin her zaman koyu örtü üzerinde açık renktir (tek görünüm, tema bağımsız). */
export function VideoBand({ src, poster, label, children, align = 'left' }: { src: string; poster: string; label: string; children: React.ReactNode; align?: 'left' | 'center' }) {
  return (
    <section className={cx('video-band', align === 'center' && 'center')}>
      <LoopVideo src={src} poster={poster} label={label} className="video-band-media" />
      <div className="video-band-shade" aria-hidden />
      <div className="container video-band-content">{children}</div>
    </section>
  );
}

/** Paket kartlarında arama görünürlüğü göstergesi (0–4). */
export function BoostMeter({ level }: { level: number }) {
  return (
    <div className="fb-boost" aria-label={`Aramada görünürlük: 4 üzerinden ${level}`}>
      <span>Görünürlük</span>
      {[1, 2, 3, 4].map((i) => <i key={i} className={i <= level ? 'on' : ''} />)}
    </div>
  );
}
