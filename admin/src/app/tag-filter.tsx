/*
 * Filtering a folder (or the Library, or Recent) by tag.
 *
 *   <TagFilterButton>  the "Tags" button in the toolbar and the popover it opens: every tag used by the files in
 *                      view, in its own colour, with how many files have it. Tick several; Any / All decides whether a
 *                      file needs one of them or all of them; "Untagged" finds files nobody has tagged yet. Type to
 *                      search a long list; ↑ ↓ move, Enter or Space ticks, Esc closes.
 *   <TagFilterBar>     under the toolbar while a filter is on: the chosen tags as chips (× takes one off), the
 *                      Any / All switch, "Clear" and how many files match.
 *   applyTagFilter     the filter itself (so the grid and the counts agree).
 * Tags on the file cards can be clicked too (see AssetCard): that adds or removes the tag here.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Asset, Tag } from './api';
import { IChevD, ICheck, ISearch, ITag } from './icons';
import { gsap, motionOK } from './motion';
import { TagChip } from './tags';
import { Segmented } from './ui';

export type TagFilter = { ids: string[]; mode: 'any' | 'all'; untagged: boolean };
export const NO_TAG_FILTER: TagFilter = { ids: [], mode: 'any', untagged: false };
export const tagFilterOn = (f: TagFilter) => f.untagged || f.ids.length > 0;

/** The files that pass the filter. */
export function applyTagFilter(assets: Asset[], f: TagFilter): Asset[] {
  if (f.untagged) return assets.filter((a) => !a.tags?.length);
  if (!f.ids.length) return assets;
  return assets.filter((a) => (f.mode === 'all' ? f.ids.every((id) => a.tags?.includes(id)) : f.ids.some((id) => a.tags?.includes(id))));
}

