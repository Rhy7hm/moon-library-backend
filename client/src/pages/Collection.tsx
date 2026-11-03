/* One collection: its name, the collections inside it, and its files. */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { gsap, motionOK, SplitText } from '../motion';
import { useStore } from '../store';
import { IChevL, IFolder } from '../ui/icons';
import { Empty, filterItems, itemsUnder, Masonry, Toolbar, useFilterSwap, type Filter } from './Library';

export function CollectionPage({ id }: { id: string }) {
  const s = useStore();
  const lib = s.lib;
  const head = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const swap = useFilterSwap(filter, setFilter);
  const c = lib?.collections.find((x) => x.id === id);

  useLayoutEffect(() => {
    if (!motionOK() || !head.current || !c) return;
    const ctx = gsap.context(() => {
      const split = new SplitText('h1', { type: 'chars' });
      gsap
        .timeline()
        .from('.back', { autoAlpha: 0, x: -12, duration: 0.5 })
        .from(split.chars, { autoAlpha: 0, y: 40, rotateX: -60, stagger: 0.02, duration: 0.8, ease: 'expo.out' }, 0.05)
        .from('.crumbs', { autoAlpha: 0, y: 8 }, 0.3)
        .from('.sub-coll', { autoAlpha: 0, y: 16, scale: 0.9, stagger: 0.05, ease: 'back.out(1.7)' }, 0.35);
    }, head);
    return () => ctx.revert();
  }, [id, !!c]);

  const path = useMemo(() => {
    const out = [];
    for (let cur = c; cur; cur = lib?.collections.find((x) => x.id === cur!.parentId)) out.unshift(cur);
    return out;
  }, [c, lib]);
  const subs = useMemo(() => (lib ? lib.collections.filter((x) => x.parentId === id) : []), [lib, id]);
  const own = useMemo(() => (lib ? lib.items.filter((i) => i.collectionId === id) : []), [lib, id]);
  const narrowing = filter !== 'all' || q.trim() !== '';
  const shown = useMemo(() => (lib ? filterItems(narrowing ? itemsUnder(lib, id) : own, filter, q) : []), [lib, id, own, filter, q, narrowing]);

  if (!lib) return <main className="page" />;
  if (!c) {
    return (
      <main className="page">
        <Empty title="This collection isn't here" text="It may have been moved or is no longer shared with you." action={<button className="btn primary" onClick={() => s.go({ page: 'library' })}>Back to your library</button>} />
      </main>
    );
  }
  const parent = path.length > 1 ? path[path.length - 2] : null;
  return (
    <main className="page">
      <div ref={head}>
        <button className="back" onClick={() => s.go(parent ? { page: 'collection', id: parent.id } : { page: 'library' })}>
          <IChevL /> {parent ? parent.name : 'Library'}
        </button>
        <section className="hero" style={{ paddingTop: 18 }}>
          <h1>{c.name}</h1>
          <p className="crumbs">
            {itemsUnder(lib, id).reduce((n, i) => n + i.files.length, 0)} files{subs.length ? ` · ${subs.length} ${subs.length === 1 ? 'collection' : 'collections'} inside` : ''}
          </p>
        </section>
        {subs.length > 0 && (
          <div className="sub-colls">
            {subs.map((x) => (
              <button key={x.id} className="sub-coll" onClick={() => (s.go({ page: 'collection', id: x.id }), scrollTo({ top: 0 }))}>
                <span className="ic">
                  <IFolder />
                </span>
                {x.name} <small>{itemsUnder(lib, x.id).length}</small>
              </button>
            ))}
          </div>
        )}
      </div>
      {(own.length > 0 || subs.length > 0) && <Toolbar filter={filter} setFilter={swap.change} q={q} setQ={setQ} items={itemsUnder(lib, id)} />}
      <div ref={swap.box}>
        {shown.length ? (
          <Masonry items={shown} />
        ) : narrowing ? (
          <p className="muted">Nothing matches. Try another word.</p>
        ) : !subs.length ? (
          <Empty title="Nothing in here yet" text="New work the team adds to this collection appears here automatically." />
        ) : null}
      </div>
    </main>
  );
}
