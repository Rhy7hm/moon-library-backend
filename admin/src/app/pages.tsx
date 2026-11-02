/* Home, Trash, Insights, Activity, Team and Settings. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { errText, mainFile, nameOf, op, titleOf, type Role } from './api';
import { fmtAgo, fmtDate, fmtSize, greeting, typeOf } from './format';
import { IClock, IDoc, IFolder, IImage, IKey, IPen, IPlus, IPulse, IRestore, ITrash, IUpload, IUsers, IVideo } from './icons';
import { useStore } from './store';
import { AssetCard, Button, ConfirmDialog, Dialog, Empty, FolderGlyph, PageHeader, Segmented, Thumb } from './ui';

/* ---------------- Home ---------------- */

export function HomePage() {
  const s = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<string>('');
  const recent = s.assets.slice(0, 8);
  const week = s.assets.filter((a) => a.date > Date.now() - 7 * 864e5).length;
  const total = s.assets.reduce((n, a) => n + (mainFile(a)?.size ?? 0), 0);
  const byType = useMemo(() => {
    const c = { image: 0, video: 0, document: 0, design: 0, other: 0 };
    for (const a of s.assets) c[typeOf(mainFile(a))]++;
    return c;
  }, [s.assets]);
  const top = s.children(null);

  return (
    <div className="page">
      <PageHeader title={greeting(s.me.name)} sub={week ? `${week} new ${week === 1 ? 'file' : 'files'} this week across ${top.length} ${top.length === 1 ? 'folder' : 'folders'}.` : 'Here’s your library at a glance.'} />

      <div className="stats">
        <button className="stat" onClick={() => s.go({ page: 'folder', id: null })}>
          <span className="stat-icon blue"><IFolder /></span>
          <strong>{s.assets.length}</strong>
          <small>files · {fmtSize(total)}</small>
        </button>
        <button className="stat" onClick={() => s.go({ page: 'recent' })}>
          <span className="stat-icon green"><IClock /></span>
          <strong>{week}</strong>
          <small>added this week</small>
        </button>
        <button className="stat" onClick={() => s.go({ page: 'folder', id: null })}>
          <span className="stat-icon gray"><IFolder /></span>
          <strong>{s.folders.length}</strong>
          <small>{s.folders.length === 1 ? 'folder' : 'folders'}</small>
        </button>
        <div className="stat types">
          <span title="Images"><IImage /> {byType.image}</span>
          <span title="Videos"><IVideo /> {byType.video}</span>
          <span title="Documents"><IDoc /> {byType.document}</span>
          <span title="Design files"><IPen /> {byType.design}</span>
        </div>
      </div>

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

export function TrashPage() {
  const s = useStore();
  const [ask, setAsk] = useState<null | { all: true } | { folderIds: string[]; itemIds: string[]; label: string }>(null);
  const rows = [
    ...s.trashFolders.map((f) => ({ key: 'f' + f.id, at: f.deletedAt!, folder: f, asset: null })),
    ...s.trashAssets.map((a) => ({ key: 'i' + a.id, at: a.deletedAt!, folder: null, asset: a })),
  ].sort((a, b) => b.at - a.at);
  const daysLeft = (at: number) => Math.max(0, 90 - Math.floor((Date.now() - at) / 864e5));

  return (
    <div className="page">
      <PageHeader
        title="Trash"
        sub="Deleted files and folders stay here for 90 days, then they’re removed for good."
        actions={s.isOwner && rows.length > 0 && <Button kind="danger" icon={<ITrash />} onClick={() => setAsk({ all: true })}>Empty Trash</Button>}
      />
      {!rows.length ? (
        <Empty icon={<ITrash />} title="Trash is empty" text="Anything you delete shows up here first, so it can be put back." />
      ) : (
        <div className="list-card">
          {rows.map((r) => (
            <div className="list-row" key={r.key}>
              <span className="list-thumb">{r.asset ? <Thumb asset={r.asset} /> : <FolderGlyph f={r.folder!} />}</span>
              <span className="list-text">
                <strong>{r.asset ? titleOf(r.asset) : nameOf(r.folder!)}</strong>
                <small>
                  {r.asset ? 'File' : 'Folder'} · deleted {fmtAgo(r.at)} · {daysLeft(r.at)} days left
                </small>
              </span>
              {s.canEdit && (
                <Button size="sm" icon={<IRestore />} onClick={() => s.run('restore', { folderIds: r.folder ? [r.folder.id] : [], itemIds: r.asset ? [r.asset.id] : [] }, 'Restored')}>
                  Restore
                </Button>
              )}
              {s.isOwner && (
                <Button
                  size="sm"
                  kind="plain"
                  onClick={() =>
                    setAsk({ folderIds: r.folder ? [r.folder.id] : [], itemIds: r.asset ? [r.asset.id] : [], label: r.asset ? titleOf(r.asset) : nameOf(r.folder!) })
                  }
                >
                  Delete now
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {ask && (
        <ConfirmDialog
          title={'all' in ask ? 'Empty Trash?' : 'Delete for good?'}
          text={'all' in ask ? 'Everything in the Trash is removed permanently. This can’t be undone.' : `“${ask.label}” is removed permanently. This can’t be undone.`}
          action={'all' in ask ? 'Empty Trash' : 'Delete'}
          danger
          onClose={() => setAsk(null)}
          onConfirm={() => {
            const body = 'all' in ask ? { all: true, folderIds: [], itemIds: [] } : { folderIds: ask.folderIds, itemIds: ask.itemIds };
            setAsk(null);
            s.run('purge', body, 'Deleted for good');
          }}
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

type User = { id: string; username: string; name: string; role: Role; disabled: number; last_login_at: number | null; sessions: number };
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
      <PageHeader title="Team" sub="People who can sign in to this library." actions={s.isOwner && <Button kind="primary" icon={<IPlus />} onClick={() => setAdding(true)}>Add person</Button>} />
      {!users ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="list-card">
          {users.map((u) => (
            <div className="list-row" key={u.id}>
              <span className="avatar">{u.name.slice(0, 1).toUpperCase()}</span>
              <span className="list-text">
                <strong>
                  {u.name} {u.id === s.me.id && <em className="you">You</em>}
                </strong>
                <small>
                  @{u.username} · {u.last_login_at ? `last signed in ${fmtAgo(u.last_login_at)}` : 'never signed in'}
                  {u.disabled ? ' · turned off' : ''}
                </small>
              </span>
              {s.isOwner && u.id !== s.me.id ? (
                <select className="select" value={u.role} aria-label="Role" onChange={(e) => s.run('users.update', { id: u.id, role: e.target.value }, 'Role changed').then(load)}>
                  <option value="owner">Owner</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              ) : (
                <span className="role-pill">{u.role[0].toUpperCase() + u.role.slice(1)}</span>
              )}
              {s.isOwner && u.id !== s.me.id && (
                <Button
                  size="sm"
                  kind="plain"
                  icon={<IKey />}
                  onClick={async () => {
                    const pw = newPassword();
                    if (await s.run('users.password', { id: u.id, password: pw }, 'New password set')) setMade({ username: u.username, password: pw });
                  }}
                >
                  Reset password
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="role-help">
        {(Object.keys(ROLE_TEXT) as Role[]).map((r) => (
          <p key={r}>
            <IUsers /> {ROLE_TEXT[r]}
          </p>
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
            <div><span>Address</span><b>{location.origin}/admin</b></div>
            <div><span>ID</span><b>{made.username}</b></div>
            <div><span>Password</span><b>{made.password}</b></div>
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
