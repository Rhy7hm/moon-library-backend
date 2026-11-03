/*
 * Clients: who they are, and what is shared with each of them (folders, files, links).
 * The client website (moon-library-client) shows each client their shared things; here the team
 * decides what that is, makes their logins, and sees the files they sent ("From the client").
 * Each client has a folder in the library (Clients › <client>); "New folder" here makes one inside it.
 */
import { useMemo, useRef, useState } from 'react';
import { fileUrl, mainFile, nameOf, op, titleOf, type Asset, type Client, type ClientLogin, type Folder, type Share } from './api';
import { encodeAvatar } from './avatar-encode';
import { fmtAgo, fmtDate } from './format';
import { IBriefcase, ICheck, IChevR, IClock, IDownload, IExternal, IFolder, IImage, IKey, ILink, IPencil, IPlus, ISearch, IShare, ITrash, IUsers, IX } from './icons';
import { useStore } from './store';
import { AssetCard, Button, ConfirmDialog, CopyButton, Dialog, Empty, FolderGlyph, MenuButton, PageHeader, Segmented, Thumb, type MenuItem } from './ui';
import { useActions } from './library';

const COLORS = ['#0a84ff', '#30b0c7', '#34c759', '#ff9f0a', '#ff375f', '#bf5af2', '#5e5ce6', '#8e8e93'];
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

export function ClientAvatar({
  c,
  size = 40,
  previewUrl,
}: {
  c: Pick<Client, 'name' | 'color'> & { avatarKey?: string | null };
  size?: number;
  previewUrl?: string | null;
}) {
  const src = previewUrl || (c.avatarKey ? fileUrl(c.avatarKey) : '');
  if (src) {
    return (
      <span className="client-avatar has-photo" style={{ width: size, height: size }}>
        <img src={src} alt="" draggable={false} />
      </span>
    );
  }
  return (
    <span className="client-avatar" style={{ ['--c' as string]: c.color || '#8e8e93', width: size, height: size, fontSize: size * 0.38 }}>
      {initials(c.name)}
    </span>
  );
}

/** What a client will see: files inside shared folders (and sub-folders), shared files, links — and
 *  the newest few with a picture, for the card's cover. */
function useShareSummary(c: Client) {
  const s = useStore();
  return useMemo(() => {
    const live = c.shares.filter((x) => !ended(x));
    const folders = live.filter((x) => x.kind === 'folder');
    const inside = new Set<string>();
    const walk = (id: string) => {
      for (const a of s.assetsIn(id)) inside.add(a.id);
      for (const k of s.children(id)) walk(k.id);
    };
    for (const f of folders) if (f.targetId) walk(f.targetId);
    for (const x of live) if (x.kind === 'item' && x.targetId && s.assets.some((a) => a.id === x.targetId)) inside.add(x.targetId);
    const preview = s.assets
      .filter((a) => inside.has(a.id) && (mainFile(a)?.thumb || mainFile(a)?.poster))
      .sort((a, b) => b.date - a.date)
      .slice(0, 3);
    return { folders: folders.length, files: inside.size, links: live.filter((x) => x.kind === 'link').length, preview };
  }, [c, s]);
}

/* ---------------- share end dates ---------------- */

const DAY = 864e5;
/** true once a share's end date has passed (the client no longer sees it) */
export const ended = (sh: Share) => !!sh.expiresAt && sh.expiresAt <= Date.now();
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).getTime();
const dateInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** "Until 12 Dec", "Ends today", "Ended 3 Oct" — or nothing for no end date. */
export function UntilBadge({ sh }: { sh: Share }) {
  if (!sh.expiresAt) return null;
  const left = sh.expiresAt - Date.now();
  const label = left <= 0 ? `Ended ${fmtDate(sh.expiresAt)}` : left < DAY ? 'Ends today' : `Until ${fmtDate(sh.expiresAt)}`;
  return <em className={`until-badge${left <= 0 ? ' ended' : left < 7 * DAY ? ' soon' : ''}`}>{label}</em>;
}

