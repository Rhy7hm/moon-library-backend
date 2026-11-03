/*
 * Tags: short coloured labels on files ("CNY 2027", "approved", "IG story").
 *   <TagChip>     one label (click it to search for everything with it)
 *   <TagEditor>   the tags on one or more files: × to take one off, type to add (with suggestions)
 *   <TagDialog>   tag many selected files at once
 * Typing a name that doesn't exist yet makes the tag.
 */
import { useMemo, useRef, useState } from 'react';
import type { Tag } from './api';
import { IX } from './icons';
import { useStore } from './store';
import { Button, Dialog } from './ui';

export function TagChip({ tag, onRemove, onClick, small }: { tag: Tag; onRemove?: () => void; onClick?: () => void; small?: boolean }) {
  const style = { ['--t' as string]: tag.color || '#8e8e93' };
  return (
    <span className={`tag-chip${small ? ' small' : ''}`} style={style}>
      {onClick ? (
        <button type="button" className="tag-name" onClick={onClick} title={`Find everything tagged “${tag.name}”`}>
          {tag.name}
        </button>
      ) : (
        <span className="tag-name">{tag.name}</span>
      )}
      {onRemove && (
        <button type="button" className="tag-x" aria-label={`Remove tag ${tag.name}`} onClick={onRemove}>
          <IX />
        </button>
      )}
    </span>
  );
}

/** The search for a tag: quoted when it has spaces. */
export const tagQuery = (name: string) => (/\s/.test(name) ? `#"${name}"` : `#${name}`);

/** Tags on these files: the ones all of them share can be removed; anything typed is added to all. */
export function TagEditor({ itemIds, autoFocus }: { itemIds: string[]; autoFocus?: boolean }) {
  const s = useStore();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const items = s.assets.filter((a) => itemIds.includes(a.id));
  // tags every one of these files has
  const common = useMemo(() => {
    if (!items.length) return [];
    const first = new Set(items[0].tags ?? []);
    return [...first].filter((id) => items.every((a) => a.tags?.includes(id))).map((id) => s.tagById.get(id)).filter((t): t is Tag => !!t);
  }, [items, s.tagById]);
  const needle = text.trim().toLowerCase();
  const suggestions = s.tags.filter((t) => !common.some((c) => c.id === t.id) && (!needle || t.name.toLowerCase().includes(needle))).slice(0, 6);
  const exact = s.tags.some((t) => t.name.toLowerCase() === needle);
  const options = [...suggestions.map((t) => ({ key: t.id, label: t.name, tag: t as Tag | null })), ...(needle && !exact ? [{ key: 'new', label: `Create “${text.trim()}”`, tag: null }] : [])];

  const add = async (name: string) => {
    const n = name.trim();
    if (!n) return;
    setText('');
    setHi(0);
    await s.run('tags.set', { itemIds, add: [n] });
    input.current?.focus();
  };
  const remove = (t: Tag) => s.run('tags.set', { itemIds, remove: [t.id] });

  return (
    <div className="tag-editor" onClick={() => input.current?.focus()}>
      {common.map((t) => (
        <TagChip key={t.id} tag={t} onRemove={() => remove(t)} />
      ))}
      <span className="tag-input-wrap">
        <input
          ref={input}
          className="tag-input"
          value={text}
          autoFocus={autoFocus}
          placeholder={common.length ? 'Add a tag…' : 'Add tags, e.g. approved'}
          aria-label="Add a tag"
          onChange={(e) => (setText(e.target.value), setOpen(true), setHi(0))}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setHi((h) => Math.min(h + 1, options.length - 1)));
            else if (e.key === 'ArrowUp') (e.preventDefault(), setHi((h) => Math.max(h - 1, 0)));
            else if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              const o = options[hi];
              add(o?.tag ? o.tag.name : text);
            } else if (e.key === 'Backspace' && !text && common.length) remove(common[common.length - 1]);
            else if (e.key === 'Escape') (e.stopPropagation(), setOpen(false), input.current?.blur());
          }}
        />
        {open && options.length > 0 && (
          <span className="tag-suggest" role="listbox">
            {options.map((o, i) => (
              <button
                key={o.key}
                type="button"
                role="option"
                aria-selected={i === hi}
                className={i === hi ? 'on' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHi(i)}
                onClick={() => add(o.tag ? o.tag.name : text)}
              >
                {o.tag ? <span className="tag-dot" style={{ background: o.tag.color || '#8e8e93' }} /> : <span className="tag-dot new">+</span>}
                {o.label}
              </button>
            ))}
          </span>
        )}
      </span>
    </div>
  );
}

/** Tag several selected files at once. */
export function TagDialog({ itemIds, onClose }: { itemIds: string[]; onClose: () => void }) {
  return (
    <Dialog
      title={`Tag ${itemIds.length} ${itemIds.length === 1 ? 'file' : 'files'}`}
      onClose={onClose}
      footer={
        <Button kind="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <p className="muted panel-sub">Tags the files all share are shown; anything you add goes on every one of them.</p>
      <TagEditor itemIds={itemIds} autoFocus />
    </Dialog>
  );
}