/** How many of these files have each tag, and how many have none. */
export function tagStats(assets: Asset[]) {
  const counts = new Map<string, number>();
  let untagged = 0;
  for (const a of assets) {
    if (!a.tags?.length) untagged++;
    for (const id of a.tags ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return { counts, untagged };
}

/** Adds or takes off one tag (a click on a tag on a card, or on a row in the popover). */
export function toggleTagId(f: TagFilter, id: string): TagFilter {
  return { ids: f.ids.includes(id) ? f.ids.filter((x) => x !== id) : [...f.ids, id], mode: f.mode, untagged: false };
}

type Row = { kind: 'tag'; tag: Tag } | { kind: 'none' };
const UNTAGGED: Tag = { id: 'none', name: 'Untagged', color: null };
const MODES = [
  { value: 'any' as const, label: 'Any', title: 'Files that have at least one of these tags' },
  { value: 'all' as const, label: 'All', title: 'Files that have every one of these tags' },
];

/* ---------------- the button and its popover ---------------- */

export function TagFilterButton({ tags, counts, untagged, value, onChange }: { tags: Tag[]; counts: Map<string, number>; untagged: number; value: TagFilter; onChange: (f: TagFilter) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean; max: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = tags.length > 6; // a short list doesn't need a search box
  const on = tagFilterOn(value);

  const rows = useMemo<Row[]>(() => {
    const needle = q.trim().toLowerCase();
    const out: Row[] = tags.filter((t) => !needle || t.name.toLowerCase().includes(needle)).map((tag) => ({ kind: 'tag', tag }));
    if (untagged > 0 && (!needle || 'untagged'.includes(needle))) out.push({ kind: 'none' });
    return out;
  }, [tags, untagged, q]);

  // open: start fresh, with the first ticked tag in view
  useEffect(() => {
    if (!open) return;
    setQ('');
    setHi(Math.max(0, tags.findIndex((t) => value.ids.includes(t.id))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // close: outside click, the page scrolling away from the button, the window changing
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => !btn.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node) && setOpen(false);
    const away = (e: Event) => !pop.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', outside);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('mousedown', outside);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
  }, [open]);

  // placed under the button, lined up with its left edge (above when there's no room), inside the window, never taller than the space it has
  useLayoutEffect(() => {
    if (!open || !btn.current) return setPos(null);
    const r = btn.current.getBoundingClientRect();
    const w = pop.current?.offsetWidth ?? 300;
    const h = pop.current?.offsetHeight ?? 0;
    const below = innerHeight - r.bottom - 14;
    const above = r.top - 14;
    const up = h > below && above > below;
    const max = Math.max(200, Math.min(440, up ? above : below));
    setPos({ top: up ? Math.max(8, r.top - 6 - Math.min(h, max)) : r.bottom + 6, left: Math.max(8, Math.min(r.left, innerWidth - w - 8)), up, max });
  }, [open, rows.length, value.ids.length]);

  // focus goes into the popover (the search box when there is one), and the highlighted row stays in view
  useEffect(() => {
    if (open && pos) (pop.current?.querySelector<HTMLElement>('.tagpop-search input') ?? pop.current)?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, !!pos]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('.tagpop-row.hi')?.scrollIntoView({ block: 'nearest' });
  }, [hi, open, rows.length]);

  const toggle = (row: Row) => {
    if (row.kind === 'none') return onChange(value.untagged ? NO_TAG_FILTER : { ids: [], mode: value.mode, untagged: true });
    onChange(toggleTagId(value, row.tag.id));
  };
  const close = () => (setOpen(false), btn.current?.focus());
  const onKey = (e: React.KeyboardEvent) => {
    const typing = (e.target as HTMLElement).tagName === 'INPUT';
    if (e.key === 'Escape') {
      e.stopPropagation(); // not also "clear the selection" on the page behind
      close();
    } else if (e.key === 'ArrowDown') (e.preventDefault(), setHi((h) => Math.min(h + 1, rows.length - 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setHi((h) => Math.max(h - 1, 0)));
    else if (e.key === 'Home' && !typing) (e.preventDefault(), setHi(0));
    else if (e.key === 'End' && !typing) (e.preventDefault(), setHi(rows.length - 1));
    else if ((e.key === 'Enter' || (e.key === ' ' && !typing)) && rows[hi]) (e.preventDefault(), toggle(rows[hi]));
  };

  const label = value.untagged ? 'Untagged' : 'Tags';
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`tagbtn${on ? ' on' : ''}${open ? ' open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Filter by tag"
        onClick={() => setOpen((v) => !v)}
      >
        <ITag />
        <span>{label}</span>
        {value.ids.length > 0 && <b className="tagbtn-n">{value.ids.length}</b>}
        <IChevD className="tagbtn-chev" />
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            className={`tagpop${pos?.up ? ' up' : ''}`}
            role="dialog"
            aria-label="Filter by tag"
            tabIndex={-1}
            style={pos ? { top: pos.top, left: pos.left, maxHeight: pos.max } : { visibility: 'hidden', top: 0, left: 0 }}
            onKeyDown={onKey}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tagpop-head">
              <strong>Filter by tag</strong>
              {on && (
                <button type="button" className="link-btn" onClick={() => onChange(NO_TAG_FILTER)}>
                  Clear
                </button>
              )}
            </div>
            {search && (
              <label className="tagpop-search">
                <ISearch />
                <input value={q} onChange={(e) => (setQ(e.target.value), setHi(0))} placeholder="Find a tag…" aria-label="Find a tag" spellCheck={false} />
              </label>
            )}
            <div className="tagpop-list" role="listbox" aria-multiselectable="true" ref={list}>
              {rows.map((row, i) => {
                const tag = row.kind === 'tag' ? row.tag : UNTAGGED;
                const sel = row.kind === 'tag' ? value.ids.includes(tag.id) : value.untagged;
                return (
                  <button
                    key={tag.id}
                    type="button"
                    role="option"
                    aria-selected={sel}
                    tabIndex={-1}
                    className={`tagpop-row${sel ? ' on' : ''}${i === hi ? ' hi' : ''}${row.kind === 'none' ? ' none' : ''}`}
                    style={{ ['--t' as string]: tag.color || '#8e8e93', ['--i' as string]: Math.min(i, 9) }}
                    onMouseMove={() => hi !== i && setHi(i)}
                    onClick={() => toggle(row)}
                  >
                    <span className="tagpop-check">{sel && <ICheck />}</span>
                    <span className="tagpop-name">{row.kind === 'none' ? 'No tags yet' : tag.name}</span>
                    <span className="tagpop-n">{row.kind === 'none' ? untagged : counts.get(tag.id) ?? 0}</span>
                  </button>
                );
              })}
              {!rows.length && <p className="tagpop-empty">No tag matches “{q.trim()}”.</p>}
            </div>
            <div className="tagpop-foot">
              {value.ids.length > 1 ? (
                <>
                  <span>Files with</span>
                  <Segmented label="Match any or all of the tags" value={value.mode} options={MODES} onChange={(mode) => onChange({ ...value, mode })} />
                  <span>of these</span>
                </>
              ) : (
                <span className="tagpop-hint">{tags.length > 1 ? 'Tick more than one to combine them.' : 'Tick a tag to show only its files.'}</span>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/* ---------------- the bar under the toolbar ---------------- */

export function TagFilterBar({ tags, value, onChange, count, total }: { tags: Tag[]; value: TagFilter; onChange: (f: TagFilter) => void; count: number; total: number }) {
  const bar = useRef<HTMLDivElement>(null);
  const seen = useRef<string[]>(value.ids);
  // the bar slides in when it appears; a chip pops in when its tag is added
  useLayoutEffect(() => {
    if (motionOK() && bar.current) gsap.from(bar.current, { opacity: 0, y: -8, duration: 0.4, ease: 'power3.out', clearProps: 'opacity,transform' });
  }, []);
  useLayoutEffect(() => {
    const added = value.ids.filter((id) => !seen.current.includes(id));
    seen.current = value.ids;
    if (!motionOK() || !bar.current) return;
    for (const id of added) {
      const el = bar.current.querySelector(`[data-tag="${id}"]`);
      if (el) gsap.fromTo(el, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: 'back.out(2.4)', clearProps: 'transform,opacity' });
    }
  }, [value.ids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="tagbar" ref={bar} role="group" aria-label="Active tag filter">
      {value.untagged ? (
        <>
          <span className="tagbar-label">Showing files with</span>
          <span data-tag="none">
            <TagChip tag={UNTAGGED} onRemove={() => onChange(NO_TAG_FILTER)} />
          </span>
        </>
      ) : (
        <>
          <span className="tagbar-label">Tagged</span>
          {tags.map((t, i) => (
            <span key={t.id} data-tag={t.id} className="tagbar-item">
              {i > 0 && (
                <button
                  type="button"
                  className="tagbar-mode"
                  title={value.mode === 'all' ? 'Files with every one of these tags. Click to match any instead.' : 'Files with at least one of these tags. Click to require all of them.'}
                  onClick={() => onChange({ ...value, mode: value.mode === 'all' ? 'any' : 'all' })}
                >
                  {value.mode === 'all' ? 'and' : 'or'}
                </button>
              )}
              <TagChip tag={t} onRemove={() => onChange(toggleTagId(value, t.id))} />
            </span>
          ))}
        </>
      )}
      <button type="button" className="link-btn tagbar-clear" onClick={() => onChange(NO_TAG_FILTER)}>
        Clear
      </button>
      <span className="tagbar-count" aria-live="polite">
        {count.toLocaleString()} of {total.toLocaleString()} {total === 1 ? 'file' : 'files'}
      </span>
    </div>
  );
}
