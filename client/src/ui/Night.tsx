/* The night sky pieces shared by the sign-in page and the library banner: twinkling stars and a turning moon. */
import { useEffect, useMemo, useRef } from 'react';
import { motionOK } from '../motion';

/*
 * A seamless (wraps left to right) moon surface, drawn once: blotchy grey highlands, soft dark seas,
 * craters in every size (many small, a few large) with faint lit and shadowed rims, and fine grain.
 * Big enough (2048 px) to stay crisp when the moon fills the screen.
 */
let mapCache = '';
function moonMap(): string {
  if (mapCache) return mapCache;
  const W = 2048;
  const H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // draw at x, and again one width over, so the edges meet
  const wrap = (x: number, r: number, fn: (x: number) => void) => {
    fn(x);
    if (x - r < 0) fn(x + W);
    if (x + r > W) fn(x - W);
  };
  const blob = (x: number, y: number, r: number, rgb: string, a: number) =>
    wrap(x, r, (cx) => {
      const grd = g.createRadialGradient(cx, y, 0, cx, y, r);
      grd.addColorStop(0, `rgba(${rgb},${a})`);
      grd.addColorStop(0.6, `rgba(${rgb},${a * 0.55})`);
      grd.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = grd;
      g.beginPath();
      g.arc(cx, y, r, 0, Math.PI * 2);
      g.fill();
    });

  g.fillStyle = '#d9d3c4';
  g.fillRect(0, 0, W, H);
  // highlands: lots of faint light and dark patches
  for (let i = 0; i < 260; i++) blob(rnd() * W, rnd() * H, 30 + rnd() * 140, rnd() < 0.5 ? '255,250,238' : '120,112,98', 0.08 + rnd() * 0.08);
  // seas: big soft dark areas, clustered in the middle band, built from overlapping blobs
  for (let s = 0; s < 9; s++) {
    const cx = rnd() * W;
    const cy = H * 0.25 + rnd() * H * 0.5;
    for (let k = 0; k < 7; k++) blob(cx + (rnd() - 0.5) * 260, cy + (rnd() - 0.5) * 180, 60 + rnd() * 170, '78,76,74', 0.26 + rnd() * 0.16);
  }
  // craters: soft bowl, a light rim towards the lower right and a shadow towards the upper left
  const crater = (r: number, strength: number) => {
    const x = rnd() * W;
    const y = r + rnd() * (H - 2 * r);
    wrap(x, r * 1.4, (cx) => {
      const bowl = g.createRadialGradient(cx, y, r * 0.1, cx, y, r);
      bowl.addColorStop(0, `rgba(80,74,64,${0.22 * strength})`);
      bowl.addColorStop(0.8, `rgba(80,74,64,${0.12 * strength})`);
      bowl.addColorStop(1, 'rgba(80,74,64,0)');
      g.fillStyle = bowl;
      g.beginPath();
      g.arc(cx, y, r, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = Math.max(0.8, r * 0.12);
      g.strokeStyle = `rgba(255,252,242,${0.32 * strength})`;
      g.beginPath();
      g.arc(cx, y, r, Math.PI * -0.15, Math.PI * 0.85);
      g.stroke();
      g.strokeStyle = `rgba(60,55,48,${0.28 * strength})`;
      g.beginPath();
      g.arc(cx, y, r * 0.92, Math.PI * 0.85, Math.PI * 1.85);
      g.stroke();
      if (r > 22) {
        // big ones get a faint bright skirt of thrown-out dust, and a central peak
        const skirt = g.createRadialGradient(cx, y, r, cx, y, r * 1.45);
        skirt.addColorStop(0, `rgba(250,246,236,${0.12 * strength})`);
        skirt.addColorStop(1, 'rgba(250,246,236,0)');
        g.fillStyle = skirt;
        g.beginPath();
        g.arc(cx, y, r * 1.45, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = `rgba(255,252,242,${0.25 * strength})`;
        g.beginPath();
        g.arc(cx + r * 0.05, y + r * 0.05, r * 0.09, 0, Math.PI * 2);
        g.fill();
      }
    });
  };
  for (let i = 0; i < 14; i++) crater(28 + rnd() * 46, 0.9);
  for (let i = 0; i < 170; i++) crater(8 + rnd() * 20, 0.75 + rnd() * 0.3);
  for (let i = 0; i < 1600; i++) crater(1.2 + Math.pow(rnd(), 2) * 7, 0.5 + rnd() * 0.5);
  // fine grain
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 14;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return (mapCache = c.toDataURL('image/jpeg', 0.86));
}

/** Twinkling stars filling the parent; they only draw while on screen. */
export function Stars({ density = 5200 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    let raf = 0;
    let seen = true;
    let stars: { x: number; y: number; r: number; p: number; s: number }[] = [];
    const size = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      c.width = c.clientWidth * dpr;
      c.height = c.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round((c.clientWidth * c.clientHeight) / density);
      stars = Array.from({ length: n }, () => ({ x: Math.random() * c.clientWidth, y: Math.random() * c.clientHeight, r: Math.random() * 1.2 + 0.2, p: Math.random() * Math.PI * 2, s: 0.4 + Math.random() * 1.4 }));
    };
    const still = !motionOK();
    const draw = (t: number) => {
      if (seen) {
        ctx.clearRect(0, 0, c.clientWidth, c.clientHeight);
        for (const s of stars) {
          ctx.globalAlpha = still ? 0.7 : 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(s.p + (t / 1000) * s.s));
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (!still) raf = requestAnimationFrame(draw);
    };
    const io = new IntersectionObserver(([e]) => (seen = e.isIntersecting));
    io.observe(c);
    size();
    raf = requestAnimationFrame(draw);
    addEventListener('resize', size);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      removeEventListener('resize', size);
    };
  }, [density]);
  return <canvas className="stars" ref={ref} aria-hidden />;
}

/**
 * The moon: a crater map sliding inside a shaded ball (so it reads as a turning sphere) with a ring
 * orbiting it. Size it with --d; spin it by tweening `.moon-map` xPercent to -50 and `.moon-orbit` rotationZ.
 */
export function Moon({ className = '' }: { className?: string }) {
  const map = useMemo(moonMap, []);
  return (
    <div className={`moon3d ${className}`} aria-hidden>
      <div className="moon-orbit back"><i /></div>
      <div className="moon-ball">
        <div className="moon-map" style={{ backgroundImage: `url(${map})` }} />
        <div className="moon-shade" />
      </div>
      <div className="moon-orbit front"><i /></div>
    </div>
  );
}
