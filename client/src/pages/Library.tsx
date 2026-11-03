/*
 * Home: a night-sky banner with the turning moon and a hello, the newest work in a sideways rail, the
 * collections as stacks of prints that fan out, everything in a masonry wall (cards rise in as you
 * scroll), and shared links. Filter chips and search narrow it down.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Collection, FileInfo, Item, Library as Lib } from '../api';
import { ext, fmtAgo, fmtDuration, greeting, host } from '../format';
import { gsap, motionOK, revealOnScroll, ScrollTrigger, SplitText } from '../motion';
import { entriesOf, useStore } from '../store';
import { IArrowUR, IChevL, IChevR, IDoc, IFolder, IGrid, IImage, ILink, IPlay, ISearch, IUpload, IVideo, IX } from '../ui/icons';
import { Moon, Stars } from '../ui/Night';
import { initials } from '../ui/Shell';
import { canShow, extColor, Thumb, Tile } from '../ui/Tile';

export type Filter = 'all' | 'image' | 'video' | 'document';
const FILTERS: { value: Filter; label: string; icon: React.ReactNode }[] = [
  { value: 'all', label: 'All', icon: <IGrid /> },
  { value: 'image', label: 'Images', icon: <IImage /> },
  { value: 'video', label: 'Videos', icon: <IVideo /> },
  { value: 'document', label: 'Documents', icon: <IDoc /> },
];
const matches = (f: FileInfo, filter: Filter) => filter === 'all' || (filter === 'document' ? f.kind !== 'image' && f.kind !== 'video' : f.kind === filter);

/** Items in a collection and everything under it. */
export function itemsUnder(lib: Lib, id: string): Item[] {
  const ids = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of lib.collections) if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) (ids.add(c.id), (grew = true));
  }
  return lib.items.filter((i) => i.collectionId && ids.has(i.collectionId));
}

export function filterItems(items: Item[], filter: Filter, q: string) {
  const needle = q.trim().toLowerCase();
  return items
    .map((i) => ({ ...i, files: i.files.filter((f) => matches(f, filter) && (!needle || i.title.toLowerCase().includes(needle) || f.name.toLowerCase().includes(needle))) }))
    .filter((i) => i.files.length);
}

/**
 * Switching filter travels sideways, like paging between tabs: moving right, the results slide out to
 * the left and the new ones come in from the right (and the other way round). The tiles then stagger
 * in through the masonry's own reveal. Wrap the results in `box` and hand `change` to the toolbar.
 */
export function useFilterSwap(filter: Filter, setFilter: (f: Filter) => void) {
  const box = useRef<HTMLDivElement>(null);
  const dir = useRef(0);
  const order = (f: Filter) => FILTERS.findIndex((x) => x.value === f);
  const change = (f: Filter) => {
    if (!motionOK() || !box.current) return setFilter(f);
    const d = Math.sign(order(f) - order(filter)) || 1;
    gsap.to(box.current, {
      opacity: 0, x: -d * 60, filter: 'blur(4px)', duration: 0.22, ease: 'power2.in', overwrite: true,
      onComplete: () => {
        dir.current = d;
        setFilter(f);
      },
    });
  };
  // after the render that applied the new filter
  useLayoutEffect(() => {
    const d = dir.current;
    if (!d || !box.current) return;
    dir.current = 0;
    gsap.fromTo(box.current, { opacity: 0, x: d * 80, filter: 'blur(4px)' }, { opacity: 1, x: 0, filter: 'blur(0px)', duration: 0.6, ease: 'expo.out', overwrite: true, clearProps: 'opacity,transform,filter' });
    requestAnimationFrame(() => ScrollTrigger.refresh());
  });
  return { box, change };
}

/** How many files each filter would show for the current search. */
function countBy(items: Item[], q: string) {
  const out = {} as Record<Filter, number>;
  for (const f of FILTERS) out[f.value] = filterItems(items, f.value, q).reduce((n, i) => n + i.files.length, 0);
  return out;
}

/**
 * Filter chips and a search box. The orange pill glides to the chip you pick like Apple's segmented
 * controls: it carries a dark copy of the labels inside it, kept in place as it moves, so each label
 * lights up as the pill travels over it. The search's placeholder cycles through the client's own
 * titles; "/" jumps to it, Esc clears it.
 */
