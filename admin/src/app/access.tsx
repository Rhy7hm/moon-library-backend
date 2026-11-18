/*
 * "Who can open this…": limit a folder (and everything inside it) to chosen people.
 * Owners can always open every folder; everyone else on the team only sees a limited folder if they're ticked here.
 * Owner-only — the server refuses anyone else.
 */
import { useEffect, useState } from 'react';
import { errText, nameOf, op, type Folder } from './api';
import { ILock, IUsers } from './icons';
import { useStore } from './store';
import { Button, Dialog, Segmented, UserAvatar } from './ui';

type Person = { id: string; name: string; username: string; role: string; disabled: number; avatarKey?: string | null };

export function AccessDialog({ folder, onClose }: { folder: Folder; onClose: () => void }) {
  const s = useStore();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [limited, setLimited] = useState<boolean>(!!folder.restricted);
  const [sel, setSel] = useState<Set<string>>(() => new Set(folder.access ?? []));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    op<{ users: Person[] }>('users.list', {}).then(
      (r) => live && setPeople(r.users.filter((u) => (u.role === 'editor' || u.role === 'viewer') && !u.disabled)),
      (e) => s.toast(errText(e), { tone: 'err' }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const before = new Set(folder.access ?? []);
  const dirty = limited !== !!folder.restricted || (limited && (sel.size !== before.size || [...sel].some((x) => !before.has(x))));

  const save = async () => {
    setBusy(true);
    const r = await s.run('folder.access', { id: folder.id, restricted: limited, userIds: limited ? [...sel] : [] });
    setBusy(false);
    if (!r) return;
    s.toast(limited ? `“${nameOf(folder)}” is now limited` : `“${nameOf(folder)}” is open to the whole team again`, { tone: 'ok' });
    onClose();
  };

  return (
    <Dialog
      title={`Who can open “${nameOf(folder)}”`}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button kind="primary" disabled={!dirty || busy} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="access">
        <Segmented
          label="Who can open this folder"
          value={limited ? 'some' : 'all'}
          onChange={(v) => setLimited(v === 'some')}
          options={[
            { value: 'all', label: 'Everyone on the team' },
            { value: 'some', label: 'Only chosen people' },
          ]}
        />
        {!limited ? (
          <p className="muted access-note">Everyone on the team can see this folder and what’s in it.</p>
        ) : (
          <>
            <p className="muted access-note">
              <ILock width={14} height={14} /> Only the people you tick, and Owners, can see this folder, its sub-folders and everything in them. For everyone else it doesn’t exist: it won’t show up in the library, search, downloads or the activity log.
            </p>
            {people === null ? (
              <p className="muted access-note">Loading the team…</p>
            ) : people.length === 0 ? (
              <p className="muted access-note">
                <IUsers width={14} height={14} /> There are no Editors or Viewers yet. Add people in Team first; Owners can always open every folder.
              </p>
            ) : (
              <div className="pick-list">
                {people.map((p) => (
                  <label key={p.id} className="pick-row pick-label client-pick">
                    <input
                      type="checkbox"
                      checked={sel.has(p.id)}
                      onChange={() => {
                        const n = new Set(sel);
                        n.has(p.id) ? n.delete(p.id) : n.add(p.id);
                        setSel(n);
                      }}
                    />
                    <UserAvatar user={p} size="sm" />
                    <span>{p.name}</span>
                    <em className="pick-tag">{p.role === 'editor' ? 'Editor' : 'Viewer'}</em>
                  </label>
                ))}
              </div>
            )}
            {people !== null && people.length > 0 && sel.size === 0 && <p className="muted access-note">Nobody ticked: only Owners will be able to open it.</p>}
          </>
        )}
      </div>
    </Dialog>
  );
}
