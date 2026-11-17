/*
 * The sign-in page's moon: a full, glowing moon in the style of the "mineral moon" photographs —
 * silver highlands with soft patches of blue, orange and rose, bright ray craters, a bright limb and a
 * warm halo. Painted, not photographed: the surface is drawn once (below) and wrapped round a sphere
 * by a small WebGL shader, so the turning costs the GPU almost nothing.
 *
 * Pointer: the moon turns faster and lifts a little when hovered, flicking across it spins it the way
 * you move, and a soft light follows the pointer that brightens and deepens the colours under it.
 * Sign-in code drives the rest through the handle's `state` (sat = colour, glow = brightness) and the
 * three halo layers (.mm-halo, .hot, .bad), with GSAP.
 * With "reduce motion" it is drawn once and stays still. Without WebGL it falls back to a still disc.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { gsap, motionOK } from '../motion';

export type MoonHandle = {
  /** a push on the spin (radians per second; negative = the other way) */
  spin: (v: number) => void;
  /** live values the shader reads each frame: tween them with GSAP. sat: 0 grey … 1 full colour; glow: brightness */
  state: { sat: number; glow: number };
};

const W = 2048;
const H = 1024;

/** The moon's surface, as a wrapping (left edge meets right edge) picture. Same moon every time. */
function surface(): HTMLCanvasElement {
  let seed = 21;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // draw at x, and again one width over if it crosses an edge, so the seam doesn't show
  const wrap = (x: number, r: number, fn: (x: number) => void) => {
    fn(x);
    if (x - r < 0) fn(x + W);
    if (x + r > W) fn(x - W);
  };
  const blob = (x: number, y: number, r: number, rgb: string, a: number) =>
    wrap(x, r, (cx) => {
      const gr = g.createRadialGradient(cx, y, 0, cx, y, r);
      gr.addColorStop(0, `rgba(${rgb},${a})`);
      gr.addColorStop(0.55, `rgba(${rgb},${a * 0.6})`);
      gr.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = gr;
      g.beginPath();
      g.arc(cx, y, r, 0, Math.PI * 2);
      g.fill();
    });

  // silver ground, mottled
  g.fillStyle = '#e6e2da';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 340; i++) blob(rnd() * W, rnd() * H, 24 + rnd() * 150, rnd() < 0.5 ? '255,253,248' : '150,146,140', 0.05 + rnd() * 0.09);

  // the mineral colours: clusters of soft patches in the middle band, a grey basalt under each so they read as stains in the rock
  const palette = ['62,108,214', '62,108,214', '70,120,224', '236,132,58', '236,132,58', '226,100,70', '196,92,140', '140,96,196', '58,160,172', '232,190,84'];
  for (let s = 0; s < 15; s++) {
    const cx = rnd() * W;
    const cy = H * 0.22 + rnd() * H * 0.56;
    const base = palette[Math.floor(rnd() * palette.length)];
    const n = 7 + Math.floor(rnd() * 8);
    for (let k = 0; k < n; k++) {
      const x = cx + (rnd() - 0.5) * 300;
      const y = cy + (rnd() - 0.5) * 190;
      const r = 50 + rnd() * 140;
      blob(x, y, r * 1.05, '70,68,80', 0.14 + rnd() * 0.1);
      blob(x, y, r, rnd() < 0.72 ? base : palette[Math.floor(rnd() * palette.length)], 0.42 + rnd() * 0.3);
    }
  }

  for (let i = 0; i < 1400; i++) blob(rnd() * W, rnd() * H, 5 + rnd() * 30, rnd() < 0.5 ? '255,255,255' : '90,86,96', 0.05 + rnd() * 0.08);

  // craters: a shadowed bowl and a bright rim on the lit side; big ones get a bright skirt
  const crater = (r: number, strength: number) => {
    const x = rnd() * W;
    const y = r + rnd() * (H - 2 * r);
    wrap(x, r * 1.5, (cx) => {
      const bowl = g.createRadialGradient(cx, y, r * 0.15, cx, y, r);
      bowl.addColorStop(0, `rgba(70,66,74,${0.2 * strength})`);
      bowl.addColorStop(0.85, `rgba(70,66,74,${0.1 * strength})`);
      bowl.addColorStop(1, 'rgba(70,66,74,0)');
      g.fillStyle = bowl;
      g.beginPath();
      g.arc(cx, y, r, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = Math.max(0.7, r * 0.08);
      g.strokeStyle = `rgba(255,255,255,${0.4 * strength})`;
      g.beginPath();
      g.arc(cx, y, r, Math.PI * -0.15, Math.PI * 0.85);
      g.stroke();
      g.strokeStyle = `rgba(50,46,56,${0.18 * strength})`;
      g.beginPath();
      g.arc(cx, y, r * 0.92, Math.PI * 0.85, Math.PI * 1.85);
      g.stroke();
      if (r > 20) {
        const skirt = g.createRadialGradient(cx, y, r, cx, y, r * 1.5);
        skirt.addColorStop(0, `rgba(255,255,255,${0.16 * strength})`);
        skirt.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = skirt;
        g.beginPath();
        g.arc(cx, y, r * 1.5, 0, Math.PI * 2);
        g.fill();
      }
    });
  };
  for (let i = 0; i < 14; i++) crater(28 + rnd() * 46, 0.5);
  for (let i = 0; i < 230; i++) crater(6 + rnd() * 20, 0.55 + rnd() * 0.3);
  for (let i = 0; i < 2600; i++) crater(1 + Math.pow(rnd(), 2.2) * 6, 0.5 + rnd() * 0.5);

  // a few young craters with bright rays thrown across the surface (like Tycho)
  for (let i = 0; i < 4; i++) {
    const x = rnd() * W;
    const y = H * 0.25 + rnd() * H * 0.5;
    blob(x, y, 70, '255,255,255', 0.5);
    for (let k = 0; k < 34; k++) {
      const ang = rnd() * Math.PI * 2;
      const len = 90 + rnd() * 330;
      wrap(x, len, (cx) => {
        const gr = g.createLinearGradient(cx, y, cx + Math.cos(ang) * len, y + Math.sin(ang) * len);
        gr.addColorStop(0, `rgba(255,255,255,${0.1 + rnd() * 0.1})`);
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.strokeStyle = gr;
        g.lineWidth = 0.7 + rnd() * 2;
        g.beginPath();
        g.moveTo(cx + Math.cos(ang) * 14, y + Math.sin(ang) * 14);
        g.lineTo(cx + Math.cos(ang) * len, y + Math.sin(ang) * len);
        g.stroke();
      });
    }
  }

  // fine grain
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 16;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return c;
}

