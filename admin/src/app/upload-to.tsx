/*
 * "Upload to…": files dropped on the Home page (or picked with Quick upload) ask where they go:
 *   Library  — the top of the Library, or a new folder there
 *   Folder   — any folder (searchable)
 *   Client   — a client (or a new one): their folder, or a new folder for them, shared with them or not
 * The folders and the client are made first, then the files upload into the chosen folder.
 *
 * GlobalDrop: files dropped on any page without a place of its own ask the same question. A folder
 * (Library) page uploads into that folder and a client's page into their folder, without asking.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { errText, nameOf, op, type Client } from './api';
import { ClientAvatar } from './clients';
import { fmtSize } from './format';
import { ICheck, IFolder, IPlus, ISearch, IUpload } from './icons';
import { useFileDrop, useStore } from './store';
import { Button, Dialog, FolderGlyph, Segmented } from './ui';

type Tab = 'library' | 'folder' | 'client';
const NEW = '__new__';

export function UploadToDialog({ files, tab: firstTab = 'library', onClose }: { files: File[]; tab?: Tab; onClose: () => void }) {
  const s = useStore();
  const [tab, setTab] = useState<Tab>(firstTab);
  // Library
  const [libNew, setLibNew] = useState(false);
  const [libName, setLibName] = useState('');
  // Folder
  const [q, setQ] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  // Client
  const [clientId, setClientId] = useState<string | null>(s.clients.length ? null : NEW);
  const [clientName, setClientName] = useState('');
  const [inClient, setInClient] = useState<'home' | 'new'>('home');
  const [clientFolder, setClientFolder] = useState('');
  const [share, setShare] = useState(true);
  const [busy, setBusy] = useState(false);

  // a few thumbnails of the dropped pictures
  const previews = useMemo(() => files.filter((f) => f.type.startsWith('image/')).slice(0, 4).map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  const size = files.reduce((n, f) => n + f.size, 0);

  const folders = useMemo(() => {
    const list = s.folders.map((f) => ({ f, path: s.path(f.id).map(nameOf) }));
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return list
      .filter((x) => words.every((w) => x.path.join(' ').toLowerCase().includes(w)))
      .sort((a, b) => a.path.join('/').localeCompare(b.path.join('/'), undefined, { numeric: true }));
  }, [s, q]);

  const client: Client | undefined = clientId && clientId !== NEW ? s.clients.find((c) => c.id === clientId) : undefined;
  const clientLabel = clientId === NEW ? clientName.trim() || 'New client' : client?.name ?? '';

  // where the files will land, in words, and whether there's enough to go on
  const where =
    tab === 'library'
      ? libNew
        ? `Library › ${libName.trim() || 'New folder'}`
        : 'Library'
      : tab === 'folder'
        ? folderId
          ? ['Library', ...s.path(folderId).map(nameOf)].join(' › ')
          : 'Choose a folder'
        : clientId
          ? ['Clients', clientLabel, ...(inClient === 'new' ? [clientFolder.trim() || 'New folder'] : [])].join(' › ')
          : 'Choose a client';
  const ready =
    tab === 'library'
      ? !libNew || !!libName.trim()
      : tab === 'folder'
        ? !!folderId
        : !!clientId && (clientId !== NEW || !!clientName.trim()) && (inClient === 'home' || !!clientFolder.trim());

  const go = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      let target: string | null = null;
      let made = '';
      if (tab === 'library') {
        if (libNew) {
          target = (await op<{ id: string }>('folder.create', { parentId: null, name: { en: libName.trim() } })).id;
          made = `Created “${libName.trim()}”`;
        }
      } else if (tab === 'folder') {
        target = folderId;
      } else {
        let cid = clientId!;
        if (cid === NEW) {
          cid = (await op<{ id: string }>('clients.create', { name: clientName.trim() })).id;
          made = `Added ${clientName.trim()}`;
        }
        target =
          inClient === 'new'
            ? (await op<{ id: string }>('clients.newFolder', { clientId: cid, name: clientFolder.trim(), share })).id
            : (await op<{ id: string }>('clients.home', { clientId: cid })).id;
      }
      onClose();
      if (made) s.toast(made, { tone: 'ok' });
      await s.reload();
      s.go({ page: 'folder', id: target });
      void s.upload(files, target);
    } catch (e) {
      s.toast(errText(e), { tone: 'err' });
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`Upload ${files.length} ${files.length === 1 ? 'file' : 'files'}`}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="upto-where" title={where}>
            <IFolder /> {where}
          </span>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button kind="primary" icon={<IUpload />} disabled={!ready || busy} onClick={go}>
            Upload
          </Button>
        </>
      }
    >
      <div className="upto">
        <div className="upto-files">
          <span className="upto-thumbs">
            {previews.length ? previews.map((u) => <img key={u} src={u} alt="" />) : <IUpload />}
          </span>
          <span>
            <b>{files.length === 1 ? files[0].name : `${files.length} files`}</b>
            <small>{fmtSize(size)} · where should {files.length === 1 ? 'it' : 'they'} go?</small>
          </span>
        </div>

        <Segmented
          label="Upload to"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'library', label: 'Library' },
            { value: 'folder', label: 'A folder' },
            { value: 'client', label: 'A client' },
          ]}
        />

        {tab === 'library' && (
          <div className="upto-list">
            <button type="button" className={`upto-row${!libNew ? ' on' : ''}`} onClick={() => setLibNew(false)}>
              <span className="upto-ico"><IFolder /></span>
              <span className="upto-text">
                <b>Top of the Library</b>
                <small>Not in a folder — drag them into folders later</small>
              </span>
              {!libNew && <ICheck className="upto-check" />}
            </button>
            <button type="button" className={`upto-row${libNew ? ' on' : ''}`} onClick={() => setLibNew(true)}>
              <span className="upto-ico"><IPlus /></span>
              <span className="upto-text">
                <b>New folder</b>
                <small>Make a folder in the Library and put them in it</small>
              </span>
              {libNew && <ICheck className="upto-check" />}
            </button>
            {libNew && <input className="upto-input" autoFocus placeholder="Folder name, e.g. Raya 2027" value={libName} onChange={(e) => setLibName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />}
          </div>
        )}

        {tab === 'folder' && (
          <div className="upto-list">
            <label className="upto-search">
              <ISearch />
              <input autoFocus placeholder="Find a folder…" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <div className="upto-scroll">
              {folders.length ? (
                folders.map(({ f, path }) => (
                  <button type="button" key={f.id} className={`upto-row${folderId === f.id ? ' on' : ''}`} onClick={() => setFolderId(f.id)}>
                    <FolderGlyph f={f} small />
                    <span className="upto-text">
                      <b>{path[path.length - 1]}</b>
                      {path.length > 1 && <small>{path.slice(0, -1).join(' › ')}</small>}
                    </span>
                    {folderId === f.id && <ICheck className="upto-check" />}
                  </button>
                ))
              ) : (
                <p className="muted upto-empty">{q ? 'No folder matches that.' : 'No folders yet — use Library › New folder.'}</p>
              )}
            </div>
          </div>
        )}

        {tab === 'client' && (
          <div className="upto-list">
            <div className="upto-scroll short">
              {s.clients.map((c) => (
                <button type="button" key={c.id} className={`upto-row${clientId === c.id ? ' on' : ''}`} onClick={() => setClientId(c.id)}>
                  <ClientAvatar c={c} size={28} />
                  <span className="upto-text">
                    <b>{c.name}</b>
                  </span>
                  {clientId === c.id && <ICheck className="upto-check" />}
                </button>
              ))}
              <button type="button" className={`upto-row${clientId === NEW ? ' on' : ''}`} onClick={() => setClientId(NEW)}>
                <span className="upto-ico"><IPlus /></span>
                <span className="upto-text">
                  <b>New client</b>
                  <small>Add a client and upload straight into their folder</small>
                </span>
                {clientId === NEW && <ICheck className="upto-check" />}
              </button>
            </div>
            {clientId === NEW && <input className="upto-input" autoFocus placeholder="Client or company name, e.g. Acme Sdn Bhd" value={clientName} onChange={(e) => setClientName(e.target.value)} />}

            {clientId && (
              <div className="upto-sub">
                <span className="upto-sub-label">In {clientLabel}</span>
                <Segmented
                  label="Where in the client"
                  value={inClient}
                  onChange={setInClient}
                  options={[
                    { value: 'home', label: 'Their folder' },
                    { value: 'new', label: 'New folder' },
                  ]}
                />
                {inClient === 'new' && (
                  <>
                    <input className="upto-input" autoFocus placeholder="Folder name, e.g. CNY 2027" value={clientFolder} onChange={(e) => setClientFolder(e.target.value)} />
                    <label className="backup-switch">
                      <span>
                        <strong>Share with {clientLabel}</strong>
                        <small className="muted">They'll see this folder on the client website.</small>
                      </span>
                      <input type="checkbox" role="switch" className="switch" checked={share} onChange={(e) => setShare(e.target.checked)} />
                    </label>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** Drop files on any page that has no place of its own (Recent, Search, Trash, Clients, Team…) → "Upload to…". */
export function GlobalDrop() {
  const s = useStore();
  const [pending, setPending] = useState<File[] | null>(null);
  const page = s.route.page;
  // Home has its own (with Quick upload); a folder or a client's page uploads straight there
  const own = page === 'home' || page === 'folder' || page === 'client';
  const onFiles = useCallback((files: File[]) => files.length && setPending(files), []);
  const over = useFileDrop(onFiles, s.canEdit && !own && !pending);
  return (
    <>
      {over && (
        <div className="drop-overlay">
          <div>
            <IUpload />
            <strong>Drop to upload</strong>
            <span>Next, choose where they go</span>
          </div>
        </div>
      )}
      {pending && <UploadToDialog files={pending} tab={page === 'clients' ? 'client' : 'library'} onClose={() => setPending(null)} />}
    </>
  );
}