export function Toolbar({ filter, setFilter, q, setQ, items }: { filter: Filter; setFilter: (f: Filter) => void; q: string; setQ: (q: string) => void; items: Item[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const lit = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const icon = useRef<HTMLSpanElement>(null);
  const word = useRef<HTMLSpanElement>(null);
  const move = useRef<gsap.core.Timeline | null>(null);
  const first = useRef(true);
  const [focus, setFocus] = useState(false);
  // the pill moves on click, even while the results are still swapping
  const [active, setActive] = useState(filter);
  useEffect(() => setActive(filter), [filter]);
  const pick = (f: Filter) => {
    if (f === active) return;
    setActive(f);
    setFilter(f);
  };
  const counts = useMemo(() => countBy(items, q), [items, q]);
  const hints = useMemo(() => {
    const titles = [...new Set(items.map((i) => i.title.trim()).filter((t) => t && t.length <= 24))];
    const pick = titles.sort(() => Math.random() - 0.5).slice(0, 5).map((t) => `“${t}”`);
    return pick.length > 1 ? pick : ['your files'];
  }, [items]);

  // the pill glides to the chosen chip; the labels inside it stay put, so they light up as it passes
  useLayoutEffect(() => {
    const follow = () => lit.current && gsap.set(lit.current, { x: -(gsap.getProperty(pill.current!, 'x') as number) });
    const place = (animate: boolean) => {
      const el = wrap.current?.querySelector<HTMLElement>(`button[data-v="${active}"]`);
      const p = pill.current;
      if (!el || !p) return;
      const to = { x: el.offsetLeft, width: el.offsetWidth };
      move.current?.kill();
      if (!animate || !motionOK()) {
        gsap.set(p, to);
        return void follow();
      }
      const from = gsap.getProperty(p, 'x') as number;
      const far = Math.abs(to.x - from) / Math.max(1, el.offsetWidth); // chips travelled
      move.current = gsap
        .timeline({ onUpdate: follow })
        .to(p, { ...to, duration: 0.42 + Math.min(far, 3) * 0.06, ease: 'power3.inOut' });
      const ic = lit.current?.querySelector(`[data-v="${active}"] svg`);
      if (ic) gsap.fromTo(ic, { scale: 0.6, rotation: -20 }, { scale: 1, rotation: 0, duration: 0.7, ease: 'elastic.out(1.2, 0.5)', delay: 0.25 });
    };
    // on first show, line up again once web fonts have loaded (they can change chip widths); only
    // then, since this resolves at once later on and would cancel the glide
    if (first.current) document.fonts?.ready.then(() => place(false));
    place(!first.current);
    first.current = false;
    const onResize = () => place(false);
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, [active]);

  // the placeholder's word rolls to the next suggestion every few seconds
  useEffect(() => {
    const el = word.current;
    if (!el || q || hints.length < 2 || !motionOK()) return;
    let i = 0;
    const id = setInterval(() => {
      gsap.to(el, {
        yPercent: -110, opacity: 0, filter: 'blur(4px)', duration: 0.3, ease: 'power2.in',
        onComplete: () => {
          i = (i + 1) % hints.length;
          el.textContent = hints[i];
          gsap.fromTo(el, { yPercent: 110, opacity: 0, filter: 'blur(4px)' }, { yPercent: 0, opacity: 1, filter: 'blur(0px)', duration: 0.55, ease: 'expo.out' });
        },
      });
    }, 2800);
    return () => {
      clearInterval(id);
      gsap.killTweensOf(el);
    };
  }, [q, hints]);

  // the magnifier gives a little bounce as you type
  useEffect(() => {
    if (q && motionOK()) gsap.fromTo(icon.current, { scale: 1.3 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1.4, 0.4)' });
  }, [q]);

  // "/" anywhere jumps to the search
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== '/' || e.metaKey || e.ctrlKey || t?.closest?.('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      input.current?.focus();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);

  return (
    <div className={`toolbar${focus ? ' is-searching' : ''}`}>
      <div className="chips" ref={wrap} role="radiogroup" aria-label="Show">
        <span className="chip-pill" ref={pill} aria-hidden>
          <span className="chip-lit" ref={lit}>
            {FILTERS.map((f) => (
              <span key={f.value} data-v={f.value} className={`chip${active === f.value ? ' on' : ''}`}>
                {f.icon}
                <span>{f.label}</span>
                <span className="chip-n">{counts[f.value]}</span>
              </span>
            ))}
          </span>
        </span>
        {FILTERS.map((f) => (
          <button
            key={f.value}
            data-v={f.value}
            role="radio"
            aria-checked={active === f.value}
            className={`chip${active === f.value ? ' on' : ''}${counts[f.value] ? '' : ' none'}`}
            onClick={() => pick(f.value)}
          >
            {f.icon}
            <span>{f.label}</span>
            <span className="chip-n">{counts[f.value]}</span>
          </button>
        ))}
      </div>
      <label className={`search${q ? ' has-q' : ''}`}>
        <span className="search-ic" ref={icon}>
          <ISearch />
        </span>
        <span className="search-field">
          {!q && (
            <span className="search-ph" aria-hidden>
              Search{' '}
              <span className="ph-roll">
                <span ref={word}>{hints[0]}</span>
              </span>
            </span>
          )}
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setFocus(true)}
            onBlur={() => setFocus(false)}
            onKeyDown={(e) => e.key === 'Escape' && (q ? setQ('') : input.current?.blur())}
            aria-label="Search your files"
            type="search"
            enterKeyHint="search"
          />
        </span>
        {q ? (
          <button type="button" className="search-clear" aria-label="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={() => (setQ(''), input.current?.focus())}>
            <IX />
          </button>
        ) : (
          !focus && <kbd className="search-kbd" title="Press / to search">/</kbd>
        )}
      </label>
    </div>
  );
}

/** A collection as a little stack of prints that fans out when you point at it. */
export function CollectionCard({ c, lib }: { c: Collection; lib: Lib }) {
  const s = useStore();
  const ref = useRef<HTMLButtonElement>(null);
  const under = useMemo(() => itemsUnder(lib, c.id), [lib, c.id]);
  const pics = useMemo(() => under.flatMap((i) => i.files.filter(canShow)).slice(0, 3), [under]);
  const files = under.reduce((n, i) => n + i.files.length, 0);
  const latest = Math.max(c.updatedAt, ...under.map((i) => i.date));
  const fan = (open: boolean) => {
    if (!motionOK() || !ref.current) return;
    const p = ref.current.querySelectorAll('.print');
    const d = { duration: open ? 0.6 : 0.9, ease: open ? 'back.out(1.7)' : 'elastic.out(1, 0.55)', overwrite: true };
    gsap.to(p[0] ?? [], { rotation: 0, y: open ? -10 : 0, scale: open ? 1.04 : 1, ...d });
    gsap.to(p[1] ?? [], { rotation: open ? -12 : -6, x: open ? '-34%' : '-12%', y: open ? 4 : 0, ...d });
    gsap.to(p[2] ?? [], { rotation: open ? 12 : 6, x: open ? '34%' : '12%', y: open ? 4 : 0, ...d });
    gsap.to(ref.current.querySelector('.coll-go'), { x: open ? 4 : 0, duration: 0.4, ease: 'power3.out' });
  };
  return (
    <button
      className="coll reveal"
      ref={ref}
      onPointerEnter={(e) => e.pointerType === 'mouse' && fan(true)}
      onPointerLeave={() => fan(false)}
      onFocus={() => fan(true)}
      onBlur={() => fan(false)}
      onClick={() => (s.go({ page: 'collection', id: c.id }), scrollTo({ top: 0 }))}
    >
      <span className="coll-stack">
        {pics.length ? (
          // the first picture lies on top
          pics
            .map((f, i) => (
              <span key={f.id} className={`print p${i}`}>
                <Thumb f={f} />
              </span>
            ))
            .reverse()
        ) : (
          <span className="print p0 ph">
            <IFolder />
          </span>
        )}
      </span>
      <span className="coll-text">
        <span>
          <strong>{c.name}</strong>
          <small>
            {files} {files === 1 ? 'file' : 'files'} · updated {fmtAgo(latest)}
          </small>
        </span>
        <span className="coll-go">
          <IChevR />
        </span>
      </span>
    </button>
  );
}

/** The newest work in one row you can scroll sideways. */
function Rail({ items }: { items: Item[] }) {
  const s = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const entries = useMemo(() => entriesOf(items), [items]);
  const edges = () => {
    const el = ref.current;
    if (el) setEdge({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 });
  };
  // play the entrance once per set of pieces (not again when the library reloads with the same ones)
  const ids = items.map((i) => i.id).join();
  useLayoutEffect(() => {
    edges();
    if (!motionOK() || !ref.current) return;
    const ctx = gsap.context(() => {
      // clear only what we animate: each card's inline style also holds its picture's shape (--ar)
      gsap.from('.rail-card', { opacity: 0, x: 60, stagger: 0.06, duration: 0.9, ease: 'expo.out', clearProps: 'opacity,transform', scrollTrigger: { trigger: ref.current, start: 'top 90%', once: true } });
    }, ref);
    return () => ctx.revert();
  }, [ids]);
  const by = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: 'smooth' });
  return (
    <div className="rail-wrap">
      <div className="rail" ref={ref} onScroll={edges}>
        {items.map((it) => {
          const f = it.files[0];
          const idx = entries.findIndex((e) => e.item.id === it.id);
          const ratio = f.width && f.height ? Math.min(1.6, Math.max(0.62, f.width / f.height)) : 0.8;
          return (
            <button key={it.id} className="rail-card" style={{ ['--ar' as string]: ratio }} onClick={(e) => s.view(entries, idx, e.currentTarget.querySelector('img') ?? e.currentTarget)} aria-label={`Open ${it.title || f.name}`}>
              {canShow(f) ? (
                <Thumb f={f} />
              ) : (
                <span className="rail-doc">
                  <span className="doc-ext" style={{ ['--e' as string]: extColor(f.name) }}>{ext(f.name) || 'FILE'}</span>
                </span>
              )}
              {f.kind === 'video' && (
                <span className="badge">
                  <IPlay /> {fmtDuration(f.duration) || 'Video'}
                </span>
              )}
              <span className="rail-meta">
                <strong>{it.title || f.name}</strong>
                <small>{fmtAgo(it.date)}</small>
              </span>
            </button>
          );
        })}
      </div>
      <button className={`rail-btn prev${edge.start ? ' off' : ''}`} onClick={() => by(-1)} aria-label="Scroll back" tabIndex={-1}>
        <IChevL />
      </button>
      <button className={`rail-btn next${edge.end ? ' off' : ''}`} onClick={() => by(1)} aria-label="Scroll on" tabIndex={-1}>
        <IChevR />
      </button>
    </div>
  );
}

export function Masonry({ items }: { items: Item[] }) {
  const s = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const entries = useMemo(() => entriesOf(items), [items]);
  const key = entries.map((e) => e.file.id).join();
  useLayoutEffect(() => (ref.current ? revealOnScroll(ref.current, '.tile') : undefined), [key]);
  return (
    <div className="masonry" ref={ref}>
      {items.map((it) => {
        const idx = entries.findIndex((e) => e.item.id === it.id);
        return <Tile key={it.id} item={it} file={it.files[0]} onOpen={(el) => s.view(entries, idx, el)} />;
      })}
    </div>
  );
}

function CountUp({ to }: { to: number }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!motionOK() || !ref.current) return;
    const o = { v: 0 };
    const t = gsap.to(o, { v: to, duration: 1.4, ease: 'power3.out', delay: 0.35, onUpdate: () => ref.current && (ref.current.textContent = String(Math.round(o.v))) });
    return () => void t.kill();
  }, [to]);
  return <b ref={ref}>{to}</b>;
}

