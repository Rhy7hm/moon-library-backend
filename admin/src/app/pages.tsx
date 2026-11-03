/* Home, Trash, Insights, Activity, Team and Settings. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { assetSize, errText, mainFile, nameOf, op, titleOf, type Asset, type Client, type Folder, type Role } from './api';
import { fmtAgo, fmtDate, fmtSize, greeting, typeOf } from './format';
import { IChevD, IDoc, IImage, IKey, ILock, IPen, IPlus, IPulse, IRestore, ITrash, IUnlock, IUpload, IVideo } from './icons';
import { ClientAvatar } from './clients';
import { shatter } from './shatter';
import { ShredDialog, type ShredItem } from './shredder';
import { useStore } from './store';
import { AssetCard, Button, ConfirmDialog, CopyButton, Dialog, Empty, FolderGlyph, MenuButton, PageHeader, Segmented, Thumb, UserAvatar, type MenuItem } from './ui';

/* ---------------- Home ---------------- */

// the kinds of file in the overview's bar, with calm colours that work in light and dark
const MIX = [
  { key: 'image', label: 'Images', color: '#4c8dff' },
  { key: 'video', label: 'Videos', color: '#9b7bff' },
  { key: 'design', label: 'Design files', color: '#ff7a59' },
  { key: 'document', label: 'Documents', color: '#f5b83d' },
  { key: 'other', label: 'Other', color: '#a1a1aa' },
] as const;

