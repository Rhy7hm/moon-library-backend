/*
 * "Add to client folder…": show files in a client's own folder too — as shortcuts, so nothing is copied.
 * The files stay where they are (and in R2 / the Drive backup once); the client sees them inside that folder.
 */
import { nameOf, type Asset } from './api';
import { ClientAvatar } from './clients';
import { IFolder } from './icons';
import { useStore } from './store';
import { Button, Dialog, FolderGlyph } from './ui';

/** Adds files to a folder as shortcuts, with Undo. */
export function useAddTo() {
  const s = useStore();
  return (folderId: string, ids: string[], label: string) =>
    s.run<{ added: number }>('links.add', { folderId, itemIds: ids }, `Added ${ids.length} file${ids.length === 1 ? '' : 's'} to “${label}” — no copies made`, () => s.run('links.remove', { folderId, itemIds: ids }));
}

export function AddToClientDialog({ assets, onClose }: { assets: Asset[]; onClose: () => void }) {
  const s = useStore();
  const add = useAddTo();
  const clients = s.clients.filter((c) => !c.deletedAt);
  const ids = assets.map((a) => a.id);
  const pick = async (folderId: string, label: string) => {
    onClose();
    await add(folderId, ids, label);
  };
  return (
    <Dialog title={assets.length === 1 ? 'Add to a client’s folder' : `Add ${assets.length} files to a client’s folder`} onClose={onClose} footer={<Button onClick={onClose}>Cancel</Button>}>
      <p className="muted addto-note">The files stay where they are. They also show up in the folder you pick, and on the client website if it’s shared. Nothing is copied, so no extra storage.</p>
      {!clients.length ? (
        <p className="muted">No clients yet.</p>
      ) : (
        <div className="addto">
          {clients.map((c) => {
            const space = s.spaceOf(c.id);
            const folders = space ? s.children(space) : [];
            return (
              <div key={c.id} className="addto-client">
                <div className="addto-head">
                  <ClientAvatar c={c} size={24} />
                  <strong>{c.name}</strong>
                </div>
                {folders.length ? (
                  folders.map((f) => {
                    const here = assets.every((a) => a.folderId === f.id || s.linkedIn(f.id).has(a.id));
                    return (
                      <button key={f.id} className="pick-row addto-row" disabled={here} onClick={() => pick(f.id, `${c.name} › ${nameOf(f)}`)}>
                        <FolderGlyph f={f} small />
                        <span>{nameOf(f)}</span>
                        {here && <em className="pick-tag">Already there</em>}
                      </button>
                    );
                  })
                ) : (
                  <p className="muted addto-empty">
                    <IFolder /> No folders yet. Make one with “New folder” on {c.name}’s page.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
