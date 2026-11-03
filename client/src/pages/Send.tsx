/*
 * Send files to the team: a big drop zone (with a little orbiting light), then a review list — files
 * wait there until the client presses Send, so a wrong file can be taken out first — then a live
 * queue with progress bars, and everything sent so far. Files go to "From <company>" in the team's library.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { errText, uploads as loadUploads, type Upload } from '../api';
import { ext, fmtSize } from '../format';
import { gsap, motionOK } from '../motion';
import { entriesOf, useStore } from '../store';
import { ICheck, IUpload, IX } from '../ui/icons';
import { Tile } from '../ui/Tile';
import { sendFile } from '../upload';

type Job = { id: number; file: File; pct: number; state: 'ready' | 'waiting' | 'sending' | 'done' | 'failed'; error?: string; preview?: string };
const MAX = 5 * 1024 * 1024 * 1024;

function JobRow({ j, onRemove }: { j: Job; onRemove?: () => void }) {
  const bar = useRef<HTMLElement>(null);
  const row = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!motionOK()) return;
    // explicit start and end, undone on cleanup: React runs this twice in development, and a plain
    // `from` the second time would take the hidden state as the end and leave the row invisible
    const t = gsap.fromTo(row.current, { autoAlpha: 0, y: 16, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.5)', clearProps: 'opacity,visibility,transform' });
    return () => void t.revert();
  }, []);
  useEffect(() => {
    gsap.to(bar.current, { width: `${j.pct}%`, duration: motionOK() ? 0.4 : 0, ease: 'power2.out' });
  }, [j.pct]);
  useEffect(() => {
    if (j.state === 'done' && motionOK()) gsap.fromTo(row.current!.querySelector('.q-state'), { scale: 0 }, { scale: 1, duration: 0.6, ease: 'elastic.out(1.2, 0.5)' });
  }, [j.state]);
  return (
    <div className={`q-row ${j.state === 'failed' ? 'fail' : ''}`} ref={row}>
      <span className="q-thumb">{j.preview ? <img src={j.preview} alt="" /> : ext(j.file.name) || 'FILE'}</span>
      <span className="q-text">
        <strong>{j.file.name}</strong>
        <small>
          {j.state === 'failed' ? j.error : j.state === 'ready' ? `${ext(j.file.name) || 'File'} · ${fmtSize(j.file.size)}` : j.state === 'done' ? `${fmtSize(j.file.size)} · sent` : j.state === 'waiting' ? `${fmtSize(j.file.size)} · waiting` : `${fmtSize(j.file.size)} · ${j.pct}%`}
        </small>
        {(j.state === 'waiting' || j.state === 'sending') && (
          <span className="q-bar">
            <i ref={bar} />
          </span>
        )}
      </span>
      {j.state === 'done' && (
        <span className="q-state done">
          <ICheck />
        </span>
      )}
      {j.state === 'failed' && !onRemove && (
        <span className="q-state fail">
          <IX />
        </span>
      )}
      {onRemove && (
        <button type="button" className="q-remove" onClick={onRemove} aria-label={`Remove ${j.file.name}`} title="Remove">
          <IX />
        </button>
      )}
    </div>
  );
}

export function SendPage() {
  const s = useStore();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sent, setSent] = useState<Upload[] | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const drop = useRef<HTMLLabelElement>(null);
  const page = useRef<HTMLElement>(null);
  const nextId = useRef(0);
  const running = useRef(false);
  const queue = useRef<Job[]>([]);

  const refresh = useCallback(() => loadUploads().then(setSent, () => setSent([])), []);
  useEffect(() => void refresh(), [refresh]);

  useLayoutEffect(() => {
    if (!motionOK()) return;
    const ctx = gsap.context(() => {
      gsap.from('.drop', { autoAlpha: 0, y: 30, scale: 0.97, duration: 0.9, ease: 'expo.out' });
      gsap.from('.drop > *:not(.drop-wave)', { autoAlpha: 0, y: 14, stagger: 0.07, delay: 0.15 });
      gsap.to('.drop-orb .spin', { rotation: 360, duration: 6, ease: 'none', repeat: -1, transformOrigin: '50% 50%' });
      gsap.to('.drop-orb .r2', { scale: 1.08, autoAlpha: 0.4, duration: 2.2, ease: 'sine.inOut', yoyo: true, repeat: -1 });
    }, page);
    return () => ctx.revert();
  }, []);

  const patch = (id: number, p: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...p } : j)));
  const ready = jobs.filter((j) => j.state === 'ready');
  const problems = jobs.filter((j) => j.state === 'failed' && j.pct === 0);
  const moving = jobs.filter((j) => j.state === 'waiting' || j.state === 'sending' || j.state === 'done' || (j.state === 'failed' && j.pct > 0));
  const busy = jobs.some((j) => j.state === 'waiting' || j.state === 'sending');

  // leaving with files still to check or still sending asks first
  useEffect(() => {
    if (!ready.length && !busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [ready.length, busy]);

  const remove = (id: number) => {
    const row = page.current?.querySelector(`[data-job="${id}"]`);
    const drop = () =>
      setJobs((js) => {
        const j = js.find((x) => x.id === id);
        if (j?.preview) URL.revokeObjectURL(j.preview);
        return js.filter((x) => x.id !== id);
      });
    if (row && motionOK()) gsap.to(row, { opacity: 0, x: 40, height: 0, paddingTop: 0, paddingBottom: 0, marginTop: -10, duration: 0.35, ease: 'power2.in', onComplete: drop });
    else drop();
  };
  const clearReview = () => [...ready, ...problems].forEach((j) => remove(j.id));
  const clearFinished = () => setJobs((js) => js.filter((j) => j.state !== 'done' && !(j.state === 'failed' && j.pct > 0)));

  const send = () => {
    if (!ready.length) return;
    // newest-first on screen, but send in the order they were added
    const go = [...ready].reverse();
    setJobs((js) => js.map((j) => (j.state === 'ready' ? { ...j, state: 'waiting' } : j)));
    queue.current.push(...go.map((j) => ({ ...j, state: 'waiting' as const })));
    pump();
  };

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    let okCount = 0;
    while (queue.current.length) {
      const j = queue.current.shift()!;
      patch(j.id, { state: 'sending', pct: 1 });
      // pct > 0 marks a failure that happened while sending (not a file refused on adding)
      try {
        await sendFile(j.file, (pct) => patch(j.id, { pct }));
        patch(j.id, { state: 'done', pct: 100 });
        okCount++;
      } catch (e) {
        patch(j.id, { state: 'failed', error: errText(e), pct: 1 });
      }
    }
    running.current = false;
    if (okCount) {
      s.toast(`${okCount} ${okCount === 1 ? 'file' : 'files'} sent to the team`, 'ok');
      refresh();
    }
  }, [refresh, s]);

  const add = (files: FileList | File[]) => {
    // the same file twice in the review list is almost always a slip
    const have = new Set(jobs.filter((j) => j.state === 'ready').map((j) => `${j.file.name}:${j.file.size}`));
    const all = Array.from(files);
    const list = all.filter((f) => !have.has(`${f.name}:${f.size}`));
    if (all.length > list.length) s.toast(all.length - list.length === 1 ? 'That file is already in the list' : `${all.length - list.length} files were already in the list`);
    if (!list.length) return;
    const fresh: Job[] = list.map((file) => ({
      id: ++nextId.current,
      file,
      pct: 0,
      state: file.size > MAX ? 'failed' : file.size === 0 ? 'failed' : 'ready',
      error: file.size > MAX ? 'Too big — 5 GB at most' : file.size === 0 ? 'This file is empty' : undefined,
      preview: file.type.startsWith('image/') && file.size < 30 * 1024 * 1024 ? URL.createObjectURL(file) : undefined,
    }));
    setJobs((js) => [...fresh, ...js]);
    if (motionOK()) gsap.fromTo('.drop-orb .core', { scale: 0.8 }, { scale: 1, duration: 0.8, ease: 'elastic.out(1.2, 0.4)' });
  };
  const readySize = ready.reduce((n, j) => n + j.file.size, 0);

  const wave = (e: React.PointerEvent | React.DragEvent) => {
    const r = drop.current!.getBoundingClientRect();
    drop.current!.style.setProperty('--wx', `${e.clientX - r.left}px`);
    drop.current!.style.setProperty('--wy', `${e.clientY - r.top}px`);
  };

  const sentEntries = useMemo(() => (sent ? sent.map((u) => ({ id: u.id, title: u.title, collectionId: null, date: u.date, files: u.files })) : []), [sent]);
  const entries = useMemo(() => entriesOf(sentEntries), [sentEntries]);

  return (
    <main className="page" ref={page}>
      <section className="hero" style={{ paddingBottom: 12 }}>
        <h1>
          Send files <span className="soft">to the team.</span>
        </h1>
        <p className="lede">Logos, photos, briefs, references — anything they need. Only your team at the studio sees what you send.</p>
      </section>
      <label
        ref={drop}
        className={`drop${over ? ' over' : ''}`}
        onPointerMove={wave}
        onDragOver={(e) => (e.preventDefault(), wave(e), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
      >
        <span className="drop-wave" />
        <span className="drop-orb" aria-hidden>
          <span className="ring r2" />
          <span className="ring spin">
            <span className="dot" />
          </span>
          <span className="core">
            <IUpload />
          </span>
        </span>
        <h2>{over ? 'Let go to add them' : ready.length ? 'Add more files' : 'Drop files here'}</h2>
        <p>or choose them from your computer. Pictures, videos, PDFs, design files — up to 5 GB each. You can check them before they're sent.</p>
        <span className="btn primary" role="button">
          Choose files
        </span>
        <input ref={input} type="file" multiple onChange={(e) => (add(e.target.files ?? []), (e.target.value = ''))} />
      </label>

      {(ready.length > 0 || problems.length > 0) && (
        <section className="review">
          <div className="review-head">
            <div>
              <h2>Check before sending</h2>
              <p>Take out anything that shouldn't go. Nothing is sent until you press Send.</p>
            </div>
            <button type="button" className="btn ghost sm" onClick={clearReview}>
              Clear all
            </button>
          </div>
          <div className="queue">
            {[...problems, ...ready].map((j) => (
              <div key={j.id} data-job={j.id}>
                <JobRow j={j} onRemove={() => remove(j.id)} />
              </div>
            ))}
          </div>
          <div className="review-foot">
            <span>{ready.length ? `${ready.length} ${ready.length === 1 ? 'file' : 'files'} · ${fmtSize(readySize)}` : 'Nothing to send'}</span>
            <button type="button" className="si-submit review-send" disabled={!ready.length} onClick={send}>
              Send {ready.length || ''} {ready.length === 1 ? 'file' : 'files'}
              <IUpload />
            </button>
          </div>
        </section>
      )}

      {moving.length > 0 && (
        <section className="sending">
          <div className="review-head">
            <h2>{busy ? 'Sending…' : 'Sent'}</h2>
            {!busy && (
              <button type="button" className="btn ghost sm" onClick={clearFinished}>
                Clear
              </button>
            )}
          </div>
          <div className="queue">
            {moving.map((j) => (
              <JobRow key={j.id} j={j} />
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Sent to the team</h2>
          <span>{sent ? `${entries.length} ${entries.length === 1 ? 'file' : 'files'}` : ''}</span>
        </div>
        {!sent ? (
          <div className="masonry">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skel" style={{ height: 180 + (i % 3) * 60, marginBottom: 16 }} />
            ))}
          </div>
        ) : !sentEntries.length ? (
          <p className="muted">Nothing yet. Files you send show up here.</p>
        ) : (
          <div className="masonry">
            {sentEntries.map((it) => (
              <Tile key={it.id} item={it} file={it.files[0]} note="Sent" onOpen={(el) => s.view(entries, entries.findIndex((e) => e.item.id === it.id), el)} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