/** How long the client can see something: no end date, a quick choice, or a picked date (to the end of that day). */
export function UntilPicker({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const quick = [
    { label: 'No end date', days: 0 },
    { label: '1 week', days: 7 },
    { label: '30 days', days: 30 },
    { label: '90 days', days: 90 },
  ];
  const [mode, setMode] = useState<number | 'date'>(() => (value ? 'date' : 0));
  const pick = (days: number) => (setMode(days), onChange(days ? endOfDay(new Date(Date.now() + days * DAY)) : null));
  return (
    <div className="until">
      <span className="until-label">Client can see it</span>
      <div className="until-opts" role="radiogroup" aria-label="Client can see it">
        {quick.map((o) => (
          <button key={o.days} type="button" role="radio" aria-checked={mode === o.days} className={mode === o.days ? 'on' : ''} onClick={() => pick(o.days)}>
            {o.days ? `For ${o.label}` : 'Always'}
          </button>
        ))}
        <label className={`until-date${mode === 'date' ? ' on' : ''}`}>
          <span>Until</span>
          <input
            type="date"
            min={dateInput(Date.now() + DAY)}
            value={value ? dateInput(value) : ''}
            onChange={(e) => {
              if (!e.target.value) return;
              const [y, m, d] = e.target.value.split('-').map(Number);
              setMode('date');
              onChange(endOfDay(new Date(y, m - 1, d)));
            }}
          />
        </label>
      </div>
      {value && <small className="muted">They'll stop seeing it after {new Date(value).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}.</small>}
    </div>
  );
}

/** Change (or clear) the end date of a share. */
function UntilDialog({ c, sh, label, onClose }: { c: Client; sh: Share; label: string; onClose: () => void }) {
  const s = useStore();
  const [v, setV] = useState<number | null>(sh.expiresAt && !ended(sh) ? sh.expiresAt : null);
  return (
    <Dialog
      title={`How long can ${c.name} see “${label}”?`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" onClick={async () => (await s.run('shares.expire', { clientId: c.id, ids: [sh.id], expiresAt: v }, v ? 'End date set' : 'End date removed')) && onClose()}>
            Save
          </Button>
        </>
      }
    >
      <UntilPicker value={v} onChange={setV} />
    </Dialog>
  );
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

/** A client at a glance: a cover of what they can see, who they are, what's shared, and whether they use it. */
function ClientCard({ c, onOpen }: { c: Client; onOpen: () => void }) {
  const s = useStore();
  const sum = useShareSummary(c);
  const live = c.logins.filter((l) => !l.disabled);
  const lastIn = Math.max(0, ...c.logins.map((l) => l.lastLoginAt ?? 0));
  const sent = c.inboxFolderId ? s.assetsIn(c.inboxFolderId).length : 0;
  const color = c.color || '#8e8e93';
  const stat = (n: number, one: string, many: string, icon: React.ReactNode) => (
    <span className={`cc-stat${n ? '' : ' zero'}`}>
      {icon}
      <b>{n}</b> {n === 1 ? one : many}
    </span>
  );
  return (
    <button className="client-card" onClick={onOpen} style={{ ['--c' as string]: color }}>
      <span className={`cc-cover n${sum.preview.length}`} aria-hidden>
        {sum.preview.length ? (
          sum.preview.map((a) => (
            <span key={a.id} className="cc-pic">
              <Thumb asset={a} />
            </span>
          ))
        ) : (
          <span className="cc-cover-empty">
            <IShare /> Nothing shared yet
          </span>
        )}
      </span>
      <span className="cc-body">
        <span className="cc-head">
          <span className="cc-avatar">
            <ClientAvatar c={c} size={52} />
          </span>
          {sent > 0 && (
            <span className="cc-sent" title={`${sent} file${sent === 1 ? '' : 's'} sent by ${c.name}`}>
              <IDownload /> {sent} from client
            </span>
          )}
        </span>
        <span className="cc-name">
          <strong>{c.name}</strong>
          <small className={c.email ? '' : 'none'}>{c.email || 'No email yet'}</small>
        </span>
        <span className="cc-stats">
          {stat(sum.files, 'file', 'files', <IImage />)}
          {stat(sum.folders, 'folder', 'folders', <IFolder />)}
          {stat(sum.links, 'link', 'links', <ILink />)}
        </span>
        <span className="cc-foot">
          <span className={`cc-dot ${live.length ? (lastIn ? 'on' : 'idle') : 'off'}`} />
          <span className="cc-login">
            {!c.logins.length
              ? 'No website login yet'
              : !live.length
                ? 'Logins turned off'
                : `${live.length} login${live.length === 1 ? '' : 's'} · ${lastIn ? `last visit ${fmtAgo(lastIn)}` : 'not signed in yet'}`}
          </span>
          <IChevR className="cc-go" />
        </span>
      </span>
    </button>
  );
}

/* ---------------- one client ---------------- */

export function ClientPage({ id }: { id: string }) {
  const s = useStore();
  const c = s.clients.find((x) => x.id === id);
  const [editing, setEditing] = useState<false | 'details' | 'logins'>(false);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [making, setMaking] = useState(false);
  if (!c) {
    return (
      <Empty icon={<IBriefcase />} title="Client not found" text="They may have been removed." action={<Button onClick={() => s.go({ page: 'clients' })}>All clients</Button>} />
    );
  }
  return <ClientBody c={c} onEdit={(tab) => setEditing(tab)} onAdd={() => setAdding(true)} onNewFolder={() => setMaking(true)} onDelete={() => setDeleting(true)} modals={
    <>
      {editing && <ClientDialog client={c} tab={editing} onClose={() => setEditing(false)} />}
      {making && <ClientFolderDialog c={c} onClose={() => setMaking(false)} />}
      {adding && <SharePicker client={c} onClose={() => setAdding(false)} />}
      {deleting && (
        <ConfirmDialog
          title={`Move ${c.name} to the Trash?`}
          text="Their website logins stop working straight away. You can restore them from the Trash for 90 days, with everything they had shared. Their folders and files stay in the library."
          action="Move to Trash"
          danger
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            setDeleting(false);
            const undo = () => op('restore', { folderIds: [], itemIds: [], clientIds: [c.id] });
            if (await s.run('clients.delete', { id: c.id }, `Moved ${c.name} to the Trash`, undo)) s.go({ page: 'clients' });
          }}
        />
      )}
    </>
  } />;
}

function ClientBody({ c, onEdit, onAdd, onNewFolder, onDelete, modals }: { c: Client; onEdit: (tab: 'details' | 'logins') => void; onAdd: () => void; onNewFolder: () => void; onDelete: () => void; modals: React.ReactNode }) {
  const s = useStore();
  const sum = useShareSummary(c);
  const folders = c.shares.filter((x) => x.kind === 'folder');
  const items = c.shares.filter((x) => x.kind === 'item');
  const links = c.shares.filter((x) => x.kind === 'link');
  const remove = (sh: Share, label: string) => s.run('shares.remove', { clientId: c.id, ids: [sh.id] }, `Stopped sharing “${label}”`);
  const [until, setUntil] = useState<{ sh: Share; label: string } | null>(null);
  const home = c.homeFolderId ? s.byId.get(c.homeFolderId) : undefined;
  const inbox = c.inboxFolderId ? s.byId.get(c.inboxFolderId) : undefined;
  const { folderMenu, dialogs: folderDialogs } = useActions();
  // a shared folder's menu: its end date and sharing first, then everything the Library's menu has
  const sharedMenu = (sh: Share, f: Folder | undefined): MenuItem[] => [
    ...(s.canEdit
      ? ([
          ...(f ? [{ label: sh.expiresAt ? 'Change end date…' : 'Set end date…', icon: <IClock />, onClick: () => setUntil({ sh, label: nameOf(f) }) }] : []),
          { label: `Stop sharing with ${c.name}`, icon: <IX />, danger: true, onClick: () => remove(sh, f ? nameOf(f) : 'folder') },
        ] as MenuItem[])
      : []),
    ...(f && !f.deletedAt ? [...(s.canEdit ? (['sep'] as MenuItem[]) : []), ...folderMenu(f)] : []),
  ];

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
            <Button reveal icon={<IUsers />} onClick={() => onEdit('logins')}>
              Logins
            </Button>
            <Button reveal icon={<IPencil />} onClick={() => onEdit('details')}>
              Edit
            </Button>
            {s.isOwner && (
              <Button reveal kind="danger" icon={<ITrash />} onClick={onDelete}>
                Remove
              </Button>
            )}
            <Button reveal icon={<IFolder />} onClick={onNewFolder}>
              New folder
            </Button>
            <Button reveal kind="primary" icon={<IPlus />} onClick={onAdd}>
              Share
            </Button>
          </div>
        )}
      </header>

      <ClientStats c={c} sum={sum} onLogins={() => onEdit('logins')} />

      {(home || inbox) && (
        <section>
          <h2 className="section-title">In the library</h2>
          <div className="folders">
            {home && <SharedFolder f={home} note="Their folder" menu={folderMenu(home)} />}
            {inbox && <SharedFolder f={inbox} note="Files they sent you" menu={folderMenu(inbox)} />}
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
                  return (
                    <SharedFolder key={sh.id} f={f} share={sh} menu={sharedMenu(sh, f)} />
                  );
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
                  const menu: MenuItem[] = s.canEdit
                    ? [
                        { label: sh.expiresAt ? 'Change end date…' : 'Set end date…', icon: <IClock />, onClick: () => setUntil({ sh, label: a ? titleOf(a) : 'file' }) },
                        'sep',
                        { label: 'Stop sharing', icon: <IX />, danger: true, onClick: () => remove(sh, a ? titleOf(a) : 'file') },
                      ]
                    : [];
                  return a ? (
                    <div key={sh.id} className={`share-card${a.deletedAt || ended(sh) ? ' is-trashed' : ''}`}>
                      <AssetCard asset={a} selected={false} selecting={false} onToggle={() => s.openSheet(a.id)} onOpen={() => s.openSheet(a.id)} menu={menu} where={a.deletedAt ? 'In Trash — not shown' : s.path(a.folderId).map(nameOf).join(' › ')} />
                      <UntilBadge sh={sh} />
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
                      <strong>
                        {sh.title} <UntilBadge sh={sh} />
                      </strong>
                      <small>{sh.url}</small>
                    </span>
                    {s.canEdit && (
                      <button className="icon-btn" aria-label="Set end date" title={sh.expiresAt ? 'Change end date' : 'Set end date'} onClick={() => setUntil({ sh, label: sh.title || 'link' })}>
                        <IClock />
                      </button>
                    )}
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
      {folderDialogs}
      {until && <UntilDialog c={c} sh={until.sh} label={until.label} onClose={() => setUntil(null)} />}
    </div>
  );
}

/* ---------------- what the client sees, at a glance ---------------- */

function ClientStats({ c, sum, onLogins }: { c: Client; sum: { files: number; folders: number; links: number }; onLogins: () => void }) {
  const s = useStore();
  const on = c.logins.filter((u) => !u.disabled);
  const last = Math.max(0, ...c.logins.map((u) => u.lastLoginAt ?? 0));
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  return (
    <section className="client-stats" aria-label={`What ${c.name} sees`}>
      <div className="client-stat">
        <b>{sum.files}</b>
        <span>{plural(sum.files, 'File', 'Files')}</span>
      </div>
      <div className="client-stat">
        <b>{sum.folders}</b>
        <span>{plural(sum.folders, 'Folder', 'Folders')}</span>
      </div>
      <div className="client-stat">
        <b>{sum.links}</b>
        <span>{plural(sum.links, 'Link', 'Links')}</span>
      </div>
      <button className="client-stat is-btn" onClick={onLogins} disabled={!s.canEdit && !c.logins.length} title="Website logins">
        <b>{on.length}</b>
        <span>
          {plural(on.length, 'Login', 'Logins')}
          <small>{!c.logins.length ? 'No one can sign in yet' : last ? `Last visit ${fmtAgo(last)}` : 'Not signed in yet'}</small>
        </span>
        <IChevR />
      </button>
      <p className="client-stats-note">
        <IShare /> What {c.name} sees on the client website. Shared folders update by themselves.
      </p>
    </section>
  );
}

/* ---------------- client website logins ---------------- */

function Logins({ c }: { c: Client }) {
  // shown in the client's Edit dialog, "Website logins" tab
  const s = useStore();
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState<{ email: string; password: string; fresh: boolean } | null>(null);
  const [removing, setRemoving] = useState<ClientLogin | null>(null);
  const reset = async (u: ClientLogin) => {
    const r = await s.run<{ password: string }>('logins.reset', { id: u.id });
    if (r) setShown({ email: u.email, password: r.password, fresh: false });
  };
  return (
    <section className="logins">
      <div className="logins-head">
        <p className="muted">People at {c.name} who can sign in to the client website.</p>
        {s.canEdit && (
          <Button size="sm" icon={<IPlus />} onClick={() => setAdding(true)}>
            Add login
          </Button>
        )}
      </div>
      {!c.logins.length ? (
        <div className="logins-empty">
          <IUsers />
          <p>No one at {c.name} can sign in yet. Add a login and send them the password.</p>
        </div>
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
  const s = useStore();
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard?.writeText(`Email: ${email}\nPassword: ${password}`).then(() => {
      setCopied(true);
      s.toast('Copied', { tone: 'ok' });
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
        <div className="secret-value">
          <code>{email}</code>
          <CopyButton value={email} label="Copy email" toastText="Email copied" />
        </div>
        <span>Password</span>
        <div className="secret-value">
          <code className="secret">{password}</code>
          <CopyButton value={password} label="Copy password" toastText="Password copied" />
        </div>
      </div>
      {!fresh && <p className="muted small">They were signed out everywhere and need this new password.</p>}
    </Dialog>
  );
}

function SharedFolder({ f, share, note, menu }: { f: Folder | undefined; share?: Share; note?: string; menu?: MenuItem[] }) {
  const s = useStore();
  if (!f) return null;
  const count = (id: string): number => s.assetsIn(id).length + s.children(id).reduce((n, k) => n + count(k.id), 0);
  const trashed = !!f.deletedAt || s.path(f.id).some((x) => x.deletedAt);
  const n = count(f.id);
  const where = note ?? (s.path(f.parentId).map(nameOf).join(' › ') || 'Library');
  return (
    <div className={`folder shared-folder${trashed || (share && ended(share)) ? ' is-trashed' : ''}`} tabIndex={0} onClick={() => !trashed && s.go({ page: 'folder', id: f.id })}>
      <FolderGlyph f={f} />
      <div className="folder-text">
        <strong title={nameOf(f)}>{nameOf(f)}</strong>
        <small title={trashed ? undefined : where}>
          {trashed ? (
            'In Trash — not shown'
          ) : (
            <>
              <span className="sf-count">{n === 1 ? '1 file' : `${n} files`}</span>
              <span className="sf-where">{where}</span>
            </>
          )}
          {share && <UntilBadge sh={share} />}
        </small>
      </div>
      {menu && menu.length > 0 && <MenuButton items={menu} label={`More for ${nameOf(f)}`} />}
    </div>
  );
}

/* ---------------- a new folder for this client ---------------- */

function ClientFolderDialog({ c, onClose }: { c: Client; onClose: () => void }) {
  const s = useStore();
  const [name, setName] = useState('');
  const [share, setShare] = useState(true);
  const [busy, setBusy] = useState(false);
  const home = c.homeFolderId ? s.byId.get(c.homeFolderId) : undefined;
  const where = [...(home ? s.path(home.id).map(nameOf) : ['Clients', c.name])].join(' › ');
  const submit = async () => {
    const v = name.trim();
    if (!v || busy) return;
    setBusy(true);
    const r = await s.run<{ id: string }>('clients.newFolder', { clientId: c.id, name: v, share }, share ? `Created “${v}” and shared it with ${c.name}` : `Created “${v}”`);
    setBusy(false);
    if (r?.id) {
      onClose();
      s.go({ page: 'folder', id: r.id });
    }
  };
  return (
    <Dialog
      title={`New folder for ${c.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!name.trim() || busy} onClick={submit}>
            Create
          </Button>
        </>
      }
    >
      <form className="client-folder-form" onSubmit={(e) => (e.preventDefault(), void submit())}>
        <label className="field">
          <span>Folder name</span>
          <input autoFocus value={name} placeholder="e.g. CNY 2027" onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="client-folder-where">
          <IFolder /> {where} › <b>{name.trim() || 'New folder'}</b>
        </p>
        <label className="backup-switch">
          <span>
            <strong>Share with {c.name} now</strong>
            <small className="muted">They'll see everything you put in it on the client website. Turn off to keep it to the team until it's ready.</small>
          </span>
          <input type="checkbox" role="switch" className="switch" checked={share} onChange={(e) => setShare(e.target.checked)} />
        </label>
      </form>
    </Dialog>
  );
}

/* ---------------- create / edit ---------------- */

function ClientDialog({ client, tab: firstTab = 'details', onClose }: { client: Client | null; tab?: 'details' | 'logins'; onClose: () => void }) {
  const s = useStore();
  const [tab, setTab] = useState<'details' | 'logins'>(client ? firstTab : 'details');
  const live = client ? s.clients.find((x) => x.id === client.id) ?? client : null; // logins change while it's open
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(client?.name ?? '');
  const [email, setEmail] = useState(client?.email ?? '');
  const [notes, setNotes] = useState(client?.notes ?? '');
  const [color, setColor] = useState(client?.color ?? COLORS[s.clients.length % COLORS.length]);
  const [avatarKey, setAvatarKey] = useState<string | null>(client?.avatarKey ?? null);
  const [pendingData, setPendingData] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [clearPhoto, setClearPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState('');

  const showPhoto = !clearPhoto && (previewUrl || avatarKey);

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoErr('');
    try {
      const data = await encodeAvatar(file);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPendingData(data);
      setPreviewUrl(URL.createObjectURL(file));
      setClearPhoto(false);
    } catch (e) {
      setPhotoErr(e instanceof Error ? e.message : 'Could not use that photo');
    }
  };

  const removePhoto = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingData(null);
    setPreviewUrl(null);
    setClearPhoto(!!avatarKey);
    if (!avatarKey) setAvatarKey(null);
  };

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const body = { name: name.trim(), email: email.trim() || null, notes: notes.trim() || null, color };
    try {
      let id = client?.id;
      if (client) {
        if (!(await s.run('clients.update', { id: client.id, ...body }))) return;
      } else {
        const r = await s.run<{ id: string }>('clients.create', body);
        if (!r?.id) return;
        id = r.id;
      }
      if (id && pendingData) {
        if (!(await s.run('clients.setAvatar', { id, data: pendingData }))) return;
      } else if (id && clearPhoto) {
        if (!(await s.run('clients.clearAvatar', { id }))) return;
      }
      s.toast(client ? 'Saved' : `Added ${body.name}`, { tone: 'ok' });
      onClose();
      if (!client && id) s.go({ page: 'client', id });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={client ? client.name : 'New client'}
      onClose={onClose}
      wide={tab === 'logins'}
      footer={
        tab === 'logins' ? (
          <Button kind="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button kind="primary" disabled={!name.trim() || busy} onClick={save}>
              {client ? 'Save' : 'Add client'}
            </Button>
          </>
        )
      }
    >
      {live && (
        <div className="client-tabs">
          <Segmented
            label="Edit"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'details', label: 'Details' },
              { value: 'logins', label: <>Website logins{live.logins.length ? <em className="seg-count">{live.logins.length}</em> : null}</> },
            ]}
          />
        </div>
      )}
      {tab === 'logins' && live ? (
        <Logins c={live} />
      ) : (
      <form onSubmit={(e) => (e.preventDefault(), save())}>
        <div className="client-preview">
          <div className="client-photo">
            <button
              type="button"
              className="client-photo-btn"
              aria-label={showPhoto ? 'Change photo' : 'Add photo'}
              onClick={() => fileRef.current?.click()}
            >
              <ClientAvatar
                c={{ name: name || '?', color, avatarKey: clearPhoto ? null : avatarKey }}
                size={52}
                previewUrl={clearPhoto ? null : previewUrl}
              />
              <span className="client-photo-hint">{showPhoto ? 'Change' : 'Add photo'}</span>
            </button>
            {showPhoto && (
              <button type="button" className="btn plain sm" onClick={removePhoto}>
                Remove
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/*"
              hidden
              onChange={(e) => {
                void pickPhoto(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          <div className="swatches" role="radiogroup" aria-label="Colour">
            {COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={c} style={{ background: c }} onClick={() => setColor(c)}>
                {c === color && <ICheck />}
              </button>
            ))}
          </div>
        </div>
        {photoErr && <p className="field-err">{photoErr}</p>}
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
      )}
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
  const [expires, setExpires] = useState<number | null>(null);
  const share = async () => {
    const body = tab === 'link' ? { clientId: client.id, links: [{ url, title }], expiresAt: expires } : { clientId: client.id, folderIds: [...folders], itemIds: [...items], expiresAt: expires };
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
      <UntilPicker value={expires} onChange={setExpires} />
    </Dialog>
  );
}

/** From the library: share one folder or file with one or more clients (tick to share, untick to stop). */
/** Share one folder or file — or many selected files at once — with one or more clients, optionally until a date. */
export function ShareWithClients({ kind, id, ids, label, onClose }: { kind: 'folder' | 'item'; id?: string; ids?: string[]; label: string; onClose: () => void }) {
  const s = useStore();
  const targets = ids ?? (id ? [id] : []);
  const many = targets.length > 1;
  // already shared directly, or only because a parent folder is shared
  const hasAll = (c: Client, through: boolean) =>
    targets.every((t) => c.shares.some((x) => x.kind === kind && x.targetId === t && !ended(x)) || (through && s.sharedWith(kind, t).some((y) => y.id === c.id)));
  const direct = new Set(s.clients.filter((c) => hasAll(c, false)).map((c) => c.id));
  const viaParent = new Set(s.clients.filter((c) => hasAll(c, true)).map((c) => c.id));
  // start with everyone who already has a direct share ticked — untick to unshare
  const [sel, setSel] = useState<Set<string>>(() => new Set(direct));
  const [expires, setExpires] = useState<number | null>(null);
  const toAdd = [...sel].filter((cid) => !direct.has(cid));
  const toRemove = [...direct].filter((cid) => !sel.has(cid));
  const dirty = toAdd.length > 0 || toRemove.length > 0;
  const save = async () => {
    let added = 0;
    let removed = 0;
    for (const cid of toAdd) {
      if (await s.run('shares.add', { clientId: cid, [kind === 'folder' ? 'folderIds' : 'itemIds']: targets, expiresAt: expires })) added++;
    }
    for (const cid of toRemove) {
      const c = s.clients.find((x) => x.id === cid);
      if (!c) continue;
      const ids = c.shares.filter((x) => x.kind === kind && x.targetId && targets.includes(x.targetId) && !ended(x)).map((x) => x.id);
      if (ids.length && (await s.run('shares.remove', { clientId: cid, ids }))) removed++;
    }
    if (added && removed) s.toast(`Updated sharing for “${label}”`, { tone: 'ok' });
    else if (added) s.toast(`Shared ${many ? `${targets.length} files` : `“${label}”`} with ${added} ${added === 1 ? 'client' : 'clients'}`, { tone: 'ok' });
    else if (removed) s.toast(`Stopped sharing ${many ? `${targets.length} files` : `“${label}”`} with ${removed} ${removed === 1 ? 'client' : 'clients'}`, { tone: 'ok' });
    onClose();
  };
  const action =
    toRemove.length && !toAdd.length ? 'Stop sharing' : toAdd.length && toRemove.length ? 'Save' : 'Share';
  return (
    <Dialog
      title={many ? `Share ${targets.length} files` : `Share “${label}”`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!dirty} onClick={save}>
            {action}
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
            const on = inherited || sel.has(c.id);
            return (
              <label key={c.id} className={`pick-row pick-label client-pick${inherited || (has && on) ? ' done' : ''}`}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={inherited}
                  onChange={() => {
                    const n = new Set(sel);
                    if (n.has(c.id)) n.delete(c.id);
                    else n.add(c.id);
                    setSel(n);
                  }}
                />
                <ClientAvatar c={c} size={28} />
                <span>{c.name}</span>
                {has && on && <em className="pick-tag">Shared</em>}
                {inherited && <em className="pick-tag">Via folder</em>}
              </label>
            );
          })}
        </div>
      )}
      {s.clients.length > 0 && <UntilPicker value={expires} onChange={setExpires} />}
    </Dialog>
  );
}
