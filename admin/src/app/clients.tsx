/*
 * Clients: who they are, and what is shared with each of them (folders, files, links).
 * The client website (moon-library-client) shows each client their shared things; here the team
 * decides what that is, makes their logins, and sees the files they sent ("From the client").
 */
import { useMemo, useState } from 'react';
import { mainFile, nameOf, titleOf, type Asset, type Client, type ClientLogin, type Folder, type Share } from './api';
import { fmtAgo, fmtDate } from './format';
import { IBriefcase, ICheck, IChevR, IExternal, IFolder, IKey, ILink, IPencil, IPlus, ISearch, IShare, ITrash, IUsers, IX } from './icons';
import { useStore } from './store';
import { AssetCard, Button, ConfirmDialog, Dialog, Empty, FolderGlyph, PageHeader, Segmented, Thumb, type MenuItem } from './ui';

const COLORS = ['#0a84ff', '#30b0c7', '#34c759', '#ff9f0a', '#ff375f', '#bf5af2', '#5e5ce6', '#8e8e93'];
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

export function ClientAvatar({ c, size = 40 }: { c: Pick<Client, 'name' | 'color'>; size?: number }) {
  return (
    <span className="client-avatar" style={{ ['--c' as string]: c.color || '#8e8e93', width: size, height: size, fontSize: size * 0.38 }}>
      {initials(c.name)}
    </span>
  );
}

/** What a client will see: files inside shared folders (and sub-folders), shared files, links. */
function useShareSummary(c: Client) {
  const s = useStore();
  return useMemo(() => {
    const folders = c.shares.filter((x) => x.kind === 'folder');
    const inside = new Set<string>();
    const walk = (id: string) => {
      for (const a of s.assetsIn(id)) inside.add(a.id);
      for (const k of s.children(id)) walk(k.id);
    };
    for (const f of folders) if (f.targetId) walk(f.targetId);
    for (const x of c.shares) if (x.kind === 'item' && x.targetId && s.assets.some((a) => a.id === x.targetId)) inside.add(x.targetId);
    return { folders: folders.length, files: inside.size, links: c.shares.filter((x) => x.kind === 'link').length };
  }, [c, s]);
}

/* ---------------- list ---------------- */

