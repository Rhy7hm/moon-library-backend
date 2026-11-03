/*
 * The one sign-in page for everyone at library.moon-interactive.com. Clients sign in with their email
 * and stay on this site; staff sign in with their ID and go on to the admin (/admin).
 * Plain, like the admin's own sign-in: a soft background, one card, light or dark with the device.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { ADMIN_URL, errText, isStaffId, signIn, staffSignIn, type Me } from '../api';
import { gsap, motionOK } from '../motion';

export function SignIn({ onIn }: { onIn: (me: Me) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useLayoutEffect(() => {
    if (!motionOK()) return;
    const ctx = gsap.context(() => {
      gsap
        .timeline({ defaults: { ease: 'expo.out' } })
        .from('.auth-card', { opacity: 0, y: 24, scale: 0.97, duration: 0.9, clearProps: 'opacity,transform' })
        .from('.auth-card > *', { opacity: 0, y: 8, stagger: 0.04, duration: 0.6, clearProps: 'opacity,transform' }, 0.15)
        .from('.auth-foot', { opacity: 0, duration: 0.8 }, 0.5);
    }, root);
    return () => ctx.revert();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const who = login.trim();
      const staffMember = isStaffId(who);
      const me = staffMember ? null : await signIn(who, password);
      if (staffMember) await staffSignIn(who.toLowerCase(), password);
      if (motionOK()) await gsap.to(root.current, { opacity: 0, duration: 0.3, ease: 'power2.in' });
      if (staffMember) return location.assign(ADMIN_URL);
      onIn(me!);
    } catch (err) {
      setBusy(false);
      setError(errText(err));
      if (motionOK()) gsap.fromTo(form.current, { x: 0 }, { keyframes: { x: [-10, 9, -6, 4, 0] }, duration: 0.45, ease: 'power1.out' });
    }
  };

  return (
    <div className="auth" ref={root}>
      <form className="auth-card" ref={form} onSubmit={submit}>
        <span className="auth-mark">
          <img src="/favicon.png" alt="" width={52} height={52} draggable={false} />
        </span>
        <h1>Sign in</h1>
        <p className="muted">Clients: use your email. Team: use your staff ID.</p>
        <label className="field">
          <span>Email or staff ID</span>
          <input
            className="input"
            type="text"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            required
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="you@company.com"
          />
        </label>
        <label className="field">
          <span>Password</span>
          <span className="pw-wrap">
            <input className="input" type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? 'Hide' : 'Show'}
            </button>
          </span>
        </label>
        {error && (
          <p className="auth-err" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn primary auth-btn" disabled={busy || !login.trim() || !password}>
          {busy ? <span className="spinner" /> : 'Sign in'}
        </button>
        <p className="auth-help">Forgot your password? Clients, ask your contact at the studio; team members, ask an Owner.</p>
      </form>
      <p className="auth-foot">Moon Library</p>
    </div>
  );
}