const VERT = `attribute vec2 a; varying vec2 vP; void main(){ vP = a; gl_Position = vec4(a, 0.0, 1.0); }`;
const FRAG = `
precision highp float;
varying vec2 vP;
uniform sampler2D uTex;
uniform float uPx;      // the canvas size in pixels (for a soft edge)
uniform float uRot;     // turn, radians
uniform float uTilt;    // lean toward the viewer, radians
uniform float uSat;     // 0 grey … 1 full colour
uniform float uGlow;    // brightness
uniform vec2 uPtr;      // the pointer, on the moon's face (-1…1, y up)
uniform float uSpot;    // 0…1: how much the pointer's light is on
void main() {
  vec2 p = vP;
  float r = length(p);
  float edge = clamp((1.0 - r) * uPx * 0.5, 0.0, 1.0);
  if (edge <= 0.0) discard;
  float z = sqrt(max(0.0, 1.0 - r * r));
  vec3 n = vec3(p, z);
  float ct = cos(uTilt), st = sin(uTilt);
  vec3 m = vec3(n.x, n.y * ct - n.z * st, n.y * st + n.z * ct);
  float cr = cos(uRot), sr = sin(uRot);
  vec3 q = vec3(m.x * cr + m.z * sr, m.y, -m.x * sr + m.z * cr);
  vec2 uv = vec2(atan(q.x, q.z) / 6.2831853 + 0.5, 0.5 - asin(clamp(q.y, -1.0, 1.0)) / 3.1415927);
  vec3 col = texture2D(uTex, uv).rgb;
  // the pointer's light: brighter and deeper in colour where it is
  float spot = exp(-dot(p - uPtr, p - uPtr) * 5.5) * uSpot;
  float sat = uSat * (1.0 + spot * 0.7);
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, sat) * (1.0 + spot * 0.28);
  // a full moon is nearly flat-lit; a touch of roundness, and a bright limb
  col *= 0.8 + 0.2 * z;
  col += vec3(1.0, 0.93, 0.82) * pow(1.0 - z, 3.2) * 0.34;
  col *= 0.9 + 0.22 * uGlow;
  col = pow(clamp(col, 0.0, 1.6), vec3(0.96));
  gl_FragColor = vec4(min(col, vec3(1.0)) * edge, edge);
}`;