export function Empty({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!motionOK()) return;
    const ctx = gsap.context(() => {
      gsap.from('.empty-orb', { scale: 0.6, autoAlpha: 0, duration: 1.2, ease: 'expo.out' });
      gsap.to('.empty-orb', { y: -10, duration: 3, ease: 'sine.inOut', yoyo: true, repeat: -1 });
      gsap.from('.empty > :not(.empty-orb)', { autoAlpha: 0, y: 14, stagger: 0.08, delay: 0.2 });
    }, ref);
    return () => ctx.revert();
  }, []);
  return (
    <div className="empty" ref={ref}>
      <div className="empty-orb" />
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

/**
 * The night-sky banner (greeting, client name, counters, buttons) is switched off for now, until we
 * have enough of each client's details to fill it. Set to true to bring it back; its code is below.
 */
const SHOW_MOONRISE = false;

function Head({ kicker, title, note }: { kicker: string; title: string; note?: string }) {
  return (
    <div className="section-head">
      <div>
        <span className="kicker">{kicker}</span>
        <h2>{title}</h2>
      </div>
      {note && <span>{note}</span>}
    </div>
  );
}

/** The top of the page: the same night as the sign-in, with the moon turning on the right. */
function Moonrise({ lib, first, fileCount, onBrowse }: { lib: Lib; first: string; fileCount: number; onBrowse: () => void }) {
  const s = useStore();
  const ref = useRef<HTMLElement>(null);
  const latest = lib.items.reduce((m, i) => Math.max(m, i.date), 0);
  useLayoutEffect(() => {
    if (!motionOK() || !ref.current) return;
    const el = ref.current;
    const ctx = gsap.context(() => {
      gsap.to('.moon-map', { xPercent: -50, duration: 90, ease: 'none', repeat: -1 });
      gsap.to('.moon-orbit', { rotationZ: '+=360', duration: 26, ease: 'none', repeat: -1 });
      gsap.to('.glow.g1', { x: '6vw', y: '3vh', duration: 12, ease: 'sine.inOut', yoyo: true, repeat: -1 });
      gsap.to('.glow.g2', { x: '-5vw', y: '-4vh', duration: 15, ease: 'sine.inOut', yoyo: true, repeat: -1 });
      const split = new SplitText('h1', { type: 'words', wordsClass: 'w' });
      gsap
        .timeline({ defaults: { ease: 'expo.out' } })
        .from(el, { clipPath: 'inset(8% 6% 8% 6% round 48px)', duration: 1.4, clearProps: 'clipPath' })
        .from('.moonrise-moon', { y: 160, scale: 0.7, opacity: 0, duration: 2 }, 0.1)
        .from('.eyebrow', { opacity: 0, y: 10, duration: 0.7 }, 0.3)
        .from(split.words, { opacity: 0, yPercent: 60, filter: 'blur(10px)', stagger: 0.08, duration: 1 }, 0.35)
        .from('.lede', { opacity: 0, y: 14, duration: 0.9 }, 0.6)
        .from('.stat, .moonrise-cta > *', { opacity: 0, y: 18, scale: 0.94, stagger: 0.06, duration: 0.9, ease: 'back.out(1.6)', clearProps: 'transform,opacity' }, 0.7);
      // scrolling away: the moon sinks slower than the page, the words fade
      gsap.to('.moonrise-moon', { yPercent: 28, ease: 'none', scrollTrigger: { trigger: el, start: 'top top', end: 'bottom top', scrub: true } });
      gsap.to('.moonrise-text', { opacity: 0.2, y: -40, ease: 'none', scrollTrigger: { trigger: el, start: 'top top', end: 'bottom top', scrub: true } });
    }, el);
    const ball = el.querySelector<HTMLElement>('.moon3d')!;
    const mx = gsap.quickTo(ball, 'x', { duration: 1.4, ease: 'power3.out' });
    const my = gsap.quickTo(ball, 'y', { duration: 1.4, ease: 'power3.out' });
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      mx(((e.clientX - r.left) / r.width - 0.5) * -26);
      my(((e.clientY - r.top) / r.height - 0.5) * -18);
    };
    el.addEventListener('pointermove', move);
    return () => {
      el.removeEventListener('pointermove', move);
      ctx.revert();
    };
  }, []);
  return (
    <section className="moonrise" ref={ref}>
      <Stars density={3600} />
      <i className="glow g1" aria-hidden />
      <i className="glow g2" aria-hidden />
      <div className="moonrise-moon">
        <Moon />
      </div>
      <div className="moonrise-text">
        <span className="eyebrow">
          <span className="avatar" style={{ ['--c' as string]: lib.client.color || undefined }}>
            {initials(lib.client.name)}
          </span>
          {lib.client.name}
        </span>
        <h1>
          {greeting()}, <span className="warm">{first}.</span>
        </h1>
        <p className="lede">{fileCount ? `Everything the team has made for you, in one place${latest ? ` — last delivery ${fmtAgo(latest)}` : ''}.` : 'This is where your designs, videos and files will appear.'}</p>
        {fileCount > 0 && (
          <div className="stats">
            <span className="stat">
              <CountUp to={fileCount} />
              <span>files</span>
            </span>
            <span className="stat">
              <CountUp to={lib.collections.length} />
              <span>collections</span>
            </span>
            {lib.links.length > 0 && (
              <span className="stat">
                <CountUp to={lib.links.length} />
                <span>links</span>
              </span>
            )}
          </div>
        )}
        <div className="moonrise-cta">
          {fileCount > 0 && (
            <button className="btn-glow" onClick={onBrowse}>
              Browse your work
              <IChevR />
            </button>
          )}
          <button className="btn-glass" onClick={() => s.go({ page: 'send' })}>
            <IUpload /> Send files
          </button>
        </div>
      </div>
    </section>
  );
}

