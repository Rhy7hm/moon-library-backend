/*
 * Breaks an element like a pane of glass: it splits into triangular shards (copies of the element,
 * each clipped to one triangle of a jittered grid, so they fit together exactly), the cracks open for
 * a moment, then the shards fly apart from the impact point, spin, fall and fade — while the space the
 * element took closes up. Resolves when it's all gone, so the caller can then remove it for real.
 *
 *   await shatter(rowEl)            // the row is left collapsed and invisible
 */
import { gsap, motionOK } from './motion';

type Opts = { cols?: number; rows?: number; impact?: { x: number; y: number } };

export async function shatter(el: HTMLElement, opts: Opts = {}): Promise<void> {
  if (!motionOK()) {
    await gsap.to(el, { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, duration: 0.2 });
    return;
  }
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const cols = opts.cols ?? Math.max(4, Math.round(r.width / 90));
  const rows = opts.rows ?? Math.max(2, Math.round(r.height / 40));
  // where it "breaks" from, as a fraction of the box (the middle by default)
  const ix = (opts.impact?.x ?? 0.5) * r.width;
  const iy = (opts.impact?.y ?? 0.5) * r.height;

  // a grid of points, the inner ones nudged about, so the triangles look like broken glass
  const pts: { x: number; y: number }[][] = [];
  for (let j = 0; j <= rows; j++) {
    pts[j] = [];
    for (let i = 0; i <= cols; i++) {
      const edgeX = i === 0 || i === cols;
      const edgeY = j === 0 || j === rows;
      pts[j][i] = {
        x: (i / cols) * r.width + (edgeX ? 0 : (Math.random() - 0.5) * (r.width / cols) * 0.7),
        y: (j / rows) * r.height + (edgeY ? 0 : (Math.random() - 0.5) * (r.height / rows) * 0.7),
      };
    }
  }
  const tris: { x: number; y: number }[][] = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = pts[j][i], b = pts[j][i + 1], c = pts[j + 1][i + 1], d = pts[j + 1][i];
      // alternate the diagonal so it doesn't look like a tidy grid
      if ((i + j) % 2) tris.push([a, b, c], [a, c, d]);
      else tris.push([a, b, d], [b, c, d]);
    }

  // the shards live on the page's top layer, exactly over the element
  const layer = document.createElement('div');
  layer.className = 'shatter-layer';
  Object.assign(layer.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  const bg = getComputedStyle(el).backgroundColor;
  const shards = tris.map((t) => {
    const s = document.createElement('div');
    s.className = 'shatter-shard';
    const copy = el.cloneNode(true) as HTMLElement;
    copy.removeAttribute('id');
    Object.assign(copy.style, { width: `${r.width}px`, height: `${r.height}px`, margin: '0', background: bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : 'var(--surface)' });
    s.appendChild(copy);
    s.style.clipPath = `polygon(${t.map((p) => `${p.x}px ${p.y}px`).join(',')})`;
    const cx = (t[0].x + t[1].x + t[2].x) / 3;
    const cy = (t[0].y + t[1].y + t[2].y) / 3;
    s.style.transformOrigin = `${cx}px ${cy}px`;
    layer.appendChild(s);
    return { s, cx, cy, d: Math.hypot(cx - ix, cy - iy) };
  });
  document.body.appendChild(layer);
  el.style.visibility = 'hidden';
  el.style.overflow = 'hidden';

  const far = Math.max(...shards.map((x) => x.d)) || 1;
  const tl = gsap.timeline();
  // 1. it cracks: every shard shifts a hair away from the impact, opening thin gaps
  tl.to(
    shards.map((x) => x.s),
    {
      x: (i) => ((shards[i].cx - ix) / far) * 4,
      y: (i) => ((shards[i].cy - iy) / far) * 3,
      duration: 0.12,
      ease: 'power2.out',
    },
  );
  // 2. it breaks: shards near the impact go first, fly outwards, tumble, drop and fade
  tl.to(
    shards.map((x) => x.s),
    {
      x: (i) => ((shards[i].cx - ix) / far) * (60 + Math.random() * 80) + (Math.random() - 0.5) * 30,
      y: (i) => ((shards[i].cy - iy) / far) * 30 + 60 + Math.random() * 120,
      rotation: () => (Math.random() - 0.5) * 140,
      rotationX: () => (Math.random() - 0.5) * 120,
      rotationY: () => (Math.random() - 0.5) * 120,
      scale: () => 0.5 + Math.random() * 0.35,
      opacity: 0,
      duration: 0.85,
      ease: 'power2.in',
      stagger: (i) => (shards[i].d / far) * 0.18,
    },
    0.16,
  );
  // 3. the gap closes behind it
  tl.to(el, { height: 0, paddingTop: 0, paddingBottom: 0, marginTop: 0, marginBottom: 0, borderWidth: 0, duration: 0.4, ease: 'power3.inOut' }, 0.45);
  await tl;
  layer.remove();
}