export function HomePage() {
  const s = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<string>('');
  const recent = s.assets.slice(0, 8);
  const week = s.assets.filter((a) => a.date > Date.now() - 7 * 864e5).length;
  const total = s.assets.reduce((n, a) => n + (mainFile(a)?.size ?? 0), 0);
  const lastWeek = s.assets.filter((a) => a.date <= Date.now() - 7 * 864e5 && a.date > Date.now() - 14 * 864e5).length;
  // how many files of each kind, and how much space each takes
  const byType = useMemo(() => {
    const c = Object.fromEntries(MIX.map((m) => [m.key, { n: 0, size: 0 }])) as Record<(typeof MIX)[number]['key'], { n: number; size: number }>;
    for (const a of s.assets) {
      const t = c[typeOf(mainFile(a))];
      t.n++;
      t.size += mainFile(a)?.size ?? 0;
    }
    return c;
  }, [s.assets]);
  const sharedFolders = new Set(s.clients.flatMap((c) => c.shares.filter((x) => x.kind === 'folder').map((x) => x.targetId))).size;
  const delta = week - lastWeek;
  const top = s.children(null);

  return (
    <div className="page">
      <PageHeader title={greeting(s.me.name)} sub={week ? `${week} new ${week === 1 ? 'file' : 'files'} this week across ${top.length} ${top.length === 1 ? 'folder' : 'folders'}.` : 'Here’s your library at a glance.'} />

      <section className="overview" aria-label="Library overview">
        <div className="ov-metrics">
          <button className="ov-metric" onClick={() => s.go({ page: 'folder', id: null })}>
            <span className="ov-label">Files</span>
            <span className="ov-value">{s.assets.length.toLocaleString()}</span>
            <span className="ov-sub">{fmtSize(total)} in total</span>
          </button>
          <button className="ov-metric" onClick={() => s.go({ page: 'recent' })}>
            <span className="ov-label">Added this week</span>
            <span className="ov-value">{week.toLocaleString()}</span>
            <span className={`ov-sub${delta > 0 ? ' up' : delta < 0 ? ' down' : ''}`}>
              {!lastWeek && !week ? 'Nothing new yet' : delta === 0 ? 'Same as last week' : `${delta > 0 ? '+' : '−'}${Math.abs(delta)} vs last week`}
            </span>
          </button>
          <button className="ov-metric" onClick={() => s.go({ page: 'folder', id: null })}>
            <span className="ov-label">Folders</span>
            <span className="ov-value">{s.folders.length.toLocaleString()}</span>
            <span className="ov-sub">{sharedFolders ? `${sharedFolders} shared with clients` : 'None shared with clients'}</span>
          </button>
        </div>
        {s.assets.length > 0 && (
          <div className="ov-mix">
            <div className="ov-bar" role="img" aria-label={MIX.filter((m) => byType[m.key].n).map((m) => `${byType[m.key].n} ${m.label.toLowerCase()}`).join(', ')}>
              {MIX.filter((m) => byType[m.key].size > 0).map((m) => (
                <i key={m.key} style={{ flexGrow: byType[m.key].size, background: m.color }} title={`${m.label}: ${fmtSize(byType[m.key].size)}`} />
              ))}
            </div>
            <ul className="ov-legend">
              {MIX.filter((m) => byType[m.key].n > 0).map((m) => (
                <li key={m.key}>
                  <span className="ov-dot" style={{ background: m.color }} />
                  <span>{m.label}</span>
                  <b>{byType[m.key].n}</b>
                  <small>{fmtSize(byType[m.key].size)}</small>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {s.canEdit && top.length > 0 && (
        <div className="quick-upload">
          <div className="quick-icon"><IUpload /></div>
          <div className="quick-text">
            <strong>Quick upload</strong>
            <span>Pick a folder, then choose files. Previews and ad formats are detected automatically.</span>
          </div>
          <select className="select" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Upload to folder">
            <option value="">Choose a folder…</option>
            {s.folders.map((f) => (
              <option key={f.id} value={f.id}>
                {s.path(f.id).map(nameOf).join(' › ')}
              </option>
            ))}
          </select>
          <Button kind="primary" disabled={!target} onClick={() => input.current?.click()}>
            Choose files
          </Button>
          <input ref={input} type="file" multiple hidden onChange={(e) => (s.upload(Array.from(e.target.files ?? []), target), (e.target.value = ''))} />
        </div>
      )}

      <section>
        <div className="section-row">
          <h2 className="section-title">Recently added</h2>
          {recent.length > 0 && (
            <Button size="sm" kind="plain" onClick={() => s.go({ page: 'recent' })}>
              See all
            </Button>
          )}
        </div>
        {recent.length ? (
          <div className="grid">
            {recent.map((a) => (
              <AssetCard key={a.id} asset={a} selected={false} selecting={false} onToggle={() => s.openSheet(a.id)} onOpen={() => s.openSheet(a.id)} menu={[]} where={s.path(a.folderId).map(nameOf).join(' › ')} />
            ))}
          </div>
        ) : (
          <Empty
            icon={<IUpload />}
            title="No files yet"
            text="Create a folder for a client or campaign, then drop files into it."
            action={s.canEdit && <Button kind="primary" icon={<IPlus />} onClick={() => s.go({ page: 'folder', id: null })}>Go to Library</Button>}
          />
        )}
      </section>

      {top.length > 0 && (
        <section>
          <h2 className="section-title">Folders</h2>
          <div className="chips">
            {top.map((f) => (
              <button key={f.id} className="chip" onClick={() => s.go({ page: 'folder', id: f.id })}>
                <FolderGlyph f={f} small />
                {nameOf(f)}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ---------------- Trash ---------------- */

const KIND = { image: 'Image', video: 'Video', document: 'Document', design: 'Design file', other: 'File' } as const;

export function TrashPage() {
  const s = useStore();
  const [shred, setShred] = useState<null | { all: true } | { folderIds: string[]; itemIds: string[]; clientIds: string[]; item: ShredItem }>(null);
  // what the shredder just deleted: its rows break like glass once the window closes, and only then
  // does the list reload (reloading straight away would make them blink out behind the window)
  const purged = useRef<string[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const afterShred = async () => {
    const keys = purged.current;
    purged.current = null;
    setShred(null);
    if (!keys) return;
    const els = keys.map((k) => listRef.current?.querySelector<HTMLElement>(`[data-key="${k}"]`)).filter((x): x is HTMLElement => !!x);
    // several rows: each breaks a moment after the one above
    await Promise.all(els.map((el, i) => new Promise<void>((done) => setTimeout(() => shatter(el, els.length > 1 ? { cols: 6, rows: 2 } : {}).then(done), i * 90))));
    s.toast('Deleted for good', { tone: 'ok' });
    await s.reload();
  };
  const rows: { key: string; at: number; folder: Folder | null; asset: Asset | null; client: Client | null }[] = [
    ...s.trashFolders.map((f) => ({ key: 'f' + f.id, at: f.deletedAt!, folder: f, asset: null, client: null })),
    ...s.trashAssets.map((a) => ({ key: 'i' + a.id, at: a.deletedAt!, folder: null, asset: a, client: null })),
    ...s.trashClients.map((c) => ({ key: 'c' + c.id, at: c.deletedAt!, folder: null, asset: null, client: c })),
  ].sort((a, b) => b.at - a.at);
  // removed clients can only be restored or deleted for good by an Owner
  const canTouch = (r: (typeof rows)[number]) => s.canEdit && (!r.client || s.isOwner);
  const daysLeft = (at: number) => Math.max(0, 90 - Math.floor((Date.now() - at) / 864e5));
  const sizeOf = (r: (typeof rows)[number]) => (r.asset ? assetSize(r.asset) : 0);
  const total = rows.reduce((n, r) => n + sizeOf(r), 0);
  const soonest = rows.length ? Math.min(...rows.map((r) => daysLeft(r.at))) : 0;
  const ids = (list: typeof rows) => ({
    folderIds: list.flatMap((r) => (r.folder ? [r.folder.id] : [])),
    itemIds: list.flatMap((r) => (r.asset ? [r.asset.id] : [])),
    clientIds: list.flatMap((r) => (r.client ? [r.client.id] : [])),
  });
  const restore = (list: typeof rows, label: string) => s.run('restore', ids(list.filter(canTouch)), label);
  const nameRow = (r: (typeof rows)[number]) => (r.asset ? titleOf(r.asset) : r.client ? r.client.name : nameOf(r.folder!));
  const thumbRow = (r: (typeof rows)[number]) => (r.asset ? <Thumb asset={r.asset} /> : r.client ? <ClientAvatar c={r.client} size={40} /> : <FolderGlyph f={r.folder!} />);
  const kindRow = (r: (typeof rows)[number]) =>
    r.asset ? KIND[typeOf(mainFile(r.asset))] : r.client ? `Client · ${r.client.logins.length} ${r.client.logins.length === 1 ? 'login' : 'logins'} · ${r.client.shares.length} shared` : 'Folder';

  // newest first, in three groups
  const day = 864e5;
  const groups = [
    { label: 'Today', rows: rows.filter((r) => Date.now() - r.at < day) },
    { label: 'This week', rows: rows.filter((r) => Date.now() - r.at >= day && Date.now() - r.at < 7 * day) },
    { label: 'Earlier', rows: rows.filter((r) => Date.now() - r.at >= 7 * day) },
  ].filter((g) => g.rows.length);

  return (
    <div className="page">
      <PageHeader
        title="Trash"
        sub="Deleted files, folders and clients stay here for 90 days, then they’re removed for good."
        actions={
          s.isOwner &&
          rows.length > 0 && (
            <Button kind="danger" icon={<ITrash />} onClick={() => setShred({ all: true })}>
              Empty Trash
            </Button>
          )
        }
      />
      {!rows.length ? (
        <Empty icon={<ITrash />} title="Trash is empty" text="Anything you delete shows up here first, so it can be put back." />
      ) : (
        <div ref={listRef}>
          <div className="trash-sum">
            <span>
              <b>{rows.length}</b> {rows.length === 1 ? 'item' : 'items'}
              {total > 0 && <> · {fmtSize(total)}</>} · the next one is removed in <b>{soonest}</b> {soonest === 1 ? 'day' : 'days'}
            </span>
            {s.canEdit && rows.length > 1 && (
              <Button size="sm" icon={<IRestore />} onClick={() => restore(rows, `Restored ${rows.filter(canTouch).length} items`)}>
                Restore all
              </Button>
            )}
          </div>
          {groups.map((g) => (
            <section key={g.label} className="trash-group">
              <h3 className="trash-group-label">{g.label}</h3>
              <div className="list-card">
                {g.rows.map((r) => {
                  const left = daysLeft(r.at);
                  return (
                    <div className={`list-row trash-row${left <= 7 ? ' soon' : ''}`} key={r.key} data-key={r.key}>
                      <span className="list-thumb">{thumbRow(r)}</span>
                      <span className="list-text">
                        <strong>{nameRow(r)}</strong>
                        <small>
                          {kindRow(r)}
                          {sizeOf(r) > 0 && <> · {fmtSize(sizeOf(r))}</>} · {r.client ? 'removed' : 'deleted'} {fmtAgo(r.at)}
                        </small>
                      </span>
                      <span className="trash-left" title={`Removed for good in ${left} day${left === 1 ? '' : 's'}`}>
                        <span className="trash-meter">
                          <i style={{ width: `${(left / 90) * 100}%` }} />
                        </span>
                        <small>{left} days left</small>
                      </span>
                      <span className="trash-actions">
                        {canTouch(r) && (
                          <Button size="sm" icon={<IRestore />} onClick={() => restore([r], r.client ? `${r.client.name} is back — their logins work again` : 'Restored')}>
                            Restore
                          </Button>
                        )}
                        {/* Owners and Editors can delete one thing for good (clients: Owners); emptying all of the Trash is Owner-only */}
                        {canTouch(r) && (
                          <Button
                            size="sm"
                            kind="danger"
                            icon={<ITrash />}
                            onClick={() =>
                              setShred({
                                ...ids([r]),
                                item: {
                                  title: nameRow(r),
                                  meta: r.asset ? `${KIND[typeOf(mainFile(r.asset))]} · ${fmtSize(sizeOf(r))}` : r.client ? 'Client, logins and share list — their files stay in the library' : 'Folder and everything in it',
                                  thumb: thumbRow(r),
                                },
                              })
                            }
                          >
                            Delete now
                          </Button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      {shred && (
        <ShredDialog
          title={'all' in shred ? 'Empty Trash?' : 'Delete for good?'}
          item={
            'all' in shred
              ? {
                  title: 'Everything in Trash',
                  meta: `${rows.length} ${rows.length === 1 ? 'item' : 'items'}${total ? ` · ${fmtSize(total)}` : ''}`,
                  thumb: rows[0] ? thumbRow(rows[0]) : <ITrash />,
                  stack: rows.length > 1 ? rows.length : undefined,
                }
              : shred.item
          }
          onShred={async () => {
            const body = 'all' in shred ? { all: true, folderIds: [], itemIds: [] } : { folderIds: shred.folderIds, itemIds: shred.itemIds, clientIds: shred.clientIds };
            try {
              await op('purge', body); // not s.run: that reloads the list at once
              purged.current = 'all' in shred ? rows.map((r) => r.key) : [...shred.folderIds.map((id) => 'f' + id), ...shred.itemIds.map((id) => 'i' + id), ...shred.clientIds.map((id) => 'c' + id)];
              return true;
            } catch (e) {
              s.toast(errText(e), { tone: 'err' });
              return false;
            }
          }}
          onClose={afterShred}
        />
      )}
    </div>
  );
}

/* ---------------- Insights ---------------- */

type StorageReport = { live: { files: number; orig: number; opt: number }; trash: { files: number; bytes: number }; versions: { files: number; bytes: number }; months: { month: string; files: number; bytes: number }[] };

export function InsightsPage() {
  const s = useStore();
  const [r, setR] = useState<StorageReport | null>(null);
  useEffect(() => {
    op<StorageReport>('reports.storage', {}).then(setR, (e) => s.toast(errText(e), { tone: 'err' }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const byType = useMemo(() => {
    const c: Record<string, { n: number; bytes: number }> = {};
    for (const a of s.assets) {
      const f = mainFile(a);
      const t = typeOf(f);
      c[t] = { n: (c[t]?.n ?? 0) + 1, bytes: (c[t]?.bytes ?? 0) + (f?.size ?? 0) };
    }
    return c;
  }, [s.assets]);
  const total = r ? r.live.orig + r.live.opt + r.trash.bytes + r.versions.bytes : 0;
  const parts = r
    ? [
        { label: 'Files', bytes: r.live.orig, color: 'var(--blue)' },
        { label: 'Preview copies', bytes: r.live.opt, color: 'var(--teal)' },
        { label: 'Old versions', bytes: r.versions.bytes, color: 'var(--orange)' },
        { label: 'Trash', bytes: r.trash.bytes, color: 'var(--gray)' },
      ]
    : [];
  const maxMonth = Math.max(1, ...(r?.months.map((m) => m.bytes) ?? [1]));
  const TYPES: [string, string, React.ReactNode][] = [
    ['image', 'Images', <IImage key="i" />],
    ['video', 'Videos', <IVideo key="v" />],
    ['document', 'Documents', <IDoc key="d" />],
    ['design', 'Design files', <IPen key="p" />],
  ];

  return (
    <div className="page">
      <PageHeader title="Insights" sub="How much is stored, what kind of files, and how the library is growing." />
      {!r ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="panel">
            <div className="panel-head">
              <h3>Storage</h3>
              <strong className="big">{fmtSize(total)}</strong>
            </div>
            <div className="meter" role="img" aria-label="Storage by kind">
              {parts.map((p) => (
                <i key={p.label} style={{ flexGrow: Math.max(p.bytes, total * 0.004), background: p.color }} title={`${p.label}: ${fmtSize(p.bytes)}`} />
              ))}
            </div>
            <ul className="legend">
              {parts.map((p) => (
                <li key={p.label}>
                  <span style={{ background: p.color }} />
                  {p.label}
                  <b>{fmtSize(p.bytes)}</b>
                </li>
              ))}
            </ul>
          </div>
          <div className="two">
            <div className="panel">
              <h3>By type</h3>
              <ul className="rows">
                {TYPES.map(([k, label, icon]) => (
                  <li key={k}>
                    <span className="row-icon">{icon}</span>
                    {label}
                    <b>{byType[k]?.n ?? 0}</b>
                    <small>{fmtSize(byType[k]?.bytes ?? 0)}</small>
                  </li>
                ))}
              </ul>
            </div>
            <div className="panel">
              <h3>Added per month</h3>
              {r.months.length ? (
                <div className="bars">
                  {r.months.slice(-12).map((m) => (
                    <div key={m.month} className="bar" title={`${m.files} files · ${fmtSize(m.bytes)}`}>
                      <i style={{ height: `${Math.max(4, (m.bytes / maxMonth) * 100)}%` }} />
                      <small>{new Date(m.month + '-01T00:00:00').toLocaleDateString(undefined, { month: 'short' })}</small>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">Nothing uploaded yet.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- Activity ---------------- */

type Entry = { id: number; at: number; username: string | null; action: string; summary: string; undoable: boolean; undone_at: number | null };

export function ActivityPage() {
  const s = useStore();
  const [kind, setKind] = useState<'content' | 'security'>('content');
  const [list, setList] = useState<Entry[] | null>(null);
  const load = () =>
    op<{ entries: Entry[] }>('audit.list', { kind, limit: 200 }).then(
      (r) => setList(r.entries),
      (e) => s.toast(errText(e), { tone: 'err' }),
    );
  useEffect(() => {
    setList(null);
    load();
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => {
    const g: [string, Entry[]][] = [];
    for (const e of list ?? []) {
      const d = fmtDate(e.at);
      if (!g.length || g[g.length - 1][0] !== d) g.push([d, []]);
      g[g.length - 1][1].push(e);
    }
    return g;
  }, [list]);
  return (
    <div className="page">
      <PageHeader
        title="Activity"
        sub="Every change, who made it and when. Most changes can be undone."
        actions={
          <Segmented
            label="Log"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'content', label: 'Files' },
              { value: 'security', label: 'Sign-ins' },
            ]}
          />
        }
      />
      {list === null ? (
        <p className="muted">Loading…</p>
      ) : !list.length ? (
        <Empty icon={<IPulse />} title="No activity yet" text="Uploads, edits and deletions will be listed here." />
      ) : (
        groups.map(([day, es]) => (
          <section key={day}>
            <h2 className="section-title">{day}</h2>
            <div className="list-card">
              {es.map((e) => (
                <div className={`list-row${e.undone_at ? ' undone' : ''}`} key={e.id}>
                  <span className="avatar sm">{(e.username || '?').slice(0, 1).toUpperCase()}</span>
                  <span className="list-text">
                    <strong>{e.summary}</strong>
                    <small>
                      {e.username || 'System'} · {new Date(e.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      {e.undone_at ? ' · undone' : ''}
                    </small>
                  </span>
                  {e.undoable && s.canEdit && (
                    <Button size="sm" kind="plain" onClick={async () => (await s.run('audit.undo', { id: e.id }, 'Undone'), load())}>
                      Undo
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

/* ---------------- Team ---------------- */

type User = { id: string; username: string; name: string; role: Role; disabled: number; last_login_at: number | null; sessions: number; avatarKey?: string | null };
const ROLE_INFO: Record<Role, string> = { owner: 'Everything, including the team, Trash and settings', editor: 'Upload, organise, share and delete', viewer: 'Browse and download only' };
const ROLE_TEXT: Record<Role, string> = { owner: 'Owner — everything, including team and Trash', editor: 'Editor — upload, organise and delete', viewer: 'Viewer — browse and download only' };

export function TeamPage() {
  const s = useStore();
  const [users, setUsers] = useState<User[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [made, setMade] = useState<{ username: string; password: string } | null>(null);
  const load = () => op<{ users: User[] }>('users.list', {}).then((r) => setUsers(r.users), (e) => s.toast(errText(e), { tone: 'err' }));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const newPassword = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const a = crypto.getRandomValues(new Uint32Array(14));
    return Array.from(a, (x) => chars[x % chars.length]).join('');
  };

  return (
    <div className="page">
      <PageHeader
        title="Team"
        sub={users ? `${users.length} ${users.length === 1 ? 'person' : 'people'}${users.some((u) => u.disabled) ? ` · ${users.filter((u) => u.disabled).length} turned off` : ''} — who can sign in to this library.` : 'People who can sign in to this library.'}
        actions={s.isOwner && <Button kind="primary" icon={<IPlus />} onClick={() => setAdding(true)}>Add person</Button>}
      />
      {!users ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="list-card team-list">
          {[...users]
            .sort((a, b) => Number(!!a.disabled) - Number(!!b.disabled) || Number(b.id === s.me.id) - Number(a.id === s.me.id))
            .map((u) => {
              const mine = u.id === s.me.id;
              const manage = s.isOwner && !mine;
              const menu: MenuItem[] = [
                {
                  label: 'Reset password',
                  icon: <IKey />,
                  onClick: async () => {
                    const pw = newPassword();
                    if (await s.run('users.password', { id: u.id, password: pw }, 'New password set')) setMade({ username: u.username, password: pw });
                  },
                },
                'sep',
                {
                  label: u.disabled ? 'Turn on — can sign in again' : 'Turn off — signs them out',
                  icon: u.disabled ? <IUnlock /> : <ILock />,
                  danger: !u.disabled,
                  onClick: async () => {
                    const off = !u.disabled;
                    if (await s.run('users.update', { id: u.id, disabled: off }, off ? `${u.name} is signed out and can't sign in` : `${u.name} can sign in again`)) load();
                  },
                },
              ];
              return (
                <div className={`list-row team-row${u.disabled ? ' is-off' : ''}`} key={u.id}>
                  <UserAvatar user={u} />
                  <span className="list-text">
                    <strong>
                      {u.name}
                      {mine && <em className="you">You</em>}
                      {!!u.disabled && <em className="off-badge">Turned off</em>}
                    </strong>
                    <small>
                      @{u.username} · {u.last_login_at ? `last signed in ${fmtAgo(u.last_login_at)}` : 'never signed in'}
                    </small>
                  </span>
                  {manage ? (
                    <label className="role-select">
                      <select value={u.role} aria-label={`Role for ${u.name}`} onChange={(e) => s.run('users.update', { id: u.id, role: e.target.value }, 'Role changed').then(load)}>
                        <option value="owner">Owner</option>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <IChevD />
                    </label>
                  ) : (
                    <span className="role-pill">{u.role[0].toUpperCase() + u.role.slice(1)}</span>
                  )}
                  {manage ? <MenuButton items={menu} label={`More for ${u.name}`} /> : <span className="team-menu-gap" />}
                </div>
              );
            })}
        </div>
      )}
      <div className="role-cards">
        {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
          <div key={r}>
            <b>{r[0].toUpperCase() + r.slice(1)}</b>
            <span>{ROLE_INFO[r]}</span>
          </div>
        ))}
      </div>
      {adding && (
        <AddPerson
          onClose={() => setAdding(false)}
          onAdd={async (b) => {
            const pw = newPassword();
            if (await s.run('users.create', { ...b, password: pw }, `Added ${b.name}`)) {
              setAdding(false);
              setMade({ username: b.username, password: pw });
              load();
            }
          }}
        />
      )}
      {made && (
        <Dialog title="Share these sign-in details" onClose={() => setMade(null)} footer={<Button kind="primary" onClick={() => setMade(null)}>Done</Button>}>
          <p className="muted">Send them privately. They can change the password in Settings after signing in. It isn’t shown again.</p>
          <div className="cred">
            <div>
              <span>Address</span>
              <span className="cred-value">
                <b>{location.origin}/admin</b>
                <CopyButton value={`${location.origin}/admin`} label="Copy address" toastText="Address copied" />
              </span>
            </div>
            <div>
              <span>ID</span>
              <span className="cred-value">
                <b>{made.username}</b>
                <CopyButton value={made.username} label="Copy ID" toastText="ID copied" />
              </span>
            </div>
            <div>
              <span>Password</span>
              <span className="cred-value">
                <b>{made.password}</b>
                <CopyButton value={made.password} label="Copy password" toastText="Password copied" />
              </span>
            </div>
          </div>
          <Button onClick={() => navigator.clipboard?.writeText(`${location.origin}/admin\nID: ${made.username}\nPassword: ${made.password}`).then(() => s.toast('Copied', { tone: 'ok' }))}>Copy</Button>
        </Dialog>
      )}
    </div>
  );
}

function AddPerson({ onClose, onAdd }: { onClose: () => void; onAdd: (b: { name: string; username: string; role: Role }) => void }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const valid = name.trim() && /^[a-z0-9._-]{3,40}$/.test(username);
  return (
    <Dialog
      title="Add person"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!valid} onClick={() => onAdd({ name: name.trim(), username, role })}>
            Add
          </Button>
        </>
      }
    >
      <label className="field">
        <span>Name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aina Rahman" />
      </label>
      <label className="field">
        <span>Sign-in ID</span>
        <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))} placeholder="e.g. aina" />
        <small>3–40 letters, numbers, dot, dash or underscore.</small>
      </label>
      <label className="field">
        <span>Role</span>
        <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
          <option value="owner">Owner</option>
        </select>
        <small>{ROLE_TEXT[role]}</small>
      </label>
    </Dialog>
  );
}