export const MineralMoon = forwardRef<MoonHandle, { className?: string }>(function MineralMoon({ className = '' }, handle) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const run = useRef({ sat: 1, glow: 0.5, push: 0 });
  useImperativeHandle(handle, () => ({ spin: (v) => void (run.current.push += v), state: run.current }), []);

  useEffect(() => {
    const el = box.current!;
    const c = canvas.current!;
    const stage = el.closest<HTMLElement>('.si') ?? el.parentElement!;
    const still = !motionOK();
    const st = run.current;
    let dead = false;
    let raf = 0;
    let boot = 0;
    let rot = 0.9;
    let speed = 0.045;
    let over = false;
    let spot = 0;
    let spotTo = 0;
    let ptrX = 0;
    let ptrY = 0;
    let lastX = 0;
    let last = 0;
    let render: () => void = () => {};
    let resize: () => void = () => {};

    const lift = still ? null : gsap.quickTo(el, 'y', { duration: 0.9, ease: 'power3.out' });
    const grow = still ? null : gsap.quickTo(el, 'scale', { duration: 0.9, ease: 'power3.out' });

    const start = () => {
      if (dead) return;
      const tex = surface();
      const gl = c.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false }) as WebGLRenderingContext | null;
      if (!gl) {
        // no WebGL: the middle of the surface as a still disc
        const ctx = c.getContext('2d')!;
        render = () => {
          const s = c.width;
          ctx.clearRect(0, 0, s, s);
          ctx.save();
          ctx.beginPath();
          ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(tex, W * 0.2, 0, W * 0.5, H, 0, 0, s, s);
          const sh = ctx.createRadialGradient(s / 2, s / 2, s * 0.34, s / 2, s / 2, s / 2);
          sh.addColorStop(0, 'rgba(0,0,0,0)');
          sh.addColorStop(1, 'rgba(255,240,220,0.25)');
          ctx.fillStyle = sh;
          ctx.fillRect(0, 0, s, s);
          ctx.restore();
        };
        resize = () => {
          const s = Math.round(el.clientWidth * Math.min(2, devicePixelRatio || 1));
          if (c.width !== s) (c.width = c.height = s), render();
        };
        resize();
        render();
        el.classList.add('ready');
        gsap.to(c, { opacity: 1, duration: motionOK() ? 1.4 : 0, ease: 'power2.out' });
        return;
      }
      const sh = (type: number, src: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
      };
      // everything the GPU holds; built again if the browser takes the graphics context away (a GPU reset, a busy tab)
      const build = () => {
        const prog = gl.createProgram()!;
        gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
        gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
        gl.linkProgram(prog);
        gl.useProgram(prog);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'a');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const u = (n: string) => gl.getUniformLocation(prog, n);
        const U = { px: u('uPx'), rot: u('uRot'), tilt: u('uTilt'), sat: u('uSat'), glow: u('uGlow'), ptr: u('uPtr'), spot: u('uSpot') };
        gl.uniform1i(u('uTex'), 0);
        gl.uniform1f(U.tilt, 0.38);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        const fit = () => {
          const s = Math.max(2, Math.round(el.clientWidth * Math.min(2, devicePixelRatio || 1)));
          if (c.width !== s) {
            c.width = c.height = s;
            gl.viewport(0, 0, s, s);
          }
          gl.uniform1f(U.px, s);
        };
        resize = () => {
          fit();
          if (still) render();
        };
        render = () => {
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.uniform1f(U.rot, rot);
          gl.uniform1f(U.sat, st.sat);
          gl.uniform1f(U.glow, st.glow);
          gl.uniform2f(U.ptr, ptrX, ptrY);
          gl.uniform1f(U.spot, spot);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        };
        fit();
        render();
      };
      build();
      el.classList.add('ready');
      gsap.to(c, { opacity: 1, duration: motionOK() ? 1.4 : 0, ease: 'power2.out' });
      c.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        cancelAnimationFrame(raf);
      });
      c.addEventListener('webglcontextrestored', () => {
        build();
        last = 0;
        if (!still) raf = requestAnimationFrame(frame);
      });
      if (!still) raf = requestAnimationFrame(frame);
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      // the turn eases toward its resting (or hovering) speed; a push fades away on its own
      speed += ((over ? 0.16 : 0.045) - speed) * Math.min(1, dt * 2.2);
      rot += (speed + st.push) * dt;
      st.push *= Math.pow(0.08, dt);
      spot += (spotTo - spot) * Math.min(1, dt * 5);
      render();
      raf = requestAnimationFrame(frame);
    };

    const move = (e: PointerEvent) => {
      if (still || e.pointerType !== 'mouse') return;
      const b = el.getBoundingClientRect();
      const nx = ((e.clientX - b.left) / b.width) * 2 - 1;
      const ny = 1 - ((e.clientY - b.top) / b.height) * 2;
      const onCard = !!(e.target as Element).closest?.('.auth-card');
      const d = Math.hypot(nx, ny);
      ptrX = nx;
      ptrY = ny;
      spotTo = !onCard && d < 1.4 ? 1 : 0;
      const inside = d < 1 && !onCard;
      if (inside !== over) {
        over = inside;
        el.classList.toggle('over', over);
        lift!(over ? -8 : 0);
        grow!(over ? 1.02 : 1);
      }
      if (inside) st.push += Math.max(-0.5, Math.min(0.5, (e.clientX - lastX) * 0.01)); // spin it the way the pointer moves
      lastX = e.clientX;
    };
    const leave = () => {
      spotTo = 0;
      if (!over) return;
      over = false;
      el.classList.remove('over');
      lift?.(0);
      grow?.(1);
    };

    boot = window.setTimeout(start, 30); // let the page paint first; painting the surface takes a moment
    const ro = new ResizeObserver(() => {
      resize();
      if (still) render();
    });
    ro.observe(el);
    stage.addEventListener('pointermove', move, { passive: true });
    stage.addEventListener('pointerleave', leave);
    return () => {
      dead = true;
      clearTimeout(boot);
      cancelAnimationFrame(raf);
      ro.disconnect();
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerleave', leave);
      gsap.killTweensOf(el);
    };
  }, []);

  return (
    <div className={`mm ${className}`} ref={box} aria-hidden>
      <span className="mm-halo" />
      <span className="mm-halo hot" />
      <span className="mm-halo bad" />
      <canvas ref={canvas} />
    </div>
  );
});
