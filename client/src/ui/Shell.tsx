/* The glass top bar: brand, page tabs with a sliding pill, and the account menu. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { gsap, motionOK } from '../motion';
import { useStore, type Route } from '../store';
import { setTheme, useTheme } from '../theme';
import { IAuto, IGrid, IMoon, ISignOut, ISun, IUpload, IUser } from './icons';

export const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

const TABS: { page: Route['page']; label: string; icon: ReactNode }[] = [
  { page: 'library', label: 'Library', icon: <IGrid /> },
  { page: 'send', label: 'Send files', icon: <IUpload /> },
  { page: 'account', label: 'Account', icon: <IUser /> },
];

export function Shell({ children }: { children: ReactNode }) {
  const s = useStore();
  const tabs = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const theme = useTheme();
  const current = s.route.page === 'collection' ? 'library' : s.route.page;
  const first = useRef(true);

  // the pill slides to the current tab
  useLayoutEffect(() => {
    const place = () => {
      const el = tabs.current?.querySelector<HTMLElement>(`[data-page="${current}"]`);
      if (!el || !pill.current) return;
      const to = { x: el.offsetLeft, width: el.offsetWidth };
      if (first.current || !motionOK()) gsap.set(pill.current, to);
      else gsap.to(pill.current, { ...to, duration: 0.55, ease: 'elastic.out(1, 0.8)' });
      first.current = false;
    };
    place();
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, [current]);

  useEffect(() => {
    const on = () => setScrolled(scrollY > 8);
    addEventListener('scroll', on, { passive: true });
    return () => removeEventListener('scroll', on);
  }, []);

  // the moving colour behind the top of the page
  useEffect(() => {
    if (!motionOK()) return;
    const tw = gsap.utils.toArray<HTMLElement>('.aura i').map((el, i) =>
      gsap.to(el, { x: `${(i % 2 ? -1 : 1) * (6 + i * 3)}vw`, y: `${4 + i * 2}vh`, scale: 1.15, duration: 10 + i * 3, ease: 'sine.inOut', yoyo: true, repeat: -1 }),
    );
    return () => tw.forEach((t) => t.kill());
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as HTMLElement).closest('.nav-end')) setMenu(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    if (motionOK()) gsap.fromTo('.menu', { autoAlpha: 0, scale: 0.92, y: -6 }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.35, ease: 'back.out(1.6)' });
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menu]);

  const pop = (el: HTMLElement) => motionOK() && gsap.fromTo(el.querySelector('svg'), { scale: 0.7 }, { scale: 1, duration: 0.6, ease: 'elastic.out(1.2, 0.5)' });

  return (
    <>
      <div className="aura" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <header className={`nav${scrolled ? ' scrolled' : ''}`}>
        <button className="nav-brand" onClick={() => s.go({ page: 'library' })}>
          <span className="mark" />
          <span>
            <strong>Moon Library</strong>
            <small>{s.me.client.name}</small>
          </span>
        </button>
        <nav className="tabs" ref={tabs} aria-label="Pages">
          <span className="tab-pill" ref={pill} aria-hidden />
          {TABS.map((t) => (
            <button
              key={t.page}
              data-page={t.page}
              className={`tab${current === t.page ? ' on' : ''}`}
              aria-current={current === t.page ? 'page' : undefined}
              onClick={(e) => {
                pop(e.currentTarget);
                s.go({ page: t.page } as Route);
                scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="nav-end" style={{ position: 'relative' }}>
          <button className="icon-btn" aria-label="Change appearance" title="Appearance" onClick={(e) => (pop(e.currentTarget), setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'))}>
            {theme === 'light' ? <ISun /> : theme === 'dark' ? <IMoon /> : <IAuto />}
          </button>
          <button className="avatar-btn" aria-label="Account menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
            <span className="avatar" style={{ ['--c' as string]: s.me.client.color || undefined }}>
              {initials(s.me.user.name)}
            </span>
          </button>
          {menu && (
            <div className="menu" role="menu">
              <div className="menu-head">
                <strong>{s.me.user.name}</strong>
                <small>{s.me.user.email}</small>
              </div>
              <button role="menuitem" onClick={() => (setMenu(false), s.go({ page: 'account' }))}>
                <IUser /> Account
              </button>
              <button role="menuitem" onClick={() => (setMenu(false), s.signOut())}>
                <ISignOut /> Sign out
              </button>
            </div>
          )}
        </div>
      </header>
      {children}
      <div className="toasts" aria-live="polite">
        {s.toasts.map((t) => (
          <div key={t.id} className={`toast${t.tone === 'err' ? ' err' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