export function LibraryPage() {
  const s = useStore();
  const lib = s.lib;
  const page = useRef<HTMLDivElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const swap = useFilterSwap(filter, setFilter);
  const first = s.me.user.name.split(/\s+/)[0];

  const tops = useMemo(() => (lib ? lib.collections.filter((c) => !c.parentId) : []), [lib]);
  const loose = useMemo(() => (lib ? lib.items.filter((i) => !i.collectionId) : []), [lib]);
  const fresh = useMemo(() => (lib ? [...lib.items].sort((a, b) => b.date - a.date).slice(0, 12) : []), [lib]);
  const filtered = useMemo(() => (lib ? filterItems(lib.items, filter, q) : []), [lib, filter, q]);
  const narrowing = filter !== 'all' || q.trim() !== '';
  const fileCount = lib ? lib.items.reduce((n, i) => n + i.files.length, 0) : 0;
  const key = `${narrowing}-${tops.length}`;

  useLayoutEffect(() => (page.current ? revealOnScroll(page.current, '.reveal') : undefined), [key, !!lib]);

  if (!lib) {
    return (
      <main className={`page${SHOW_MOONRISE ? '' : ' no-banner'}`}>
        {SHOW_MOONRISE && <div className="skel moonrise-skel" />}
        <div className="collections">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel" style={{ aspectRatio: '4/3.6', borderRadius: 28 }} />
          ))}
        </div>
        {s.libError && <p className="err">{s.libError}</p>}
      </main>
    );
  }

  const browse = () => {
    const top = (tools.current?.getBoundingClientRect().top ?? 0) + scrollY - 76;
    scrollTo({ top, behavior: 'smooth' });
  };
  const n = (items: Item[]) => items.reduce((k, i) => k + i.files.length, 0);
  return (
    <main className={`page${SHOW_MOONRISE ? '' : ' no-banner'}`} ref={page}>
      {SHOW_MOONRISE && <Moonrise lib={lib} first={first} fileCount={fileCount} onBrowse={browse} />}

      {!fileCount && !lib.links.length ? (
        <Empty
          title="Nothing here yet"
          text="When the team shares work with you, it shows up here straight away. You can send them files any time."
          action={
            <button className="btn primary" onClick={() => s.go({ page: 'send' })}>
              Send files to the team
            </button>
          }
        />
      ) : (
        <>
          <div ref={tools}>{fileCount > 0 && <Toolbar filter={filter} setFilter={swap.change} q={q} setQ={setQ} items={lib.items} />}</div>
          <div ref={swap.box}>
          {narrowing ? (
            <section className="section">
              <Head kicker={q.trim() ? 'Search' : 'Showing'} title={q.trim() ? `Results for “${q.trim()}”` : FILTERS.find((f) => f.value === filter)!.label} note={`${n(filtered)} files`} />
              {filtered.length ? <Masonry items={filtered} /> : <p className="muted">Nothing matches. Try another word.</p>}
            </section>
          ) : (
            <>
              {fresh.length > 2 && (
                <section className="section">
                  <Head kicker="Just delivered" title="Newest work" note="Scroll sideways" />
                  <Rail items={fresh} />
                </section>
              )}
              {tops.length > 0 && (
                <section className="section">
                  <Head kicker="Collections" title="Your projects" note={`${tops.length}`} />
                  <div className="collections">
                    {tops.map((c) => (
                      <CollectionCard key={c.id} c={c} lib={lib} />
                    ))}
                  </div>
                </section>
              )}
              {tops.length > 0 && loose.length > 0 && (
                <section className="section">
                  <Head kicker="One-offs" title="Shared with you" note={`${n(loose)} files`} />
                  <Masonry items={loose} />
                </section>
              )}
              {lib.items.length > 0 && (
                <section className="section">
                  <Head kicker="Everything" title="All your work" note="Newest first" />
                  <Masonry items={lib.items} />
                </section>
              )}
            </>
          )}
          {lib.links.length > 0 && !narrowing && (
            <section className="section">
              <Head kicker="Elsewhere" title="Links" note="Boards, drafts and videos" />
              <div className="links">
                {lib.links.map((l) => (
                  <a key={l.id} className="link-card reveal" href={l.url} target="_blank" rel="noreferrer noopener">
                    <span className="link-ic">
                      <ILink />
                    </span>
                    <div>
                      <strong>{l.title || host(l.url)}</strong>
                      <small>{host(l.url)}</small>
                    </div>
                    <IArrowUR />
                  </a>
                ))}
              </div>
            </section>
          )}
          </div>
        </>
      )}
    </main>
  );
}