export function ClientsPage() {
  const s = useStore();
  const [editing, setEditing] = useState<Client | 'new' | null>(null);
  const [q, setQ] = useState('');
  const list = s.clients.filter((c) => !q.trim() || `${c.name} ${c.email ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="page">
      <PageHeader
        title="Clients"
        sub="Choose what each client can see — folders, single files or links. The client website will show them exactly this."
        actions={s.canEdit && <Button kind="primary" icon={<IPlus />} onClick={() => setEditing('new')}>New client</Button>}
      />
      {s.clients.length > 6 && (
        <label className="search inline">
          <ISearch />
          <input type="search" placeholder="Find a client" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      )}
      {!s.clients.length ? (
        <Empty
          icon={<IBriefcase />}
          title="No clients yet"
          text="Add a client, then share the folders, files and links they should see."
          action={s.canEdit && <Button kind="primary" icon={<IPlus />} onClick={() => setEditing('new')}>New client</Button>}
        />
      ) : (
        <div className="clients">
          {list.map((c) => (
            <ClientCard key={c.id} c={c} onOpen={() => s.go({ page: 'client', id: c.id })} />
          ))}
        </div>
      )}
      {editing && <ClientDialog client={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ClientCard({ c, onOpen }: { c: Client; onOpen: () => void }) {
  const sum = useShareSummary(c);
  return (
    <button className="client-card" onClick={onOpen}>
      <ClientAvatar c={c} size={44} />
      <span className="client-card-text">
        <strong>{c.name}</strong>
        <small>{c.email || 'No email'}</small>
      </span>
      <span className="client-card-stats">
        <span>
          <b>{sum.files}</b> {sum.files === 1 ? 'file' : 'files'}
        </span>
        <span>
          <b>{sum.folders}</b> {sum.folders === 1 ? 'folder' : 'folders'}
        </span>
        <span>
          <b>{sum.links}</b> {sum.links === 1 ? 'link' : 'links'}
        </span>
      </span>
      <IChevR className="client-card-go" />
    </button>
  );
}

/* ---------------- one client ---------------- */

export function ClientPage({ id }: { id: string }) {
  const s = useStore();
  const c = s.clients.find((x) => x.id === id);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  if (!c) {
    return (
      <Empty icon={<IBriefcase />} title="Client not found" text="They may have been removed." action={<Button onClick={() => s.go({ page: 'clients' })}>All clients</Button>} />
    );
  }
  return <ClientBody c={c} onEdit={() => setEditing(true)} onAdd={() => setAdding(true)} onDelete={() => setDeleting(true)} modals={
    <>
      {editing && <ClientDialog client={c} onClose={() => setEditing(false)} />}
      {adding && <SharePicker client={c} onClose={() => setAdding(false)} />}
      {deleting && (
        <ConfirmDialog
          title={`Remove ${c.name}?`}
          text="The client and their share list are removed. Nothing is deleted from the library."
          action="Remove client"
          danger
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            setDeleting(false);
            if (await s.run('clients.delete', { id: c.id }, `Removed ${c.name}`)) s.go({ page: 'clients' });
          }}
        />
      )}
    </>
  } />;
}

function ClientBody({ c, onEdit, onAdd, onDelete, modals }: { c: Client; onEdit: () => void; onAdd: () => void; onDelete: () => void; modals: React.ReactNode }) {
  const s = useStore();
  const sum = useShareSummary(c);
  const folders = c.shares.filter((x) => x.kind === 'folder');
  const items = c.shares.filter((x) => x.kind === 'item');
  const links = c.shares.filter((x) => x.kind === 'link');
  const remove = (sh: Share, label: string) => s.run('shares.remove', { clientId: c.id, ids: [sh.id] }, `Stopped sharing “${label}”`);

  return (
    <div className="page">
      <nav className="crumbs" aria-label="Path">
        <button onClick={() => s.go({ page: 'clients' })}>Clients</button>
        <span>
          <IChevR />
          <b aria-current="page">{c.name}</b>
        </span>
      </nav>
      <header className="client-head">
        <ClientAvatar c={c} size={64} />
        <div className="client-head-text">
          <h1>{c.name}</h1>
          <p className="muted">
            {c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : 'No email'} · added {fmtDate(c.createdAt)}
            {c.createdBy ? ` by ${c.createdBy}` : ''}
          </p>
          {c.notes && <p className="client-notes">{c.notes}</p>}
        </div>
        {s.canEdit && (
          <div className="page-actions">
            <Button icon={<IPencil />} onClick={onEdit}>
              Edit
            </Button>
            {s.isOwner && <Button kind="danger" icon={<ITrash />} aria-label="Remove client" onClick={onDelete} />}
            <Button kind="primary" icon={<IPlus />} onClick={onAdd}>
              Share
            </Button>
          </div>
        )}
      </header>

      <div className="client-sees">
        <IShare />
        <span>
          <b>{c.name}</b> will see <b>{sum.files}</b> {sum.files === 1 ? 'file' : 'files'}
          {sum.folders ? ` from ${sum.folders} ${sum.folders === 1 ? 'folder' : 'folders'}` : ''}
          {sum.links ? ` and ${sum.links} ${sum.links === 1 ? 'link' : 'links'}` : ''}.
          <small> Shared folders stay up to date — new uploads in them are included automatically.</small>
        </span>
      </div>

      <Logins c={c} />

      {c.inboxFolderId && s.byId.get(c.inboxFolderId) && (
        <section>
          <h2 className="section-title">From the client</h2>
          <div className="folders">
            <SharedFolder f={s.byId.get(c.inboxFolderId)} />
          </div>
        </section>
      )}

      {!c.shares.length ? (
        <Empty
          icon={<IShare />}
          title="Nothing shared yet"
          text={`Share folders, files or links — that's what ${c.name} will see on the client website.`}
          action={s.canEdit && <Button kind="primary" icon={<IPlus />} onClick={onAdd}>Share something</Button>}
        />
      ) : (
        <>
          {folders.length > 0 && (
            <section>
              <h2 className="section-title">Folders</h2>
              <div className="folders">
                {folders.map((sh) => {
                  const f = sh.targetId ? s.byId.get(sh.targetId) : undefined;
                  return <SharedFolder key={sh.id} f={f} onRemove={s.canEdit ? () => remove(sh, f ? nameOf(f) : 'folder') : undefined} />;
                })}
              </div>
            </section>
          )}
          {items.length > 0 && (
            <section>
              <h2 className="section-title">Files</h2>
              <div className="grid">
                {items.map((sh) => {
                  const a = s.tree?.items.find((x) => x.id === sh.targetId);
                  const menu: MenuItem[] = s.canEdit ? [{ label: 'Stop sharing', icon: <IX />, danger: true, onClick: () => remove(sh, a ? titleOf(a) : 'file') }] : [];
                  return a ? (
                    <div key={sh.id} className={a.deletedAt ? 'is-trashed' : ''}>
                      <AssetCard asset={a} selected={false} selecting={false} onToggle={() => s.openSheet(a.id)} onOpen={() => s.openSheet(a.id)} menu={menu} where={a.deletedAt ? 'In Trash — not shown' : s.path(a.folderId).map(nameOf).join(' › ')} />
                    </div>
                  ) : null;
                })}
              </div>
            </section>
          )}
          {links.length > 0 && (
            <section>
              <h2 className="section-title">Links</h2>
              <div className="list-card">
                {links.map((sh) => (
                  <div className="list-row" key={sh.id}>
                    <span className="row-icon">
                      <ILink />
                    </span>
                    <span className="list-text">
                      <strong>{sh.title}</strong>
                      <small>{sh.url}</small>
                    </span>
                    <a className="icon-btn" href={sh.url ?? '#'} target="_blank" rel="noreferrer noopener" aria-label="Open link" title="Open">
                      <IExternal />
                    </a>
                    {s.canEdit && (
                      <button className="icon-btn" aria-label="Stop sharing" title="Stop sharing" onClick={() => remove(sh, sh.title || 'link')}>
                        <IX />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
      {modals}
    </div>
  );
}

/* ---------------- client website logins ---------------- */

function Logins({ c }: { c: Client }) {
  const s = useStore();
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState<{ email: string; password: string; fresh: boolean } | null>(null);
  const [removing, setRemoving] = useState<ClientLogin | null>(null);
  const reset = async (u: ClientLogin) => {
    const r = await s.run<{ password: string }>('logins.reset', { id: u.id });
    if (r) setShown({ email: u.email, password: r.password, fresh: false });
  };
  return (
    <section className="panel logins">
      <div className="panel-head">
        <h3>
          <IUsers /> Client website logins
        </h3>
        {s.canEdit && (
          <Button size="sm" icon={<IPlus />} onClick={() => setAdding(true)}>
            Add login
          </Button>
        )}
      </div>
      {!c.logins.length ? (
        <p className="muted">No one at {c.name} can sign in yet. Add a login and send them the password.</p>
      ) : (
        <div className="list-flat">
          {c.logins.map((u) => (
            <div className={`list-row${u.disabled ? ' is-off' : ''}`} key={u.id}>
              <ClientAvatar c={{ name: u.name, color: u.disabled ? null : c.color }} size={32} />
              <span className="list-text">
                <strong>
                  {u.name} {u.disabled && <em className="you">Turned off</em>}
                </strong>
                <small>
                  {u.email} · {u.lastLoginAt ? `last signed in ${fmtAgo(u.lastLoginAt)}` : 'never signed in'}
                </small>
              </span>
              {s.canEdit && (
                <span className="row-actions">
                  <Button size="sm" kind="plain" icon={<IKey />} onClick={() => reset(u)}>
                    New password
                  </Button>
                  <Button size="sm" kind="plain" onClick={() => s.run('logins.update', { id: u.id, disabled: !u.disabled }, u.disabled ? `${u.name} can sign in again` : `${u.name} is signed out and can't sign in`)}>
                    {u.disabled ? 'Turn on' : 'Turn off'}
                  </Button>
                  <button className="icon-btn" aria-label="Remove login" title="Remove login" onClick={() => setRemoving(u)}>
                    <ITrash />
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {adding && (
        <LoginDialog
          c={c}
          onClose={() => setAdding(false)}
          onMade={(email, password) => {
            setAdding(false);
            setShown({ email, password, fresh: true });
          }}
        />
      )}
      {shown && <PasswordDialog {...shown} onClose={() => setShown(null)} />}
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}'s login?`}
          text="They're signed out and can't sign in again. Files they sent stay in the library."
          action="Remove login"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={() => {
            s.run('logins.delete', { id: removing.id }, `Removed ${removing.name}'s login`);
            setRemoving(null);
          }}
        />
      )}
    </section>
  );
}

function LoginDialog({ c, onClose, onMade }: { c: Client; onClose: () => void; onMade: (email: string, password: string) => void }) {
  const s = useStore();
  const [email, setEmail] = useState(c.logins.length ? '' : c.email ?? '');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const submit = async () => {
    setBusy(true);
    const r = await s.run<{ password: string }>('logins.create', { clientId: c.id, email: email.trim(), name: name.trim() });
    setBusy(false);
    if (r) onMade(email.trim().toLowerCase(), r.password);
  };
  return (
    <Dialog
      title={`New login for ${c.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!ok || busy} onClick={submit}>
            Make login
          </Button>
        </>
      }
    >
      <form className="form" onSubmit={(e) => (e.preventDefault(), ok && submit())}>
        <label className="field">
          <span>Their email</span>
          <input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
          <small>They sign in to the client website with this.</small>
        </label>
        <label className="field">
          <span>Their name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
        </label>
      </form>
    </Dialog>
  );
}

function PasswordDialog({ email, password, fresh, onClose }: { email: string; password: string; fresh: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard?.writeText(`Email: ${email}\nPassword: ${password}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  return (
    <Dialog
      title={fresh ? 'Login ready' : 'New password'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={copy} icon={copied ? <ICheck /> : undefined}>
            {copied ? 'Copied' : 'Copy both'}
          </Button>
          <Button kind="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <p className="muted">Send these to them privately. The password is shown only now — you can make a new one any time.</p>
      <div className="secret-box">
        <span>Email</span>
        <code>{email}</code>
        <span>Password</span>
        <code className="secret">{password}</code>
      </div>
      {!fresh && <p className="muted small">They were signed out everywhere and need this new password.</p>}
    </Dialog>
  );
}

function SharedFolder({ f, onRemove }: { f: Folder | undefined; onRemove?: () => void }) {
  const s = useStore();
  if (!f) return null;
  const count = (id: string): number => s.assetsIn(id).length + s.children(id).reduce((n, k) => n + count(k.id), 0);
  const trashed = !!f.deletedAt || s.path(f.id).some((x) => x.deletedAt);
  return (
    <div className={`folder${trashed ? ' is-trashed' : ''}`} tabIndex={0} onClick={() => !trashed && s.go({ page: 'folder', id: f.id })}>
      <FolderGlyph f={f} />
      <div className="folder-text">
        <strong>{nameOf(f)}</strong>
        <small>{trashed ? 'In Trash — not shown' : `${count(f.id)} files · ${s.path(f.parentId).map(nameOf).join(' › ') || 'Library'}`}</small>
      </div>
      {onRemove && (
        <button className="icon-btn" aria-label="Stop sharing" title="Stop sharing" onClick={(e) => (e.stopPropagation(), onRemove())}>
          <IX />
        </button>
      )}
    </div>
  );
}

/* ---------------- create / edit ---------------- */

function ClientDialog({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const s = useStore();
  const [name, setName] = useState(client?.name ?? '');
  const [email, setEmail] = useState(client?.email ?? '');
  const [notes, setNotes] = useState(client?.notes ?? '');
  const [color, setColor] = useState(client?.color ?? COLORS[s.clients.length % COLORS.length]);
  const save = async () => {
    const body = { name: name.trim(), email: email.trim() || null, notes: notes.trim() || null, color };
    if (client) {
      if (await s.run('clients.update', { id: client.id, ...body }, 'Saved')) onClose();
    } else {
      const r = await s.run<{ id: string }>('clients.create', body, `Added ${body.name}`);
      if (r?.id) {
        onClose();
        s.go({ page: 'client', id: r.id });
      }
    }
  };
  return (
    <Dialog
      title={client ? 'Edit client' : 'New client'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!name.trim()} onClick={save}>
            {client ? 'Save' : 'Add client'}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), name.trim() && save())}>
        <div className="client-preview">
          <ClientAvatar c={{ name: name || '?', color }} size={52} />
          <div className="swatches" role="radiogroup" aria-label="Colour">
            {COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={c} style={{ background: c }} onClick={() => setColor(c)}>
                {c === color && <ICheck />}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Client or company name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Sdn Bhd" />
        </label>
        <label className="field">
          <span>Contact email (optional)</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
        </label>
        <label className="field">
          <span>Notes (optional)</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Brand guidelines, contact person, preferences…" />
        </label>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/* ---------------- choose what to share ---------------- */

function SharePicker({ client, onClose }: { client: Client; onClose: () => void }) {
  const s = useStore();
  const [tab, setTab] = useState<'library' | 'link'>('library');
  const [folders, setFolders] = useState<Set<string>>(new Set());
  const [items, setItems] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const already = useMemo(() => new Set(client.shares.map((x) => `${x.kind}:${x.targetId}`)), [client]);
  const needle = q.trim().toLowerCase();

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setter(n);
  };

  /** Ticking a folder shares everything inside it, so anything ticked inside is dropped (no double shares) and the folder opens to show it. */
  const toggleFolder = (id: string) => {
    if (folders.has(id)) return toggle(folders, setFolders, id);
    const subFolders = new Set<string>();
    const subItems = new Set<string>();
    const walk = (fid: string) => {
      for (const a of s.assetsIn(fid)) subItems.add(a.id);
      for (const k of s.children(fid)) {
        subFolders.add(k.id);
        walk(k.id);
      }
    };
    walk(id);
    setFolders(new Set([...folders].filter((x) => !subFolders.has(x)).concat(id)));
    setItems(new Set([...items].filter((x) => !subItems.has(x))));
    setOpen(new Set(open).add(id));
  };

  /** `covered`: a folder above this one is ticked or already shared, so this row is included anyway. */
  const FolderRow = ({ f, depth, covered = false }: { f: Folder; depth: number; covered?: boolean }): React.ReactElement => {
    const isOpen = open.has(f.id) || !!needle;
    const kids = s.children(f.id);
    const files = s.assetsIn(f.id).filter((a) => !needle || titleOf(a).toLowerCase().includes(needle));
    const shared = already.has(`folder:${f.id}`);
    const showSelf = !needle || nameOf(f).toLowerCase().includes(needle) || files.length > 0 || kids.length > 0;
    if (!showSelf) return <></>;
    return (
      <>
        <div className="pick-row tree-pick" style={{ paddingLeft: 8 + depth * 18 }}>
          <button type="button" className={`tree-caret${isOpen ? ' open' : ''}${kids.length || s.assetsIn(f.id).length ? '' : ' none'}`} onClick={() => toggle(open, setOpen, f.id)} aria-label={isOpen ? 'Collapse' : 'Expand'}>
            <IChevR />
          </button>
          <label className="pick-label">
            <input type="checkbox" checked={covered || shared || folders.has(f.id)} disabled={covered || shared} onChange={() => toggleFolder(f.id)} />
            <FolderGlyph f={f} small />
            <span>{nameOf(f)}</span>
            {covered ? <em className="pick-tag soft">Included</em> : shared && <em className="pick-tag">Shared</em>}
          </label>
        </div>
        {isOpen && (
          <>
            {kids.map((k) => (
              <FolderRow key={k.id} f={k} depth={depth + 1} covered={covered || shared || folders.has(f.id)} />
            ))}
            {files.map((a) => (
              <FileRow key={a.id} a={a} depth={depth + 1} covered={covered || shared || folders.has(f.id)} />
            ))}
          </>
        )}
      </>
    );
  };
  const FileRow = ({ a, depth, covered = false }: { a: Asset; depth: number; covered?: boolean }) => {
    const shared = already.has(`item:${a.id}`);
    const f = mainFile(a);
    return (
      <div className="pick-row tree-pick" style={{ paddingLeft: 28 + depth * 18 }}>
        <label className="pick-label">
          <input type="checkbox" checked={covered || shared || items.has(a.id)} disabled={covered || shared} onChange={() => toggle(items, setItems, a.id)} />
          <span className="pick-thumb">
            <Thumb asset={a} />
          </span>
          <span>{titleOf(a)}</span>
          <small className="muted">{f?.name.split('.').pop()?.toUpperCase()}</small>
          {covered ? <em className="pick-tag soft">Included</em> : shared && <em className="pick-tag">Shared</em>}
        </label>
      </div>
    );
  };

  const count = folders.size + items.size;
  const share = async () => {
    const body = tab === 'link' ? { clientId: client.id, links: [{ url, title }] } : { clientId: client.id, folderIds: [...folders], itemIds: [...items] };
    const r = await s.run<{ added: number }>('shares.add', body, tab === 'link' ? 'Link shared' : `Shared ${count} ${count === 1 ? 'item' : 'items'} with ${client.name}`);
    if (r) onClose();
  };

  return (
    <Dialog
      wide
      title={`Share with ${client.name}`}
      onClose={onClose}
      footer={
        <>
          <span className="muted small footer-note">{tab === 'library' ? (count ? `${count} selected` : 'Pick folders or files') : 'Canva, Google Drive, YouTube, a website…'}</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={tab === 'library' ? !count : !url.trim()} onClick={share}>
            Share
          </Button>
        </>
      }
    >
      <div className="picker-top">
        <Segmented
          label="What to share"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'library', label: <><IFolder /> From library</> },
            { value: 'link', label: <><ILink /> Link</> },
          ]}
        />
        {tab === 'library' && (
          <label className="search inline grow">
            <ISearch />
            <input type="search" placeholder="Search folders and files" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </label>
        )}
      </div>
      {tab === 'library' ? (
        <div className="pick-list tall">
          {s.children(null).map((f) => (
            <FolderRow key={f.id} f={f} depth={0} />
          ))}
          {!s.children(null).length && <p className="muted pad">The library is empty — upload some files first.</p>}
        </div>
      ) : (
        <form onSubmit={(e) => (e.preventDefault(), url.trim() && share())}>
          <label className="field">
            <span>Link</span>
            <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.canva.com/design/…" inputMode="url" />
          </label>
          <label className="field">
            <span>Title (optional)</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. CNY campaign — Canva board" />
          </label>
          <button type="submit" hidden />
        </form>
      )}
    </Dialog>
  );
}

/** From the library: share one folder or file with one or more clients. */
export function ShareWithClients({ kind, id, label, onClose }: { kind: 'folder' | 'item'; id: string; label: string; onClose: () => void }) {
  const s = useStore();
  const direct = new Set(s.clients.filter((c) => c.shares.some((x) => x.kind === kind && x.targetId === id)).map((c) => c.id));
  const viaParent = new Set(s.sharedWith(kind, id).map((c) => c.id));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const share = async () => {
    let n = 0;
    for (const cid of sel) {
      if (await s.run('shares.add', { clientId: cid, [kind === 'folder' ? 'folderIds' : 'itemIds']: [id] })) n++;
    }
    if (n) s.toast(`Shared “${label}” with ${n} ${n === 1 ? 'client' : 'clients'}`, { tone: 'ok' });
    onClose();
  };
  return (
    <Dialog
      title={`Share “${label}”`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!sel.size} onClick={share}>
            Share
          </Button>
        </>
      }
    >
      {!s.clients.length ? (
        <Empty icon={<IBriefcase />} title="No clients yet" text="Add clients in the Clients tab first." action={<Button onClick={() => (onClose(), s.go({ page: 'clients' }))}>Go to Clients</Button>} />
      ) : (
        <div className="pick-list">
          {s.clients.map((c) => {
            const has = direct.has(c.id);
            const inherited = !has && viaParent.has(c.id);
            return (
              <label key={c.id} className={`pick-row pick-label client-pick${has || inherited ? ' done' : ''}`}>
                <input type="checkbox" checked={has || inherited || sel.has(c.id)} disabled={has || inherited} onChange={() => {
                  const n = new Set(sel);
                  if (n.has(c.id)) n.delete(c.id);
                  else n.add(c.id);
                  setSel(n);
                }} />
                <ClientAvatar c={c} size={28} />
                <span>{c.name}</span>
                {has && <em className="pick-tag">Shared</em>}
                {inherited && <em className="pick-tag">Via folder</em>}
              </label>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
