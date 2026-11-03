/* Account: who you are, how the site looks, your password, sign out. */
import { useLayoutEffect, useRef, useState } from 'react';
import { changePassword, errText } from '../api';
import { gsap, motionOK } from '../motion';
import { useStore } from '../store';
import { setTheme, useTheme, type Theme } from '../theme';
import { ISignOut } from '../ui/icons';
import { initials } from '../ui/Shell';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Automatic' },
];

export function AccountPage() {
  const s = useStore();
  const theme = useTheme();
  const page = useRef<HTMLElement>(null);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    if (!motionOK()) return;
    const ctx = gsap.context(() => {
      gsap.from('.hero h1', { autoAlpha: 0, y: 24, duration: 0.8, ease: 'expo.out' });
      gsap.from('.card', { autoAlpha: 0, y: 30, stagger: 0.08, duration: 0.8, ease: 'expo.out', delay: 0.1 });
      gsap.from('.profile .avatar', { scale: 0.5, rotation: -20, duration: 1, ease: 'elastic.out(1, 0.5)', delay: 0.25 });
    }, page);
    return () => ctx.revert();
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await changePassword(cur, next);
      setCur('');
      setNext('');
      setAgain('');
      s.toast('Password changed', 'ok');
    } catch (err) {
      s.toast(errText(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page" ref={page}>
      <section className="hero" style={{ paddingBottom: 24 }}>
        <h1>Account</h1>
      </section>
      <div className="account">
        <div className="card profile">
          <span className="avatar" style={{ ['--c' as string]: s.me.client.color || undefined }}>
            {initials(s.me.user.name)}
          </span>
          <strong>{s.me.user.name}</strong>
          <small>{s.me.user.email}</small>
          <br />
          <span className="company">{s.me.client.name}</span>
          <button className="btn danger" onClick={s.signOut}>
            <ISignOut /> Sign out
          </button>
        </div>
        <div className="stack">
          <div className="card">
            <h3>Appearance</h3>
            <p>Saved on this browser.</p>
            <div className="theme-pick" role="radiogroup" aria-label="Appearance">
              {THEMES.map((t) => (
                <button key={t.value} role="radio" aria-checked={theme === t.value} className={`theme-opt${theme === t.value ? ' on' : ''}`} onClick={() => setTheme(t.value)}>
                  <span className={`sw ${t.value}`} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="card">
            <h3>Password</h3>
            <p>Changing it signs you out on your other devices.</p>
            <form className="form" onSubmit={save}>
              <label className="field">
                <span>Current password</span>
                <input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
              </label>
              <label className="field">
                <span>New password</span>
                <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
                <small className="muted">At least 8 characters.</small>
              </label>
              <label className="field">
                <span>New password again</span>
                <input className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
                {again && again !== next && <small className="err">The two don't match.</small>}
              </label>
              <button className="btn primary" disabled={busy || !cur || next.length < 8 || next !== again}>
                Change password
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
