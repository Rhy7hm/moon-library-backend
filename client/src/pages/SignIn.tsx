/*
 * The one sign-in page for everyone at library.moon-interactive.com. Clients sign in with their email
 * and stay on this site; staff sign in with their ID and go on to the admin (/admin).
 *
 * "Moonrise": always night. A full, glowing mineral moon (ui/MineralMoon) fills the right of the screen
 * on black, with the form on a dark glass card beside it (under it on a phone). All of it is one GSAP
 * choreography:
 *   arriving   stars fade in, the moon rises and its halo blooms, the greeting rises word by word out
 *              of a mask, the card settles and its parts follow; then the moon breathes
 *   pointer    the sky leans, a light follows over the moon and the card, the label of the field you are in warms
 *   typing     the moon brightens and its halo grows
 *   submitting the button narrows into a round loader
 *   wrong      the loader opens back out, the colour drains from the moon, its halo flushes red, the card shakes
 *   signed in  the loader turns into a tick and pulses; the card lifts away; the moon (which keeps its size) lifts a
 *              little, its light surges and it spins up, shock rings and sparks burst from its edge, the stars drift
 *              off; its light blooms out from the moon until it fills the screen; the dashboard then takes over from
 *              that light (arrive.ts / the admin's enter.ts)
 * With "reduce motion" there is no choreography: the page simply changes.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ADMIN_URL, errText, isStaffId, signIn, staffSignIn, type Me } from '../api';
import { arrive, markArrival } from '../arrive';
import { gsap, motionOK, SplitText } from '../motion';
import { MineralMoon, type MoonHandle } from '../ui/MineralMoon';
import { Stars } from '../ui/Night';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Up late?' : h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.';
}

export function SignIn({ onIn }: { onIn: (me: Me) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const moon = useRef<MoonHandle>(null);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hello = useRef(greeting()).current;

  // the scene: the moon rises in; the sky leans with the pointer
  useLayoutEffect(() => {
    if (!motionOK() || !root.current) return;
    const el = root.current;
    const ctx = gsap.context(() => {
      gsap.set(['.si-btn-spin', '.si-btn-check'], { opacity: 0, scale: 0.6 });
      gsap.to('.si-glow.g1', { x: '4vw', y: '3vh', duration: 14, ease: 'sine.inOut', yoyo: true, repeat: -1 });
      // the greeting rises out of a mask, a word at a time
      const split = new SplitText('.si-title', { type: 'lines,words', mask: 'lines', wordsClass: 'w' });
      gsap
        .timeline({ defaults: { ease: 'expo.out' } })
        .from('.si-sky', { opacity: 0, duration: 2.2, ease: 'power2.out' })
        .from('.si-moon-lean', { scale: 0.88, y: 50, opacity: 0, duration: 2.6 }, 0.1)
        .from('.mm-halo:not(.hot):not(.bad)', { opacity: 0, duration: 3.2 }, 0.2)
        .from('.si-brand', { opacity: 0, y: -10, duration: 0.9 }, 0.3)
        .from(split.words, { yPercent: 115, duration: 1.2, stagger: 0.09 }, 0.35)
        .from('.si-lede', { opacity: 0, y: 14, duration: 0.9 }, 0.8)
        .from('.auth-card', { opacity: 0, y: 44, scale: 0.96, duration: 1.2, clearProps: 'opacity,transform' }, 0.6)
        .from('.auth-card > *:not(.si-sheen)', { opacity: 0, y: 12, stagger: 0.05, duration: 0.7, clearProps: 'opacity,transform' }, 0.85)
        .from('.auth-foot', { opacity: 0, duration: 0.9 }, 1.3)
        // then the moon breathes
        .add(() => {
          gsap.to('.si-moon-lean', { scale: 1.012, duration: 5, ease: 'sine.inOut', yoyo: true, repeat: -1 });
          // (inward only: out past the moon's edge, its shadow would leave a dark gap)
          gsap.to('.mm-halo:not(.hot):not(.bad)', { scale: 0.965, duration: 4, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        });

      // the sky leans a little with the pointer (far things move less); a sheen follows it over the card
      if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
        const to = (sel: string, prop: string, duration: number) => gsap.quickTo(sel, prop, { duration, ease: 'power3.out' });
        const moonX = to('.si-moon-lean', 'x', 1.2);
        const moonY = to('.si-moon-lean', 'y', 1.2);
        const skyX = to('.si-sky', 'x', 1.8);
        const skyY = to('.si-sky', 'y', 1.8);
        const sheenX = to('.si-sheen', 'x', 0.5);
        const sheenY = to('.si-sheen', 'y', 0.5);
        const card = form.current!;
        const move = (e: PointerEvent) => {
          const x = e.clientX / innerWidth - 0.5;
          const y = e.clientY / innerHeight - 0.5;
          moonX(x * -26);
          moonY(y * -18);
          skyX(x * -10);
          skyY(y * -7);
          const r = card.getBoundingClientRect();
          sheenX(e.clientX - r.left - r.width / 2);
          sheenY(e.clientY - r.top - r.height / 2);
        };
        el.addEventListener('pointermove', move, { passive: true });
        return () => el.removeEventListener('pointermove', move);
      }
    }, el);
    return () => ctx.revert();
  }, []);

  // typing: the moon brightens and its halo grows with what has been filled in
  const lit = Math.min(1, (login.trim() ? 0.45 : 0) + (Math.min(password.length, 8) / 8) * 0.55);
  useEffect(() => {
    if (!root.current || !moon.current) return;
    const hot = root.current.querySelector('.mm-halo.hot');
    if (motionOK()) {
      gsap.to(moon.current.state, { glow: 0.5 + lit * 0.5, duration: 0.9, ease: 'power2.out', overwrite: 'auto' });
      gsap.to(hot, { opacity: lit * 0.85, duration: 0.9, ease: 'power2.out', overwrite: true });
    } else {
      moon.current.state.glow = 0.5 + lit * 0.5;
      gsap.set(hot, { opacity: lit * 0.85 });
    }
  }, [lit]);

  // the button narrows into a round loader, and opens back out
  const spinTween = useRef<gsap.core.Tween | null>(null);
  const toLoader = () => {
    const q = gsap.utils.selector(form.current!);
    const btn = q('.si-submit')[0];
    spinTween.current?.kill();
    const tl = gsap
      .timeline({ defaults: { ease: 'power3.inOut' } })
      .to(q('.si-btn-label'), { opacity: 0, scale: 0.8, duration: 0.18, ease: 'power2.in' })
      .to(btn, { width: 50, borderRadius: 25, duration: 0.42 }, 0.05)
      .to(q('.si-btn-spin'), { opacity: 1, scale: 1, duration: 0.25, ease: 'power2.out' }, 0.3);
    spinTween.current = gsap.to(q('.si-btn-spin'), { rotation: 360, duration: 0.8, repeat: -1, ease: 'none' });
    return tl;
  };
  const fromLoader = () => {
    const q = gsap.utils.selector(form.current!);
    const btn = q('.si-submit')[0];
    gsap
      .timeline({ defaults: { ease: 'power3.out' }, onComplete: () => void (spinTween.current?.kill(), gsap.set(btn, { clearProps: 'width,borderRadius' })) })
      .to(q('.si-btn-spin'), { opacity: 0, scale: 0.6, duration: 0.15, ease: 'power2.in' })
      .to(btn, { width: '100%', borderRadius: 14, duration: 0.45 }, 0.05)
      .to(q('.si-btn-label'), { opacity: 1, scale: 1, duration: 0.3 }, 0.25);
  };

  // signed in: a tick, the card lifts away, the moon surges (rings, sparks), its light blooms across the screen
  const celebrate = (root: HTMLElement, m: MoonHandle) => {
    const q = gsap.utils.selector(root);
    const card = form.current!;
    const btn = q('.si-submit')[0];
    const check = q('.si-btn-check path')[0] as unknown as SVGPathElement;
    const len = check.getTotalLength();
    const moonBox = q('.si-moon')[0].getBoundingClientRect();
    const cx = moonBox.left + moonBox.width / 2;
    const cy = moonBox.top + moonBox.height / 2;
    const R = moonBox.width / 2;
    // far enough to cover the screen from the moon's own centre
    const reach = Math.ceil(Math.max(Math.hypot(cx, cy), Math.hypot(innerWidth - cx, cy), Math.hypot(cx, innerHeight - cy), Math.hypot(innerWidth - cx, innerHeight - cy)));
    const dawn = q('.si-dawn')[0];

    // the moon stays its size. Rings go out from its edge, and sparks burst off it; both are made here and thrown away with the page
    const fx = document.createElement('div');
    fx.className = 'si-bloom';
    fx.style.cssText = `left:${cx}px;top:${cy}px`;
    const rings = [0, 1].map(() => {
      const r = document.createElement('i');
      r.className = 'si-ring';
      r.style.cssText = `width:${R * 2}px;height:${R * 2}px;margin:${-R}px 0 0 ${-R}px`;
      fx.appendChild(r);
      return r;
    });
    const sparks = Array.from({ length: 34 }, () => {
      const s = document.createElement('i');
      const size = 3 + Math.random() * 6;
      s.className = 'si-spark';
      s.style.cssText = `width:${size}px;height:${size}px;margin:${-size / 2}px 0 0 ${-size / 2}px`;
      fx.appendChild(s);
      return s;
    });
    root.appendChild(fx);
    const wave = `radial-gradient(circle at ${cx}px ${cy}px, transparent var(--a), #000 calc(var(--a) + 40px), #000 var(--b), transparent calc(var(--b) + 150px))`;
    dawn.style.setProperty('-webkit-mask-image', wave);
    dawn.style.setProperty('mask-image', wave);
    gsap.set(check, { strokeDasharray: len, strokeDashoffset: len });
    spinTween.current?.kill();
    return gsap
      .timeline()
      .to(q('.si-btn-spin'), { opacity: 0, scale: 0.5, duration: 0.15 })
      .set(q('.si-btn-check'), { opacity: 1, scale: 1 })
      .to(check, { strokeDashoffset: 0, duration: 0.4, ease: 'power2.out' })
      .to(btn, { scale: 1.1, duration: 0.16, yoyo: true, repeat: 1, ease: 'power2.out' }, '-=0.15')
      .to(q('.auth-card > *:not(.si-sheen):not(.si-submit)'), { opacity: 0, y: -8, stagger: 0.025, duration: 0.3, ease: 'power2.in' }, '-=0.1')
      .addLabel('go', '-=0.05')
      .to(card, { y: -40, scale: 0.94, opacity: 0, duration: 0.65, ease: 'power3.in' }, 'go')
      .to(q('.si-copy, .si-brand, .auth-foot'), { opacity: 0, y: -18, duration: 0.5, ease: 'power2.in' }, 'go')
      // the moon: a small lift, its light surges, and it spins up
      .to(q('.si-moon'), { y: -18, duration: 1.1, ease: 'power3.out' }, 'go')
      .to(m.state, { glow: 2.1, duration: 0.9, ease: 'power2.in' }, 'go')
      .add(() => m.spin(3.2), 'go')
      .to(q('.mm-halo.hot'), { opacity: 1, duration: 0.5 }, 'go')
      // shock rings from its edge, one after the other
      .fromTo(rings, { scale: 1, opacity: 0.85 }, { scale: 2.1, opacity: 0, duration: 1.3, stagger: 0.22, ease: 'power2.out' }, 'go+=0.1')
      // sparks burst outward from its edge, each its own way
      .add(() => {
        sparks.forEach((s, i) => {
          const a = (i / sparks.length) * Math.PI * 2 + Math.random() * 0.5;
          const from = R * (0.88 + Math.random() * 0.1);
          const to = from + 90 + Math.random() * 330;
          gsap.fromTo(
            s,
            { x: Math.cos(a) * from, y: Math.sin(a) * from, opacity: 1, scale: 0.4 },
            { x: Math.cos(a) * to, y: Math.sin(a) * to, opacity: 0, scale: 1, duration: 0.9 + Math.random() * 0.7, ease: 'power3.out' },
          );
        });
      }, 'go+=0.12')
      // the stars drift up and fade (no scaling of anything)
      .to(q('.si-sky'), { y: -40, opacity: 0, duration: 1.3, ease: 'power2.in' }, 'go')
      // the moon's light sweeps out from its rim as a wave (the moon stays in view until it has passed), then fills in over the moon
      .set(dawn, { opacity: 0, '--a': `${R * 0.92}px`, '--b': `${R * 0.92 + 30}px` }, 'go')
      .to(dawn, { opacity: 1, duration: 0.25, ease: 'power1.out' }, 'go+=0.45')
      .to(dawn, { '--b': `${reach + 260}px`, duration: 1.3, ease: 'power1.in' }, 'go+=0.45')
      .to(dawn, { '--a': '-60px', duration: 0.6, ease: 'power2.inOut' }, 'go+=1.2');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const fancy = motionOK() && !!root.current && !!moon.current;
    const loader = fancy ? toLoader() : null; // the next step waits for it, so a fast reply can't start on top of it
    try {
      const who = login.trim();
      const staffMember = isStaffId(who);
      const me = staffMember ? null : await signIn(who, password);
      if (staffMember) await staffSignIn(who.toLowerCase(), password);
      let bg = '';
      if (fancy) {
        await loader;
        await celebrate(root.current!, moon.current!);
        bg = getComputedStyle(root.current!.querySelector('.si-dawn')!).backgroundColor;
      }
      // on to the next page, which fades in from the moon's light
      if (staffMember) {
        if (bg) markArrival(bg);
        return location.assign(ADMIN_URL);
      }
      if (bg) arrive(bg);
      onIn(me!);
    } catch (err) {
      setBusy(false);
      setError(errText(err));
      if (fancy) {
        await loader;
        fromLoader();
        const q = gsap.utils.selector(root.current!);
        const m = moon.current!;
        gsap.fromTo(form.current, { x: 0 }, { keyframes: { x: [-10, 9, -6, 4, 0] }, duration: 0.45, ease: 'power1.out' });
        // the colour drains out of the moon, its halo flushes red, and it comes back
        m.spin(-2.4);
        gsap
          .timeline()
          .to(m.state, { sat: 0.08, glow: 0.3, duration: 0.3, ease: 'power2.out' })
          .to(m.state, { sat: 1, glow: 0.5 + lit * 0.5, duration: 1.3, ease: 'power2.inOut' }, 0.8);
        gsap
          .timeline()
          .to(q('.mm-halo.bad'), { opacity: 1, duration: 0.2, ease: 'power2.out' })
          .to(q('.mm-halo.bad'), { opacity: 0, duration: 1.2, ease: 'power2.inOut' }, 0.5);
      }
    }
  };

  // the label of the field you are in warms
  const warm = (on: boolean) => (e: React.FocusEvent<HTMLInputElement>) => {
    if (!motionOK()) return;
    const label = e.currentTarget.closest('.field')?.querySelector(':scope > span');
    if (label) gsap.to(label, { x: on ? 4 : 0, color: on ? '#ffd2a3' : 'rgba(255,255,255,0.74)', duration: 0.35, ease: 'power3.out' });
  };

  return (
    <div className="auth si" ref={root}>
      <div className="si-sky" aria-hidden>
        <Stars density={8200} />
        <span className="si-glow g1" />
      </div>
      <div className="si-moon" aria-hidden>
        <div className="si-moon-lean">
          <MineralMoon ref={moon} />
        </div>
      </div>
      <span className="si-dawn" aria-hidden />

      <header className="si-brand">
        <img src="/favicon.png" alt="" width={28} height={28} draggable={false} />
        <span>Moon Library</span>
      </header>

      <main className="si-main">
        <div className="si-copy">
          <h1 className="si-title">{hello}</h1>
          <p className="si-lede">Your images, videos and design files are waiting.</p>
        </div>
        <form className="auth-card" ref={form} onSubmit={submit}>
          <i className="si-sheen" aria-hidden />
          <h2>Sign in</h2>
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
              onFocus={warm(true)}
              onBlur={warm(false)}
              placeholder="you@company.com"
            />
          </label>
          <label className="field">
            <span>Password</span>
            <span className="pw-wrap">
              <input className="input" type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} onFocus={warm(true)} onBlur={warm(false)} />
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
          <button type="submit" className="si-submit" disabled={busy || !login.trim() || !password}>
            <span className="si-btn-label">
              Sign in
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
            <span className="si-btn-spin" aria-hidden />
            <svg className="si-btn-check" viewBox="0 0 24 24" aria-hidden>
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </button>
          <p className="auth-help">Forgot your password? Clients, ask your contact at the studio; team members, ask an Owner.</p>
        </form>
      </main>
      <p className="auth-foot">Moon Library</p>
    </div>
  );
}
