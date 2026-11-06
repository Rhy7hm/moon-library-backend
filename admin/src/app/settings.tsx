/*
 * Settings: Account (password), Appearance (theme, accent colour), Devices (where you're signed in)
 * and, for Owners, Connections (MySQL, R2 and Google Drive checked live).
 */
import { useEffect, useRef, useState } from 'react';
import {
  backupNow,
  backupSettings,
  backupStatus,
  changePassword,
  clearMyAvatar,
  driveDisconnect,
  connectionStatus,
  errText,
  revokeOtherSessions,
  revokeSession,
  roleLabel,
  sessions as loadSessions,
  setMyAvatar,
  type BackupResult,
  type BackupStatus,
  type Check,
} from './api';
import { encodeAvatar } from './avatar-encode';
import { fmtAgo, fmtDate } from './format';
import { ICheck, IDevice } from './icons';
import { useStore } from './store';
import { ACCENTS, useAccent, useTheme, type Theme } from './theme';
import { Button, ConfirmDialog, PageHeader, Segmented, UserAvatar } from './ui';

export type SettingsTab = 'account' | 'appearance' | 'devices' | 'connections';

export function SettingsPage({ tab: asked }: { tab: SettingsTab }) {
  const s = useStore();
  const owner = s.isOwner;
  const tab = asked === 'connections' && !owner ? 'account' : asked;
  return (
    <div className="page narrow">
      <PageHeader title="Settings" sub={`Signed in as ${s.me.name} (@${s.me.username}) · ${roleLabel(s.me.role)}`} />
      <div className="settings-tabs">
        <Segmented
          label="Settings section"
          value={tab}
          onChange={(t) => s.go({ page: 'settings', tab: t })}
          options={[
            { value: 'account', label: 'Account' },
            { value: 'appearance', label: 'Appearance' },
            { value: 'devices', label: 'Devices' },
            ...(owner ? [{ value: 'connections' as const, label: 'Connections' }] : []),
          ]}
        />
      </div>
      <div className="settings-body" key={tab}>
        {tab === 'account' ? <Account /> : tab === 'appearance' ? <Appearance /> : tab === 'devices' ? <Devices /> : <Connections />}
      </div>
    </div>
  );
}

/* ---------------- Appearance ---------------- */

const THEMES: { value: Theme; label: string; hint: string }[] = [
  { value: 'light', label: 'Light', hint: 'Always light' },
  { value: 'dark', label: 'Dark', hint: 'Always dark' },
  { value: 'system', label: 'Automatic', hint: 'Follows your computer' },
  { value: '3d', label: '3D', hint: 'Soft colours, 3D icons' },
];

/** A tiny drawing of the app in a theme: sidebar, top bar, two cards. */
function ThemePreview({ mode }: { mode: Theme }) {
  const half = mode === 'system';
  if (mode === '3d') {
    const icon = (n: string) => <img src={`${import.meta.env.BASE_URL}nav/${n}.webp`} alt="" />;
    return (
      <span className="theme-preview" aria-hidden>
        <span className="tp-half tp-3d">
          <span className="tp-side tp-side-3d">
            {icon('home')}
            {icon('collection')}
            {icon('recent')}
          </span>
          <span className="tp-main">
            <span className="tp-bar" />
            <span className="tp-cards">
              <i />
              <i />
            </span>
          </span>
        </span>
      </span>
    );
  }
  return (
    <span className={`theme-preview ${mode}`} aria-hidden>
      {(half ? ['light', 'dark'] : [mode]).map((m) => (
        <span key={m} className={`tp-half tp-${m}`}>
          <span className="tp-side">
            <i />
            <i />
            <i />
          </span>
          <span className="tp-main">
            <span className="tp-bar" />
            <span className="tp-cards">
              <i />
              <i />
            </span>
          </span>
        </span>
      ))}
    </span>
  );
}

function Appearance() {
  const [theme, setTheme] = useTheme();
  const [accent, setAccent] = useAccent();
  return (
    <>
      <section className="panel">
        <h3>Theme</h3>
        <p className="muted panel-sub">Saved on this browser only, so each person (and each computer) can choose.</p>
        <div className="theme-cards" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button key={t.value} type="button" role="radio" aria-checked={theme === t.value} className={`theme-card${theme === t.value ? ' on' : ''}`} onClick={() => setTheme(t.value)}>
              <ThemePreview mode={t.value} />
              <span className="theme-card-label">
                <strong>{t.label}</strong>
                <small>{t.hint}</small>
              </span>
              {theme === t.value && (
                <span className="theme-card-check">
                  <ICheck />
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      {theme !== '3d' && (
        <section className="panel">
          <h3>Accent colour</h3>
          <p className="muted panel-sub">Used for selections, links, the current page and focus rings.</p>
          <div className="accent-row" role="radiogroup" aria-label="Accent colour">
            {ACCENTS.map((a) => (
              <button
                key={a.value}
                type="button"
                role="radio"
                aria-checked={accent === a.value}
                className={`accent-swatch${accent === a.value ? ' on' : ''}`}
                style={{ ['--l' as string]: a.light, ['--d' as string]: a.dark }}
                onClick={() => setAccent(a.value)}
              >
                <span className="accent-dot">{accent === a.value && <ICheck />}</span>
                <small>{a.label}</small>
              </button>
            ))}
          </div>
          <div className="accent-sample">
            <span className="accent-sample-chip">Selected</span>
            <a href="#/settings/appearance" onClick={(e) => e.preventDefault()}>A link</a>
            <span className="accent-sample-toggle" />
          </div>
        </section>
      )}
    </>
  );
}

/* ---------------- Account ---------------- */

function Account() {
  const s = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState('');
  const mismatch = again && next !== again;

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoErr('');
    setBusy(true);
    let url: string | null = null;
    try {
      const data = await encodeAvatar(file);
      url = URL.createObjectURL(file);
      setPreviewUrl(url);
      const r = await setMyAvatar(data);
      s.setMe({ avatarKey: r.avatarKey });
      s.toast('Photo updated', { tone: 'ok' });
    } catch (e) {
      setPhotoErr(e instanceof Error ? e.message : errText(e));
    } finally {
      if (url) URL.revokeObjectURL(url);
      setPreviewUrl(null);
      setBusy(false);
    }
  };

  const removePhoto = async () => {
    setBusy(true);
    setPhotoErr('');
    try {
      await clearMyAvatar();
      s.setMe({ avatarKey: null });
      s.toast('Photo removed', { tone: 'ok' });
    } catch (e) {
      s.toast(errText(e), { tone: 'err' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="panel">
        <h3>Profile</h3>
        <div className="profile-row">
          <div className="profile-photo">
            <button
              type="button"
              className="profile-photo-btn"
              aria-label={s.me.avatarKey ? 'Change photo' : 'Add photo'}
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <UserAvatar user={s.me} size="lg" previewUrl={previewUrl} />
              <span className="profile-photo-hint">{s.me.avatarKey || previewUrl ? 'Change' : 'Add photo'}</span>
            </button>
            {(s.me.avatarKey || previewUrl) && (
              <button type="button" className="btn plain sm" disabled={busy} onClick={removePhoto}>
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
          <div>
            <strong>{s.me.name}</strong>
            <p className="muted">
              @{s.me.username} · {roleLabel(s.me.role)}
            </p>
          </div>
        </div>
        {photoErr && <p className="field-err">{photoErr}</p>}
        <p className="muted small">An Owner can change names and roles in Manage → Team.</p>
      </section>
      <section className="panel">
        <h3>Password</h3>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await changePassword(cur, next);
              setCur('');
              setNext('');
              setAgain('');
              s.toast('Password changed', { tone: 'ok' });
            } catch (err) {
              s.toast(errText(err), { tone: 'err' });
            }
          }}
        >
          <label className="field">
            <span>Current password</span>
            <input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
          </label>
          <label className="field">
            <span>New password</span>
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            <small>At least 8 characters.</small>
          </label>
          <label className="field">
            <span>New password again</span>
            <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
            {mismatch && <small className="err">The two don’t match.</small>}
          </label>
          <Button kind="primary" disabled={!cur || next.length < 8 || next !== again} type="submit">
            Change password
          </Button>
        </form>
      </section>
      <section className="panel">
        <h3>About</h3>
        <p className="muted">Moon Library is your team’s workspace for images, videos, documents and design files. Only people added in Team can sign in.</p>
      </section>
    </>
  );
}

/* ---------------- Devices ---------------- */

type Session = { id: string; created_at: number; last_seen: number; ip: string | null; ua: string | null; current: boolean };

function device(ua: string | null) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Computer';
  return `${browser} on ${os}`;
}

function Devices() {
  const s = useStore();
  const [list, setList] = useState<Session[] | null>(null);
  const load = () => loadSessions().then((r) => setList(r.sessions), () => setList([]));
  useEffect(() => {
    load();
  }, []);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Where you’re signed in</h3>
        {list && list.length > 1 && (
          <Button size="sm" onClick={() => revokeOtherSessions().then(load, (e) => s.toast(errText(e), { tone: 'err' }))}>
            Sign out other devices
          </Button>
        )}
      </div>
      {!list ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="list-flat">
          {list.map((x) => (
            <div className="list-row" key={x.id}>
              <span className="row-icon">
                <IDevice />
              </span>
              <span className="list-text">
                <strong>
                  {device(x.ua)} {x.current && <em className="you">This device</em>}
                </strong>
                <small>
                  {x.ip ?? 'Unknown address'} · signed in {fmtDate(x.created_at)} · active {fmtAgo(x.last_seen)}
                </small>
              </span>
              {!x.current && (
                <Button size="sm" kind="plain" onClick={() => revokeSession(x.id).then(load)}>
                  Sign out
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------------- Connections ---------------- */

const CONN_ICON: Record<Check['key'], React.ReactNode> = {
  mysql: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="6" rx="7" ry="2.8" />
      <path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6" />
    </svg>
  ),
  r2: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.1 4.75 4.75 0 0 0 7 18.5z" />
    </svg>
  ),
  drive: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
      <path d="M8.6 4h6.8l6.1 10.6-3.4 5.9H5.9l-3.4-5.9z" />
      <path d="M8.6 4l6.1 10.6h6.8M15.4 4 9.3 14.6 5.9 20.5M2.5 14.6h12.2" />
    </svg>
  ),
};
const CONN_ORDER: { key: Check['key']; name: string }[] = [
  { key: 'mysql', name: 'MySQL database' },
  { key: 'r2', name: 'Cloudflare R2 storage' },
  { key: 'drive', name: 'Google Drive backup' },
];
const STATE_LABEL = { ok: 'Connected', fail: 'Problem', off: 'Off' } as const;

function Connections() {
  const [data, setData] = useState<{ checkedAt: number; checks: Check[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      setData(await connectionStatus());
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    run();
  }, []);
  const byKey = new Map((data?.checks ?? []).map((c) => [c.key, c]));
  const problems = (data?.checks ?? []).filter((c) => c.state === 'fail').length;
  const warnings = (data?.checks ?? []).filter((c) => c.state === 'ok' && c.warning).length;
  const overall = !data ? 'checking' : problems ? 'fail' : warnings ? 'warn' : 'ok';
  return (
    <>
      <section className="panel conn-head">
        <span className={`conn-orb ${busy ? 'checking' : overall}`} aria-hidden>
          <i />
        </span>
        <div className="conn-head-text">
          <h3>{busy && !data ? 'Checking connections…' : overall === 'ok' ? 'Everything is connected' : overall === 'warn' ? 'Connected, with a warning' : overall === 'fail' ? `${problems} connection${problems === 1 ? '' : 's'} need${problems === 1 ? 's' : ''} attention` : 'Checking connections…'}</h3>
          <p className="muted">
            {data ? <>Checked live from the server {fmtAgo(data.checkedAt)}. </> : null}A test file is written to R2 and deleted straight away.
          </p>
        </div>
        <Button onClick={run} disabled={busy} icon={<span className={`conn-refresh${busy ? ' spin' : ''}`}>↻</span>}>
          {busy ? 'Checking…' : 'Check again'}
        </Button>
      </section>
      {error && <p className="err">{error}</p>}
      <div className={`conn-grid${busy ? ' is-busy' : ''}`}>
        {CONN_ORDER.map(({ key, name }, i) => {
          const c = byKey.get(key);
          const state = busy || !c ? 'checking' : c.warning && c.state === 'ok' ? 'warn' : c.state;
          return (
            <section key={key} className={`panel conn-card ${state}`} style={{ animationDelay: `${i * 60}ms` }}>
              <div className="conn-top">
                <span className="conn-title">
                  <span className="conn-icon">{CONN_ICON[key]}</span>
                  <div>
                    <h4>{name}</h4>
                    {state !== 'checking' && (
                      <p className="conn-summary">
                        {c!.state === 'fail' ? 'Can’t connect' : c!.summary}
                        {c!.state !== 'off' && <em>{c!.ms} ms</em>}
                      </p>
                    )}
                  </div>
                </span>
                <span className={`conn-pill ${state}`}>
                  <i />
                  {state === 'checking' ? 'Checking' : state === 'warn' ? 'Warning' : STATE_LABEL[c!.state]}
                </span>
              </div>
              {state === 'checking' ? (
                <div className="conn-skel">
                  <span />
                  <span />
                </div>
              ) : (
                <>
                  {c!.error && <p className="conn-msg fail">{c!.error}</p>}
                  {c!.warning && <p className="conn-msg warn">{c!.warning}</p>}
                  {c!.note && <p className="conn-msg note">{c!.note}</p>}
                  {c!.facts && c!.facts.length > 0 && (
                    <dl className="conn-facts">
                      {c!.facts.map((f) => (
                        <div key={f.label}>
                          <dt>{f.label}</dt>
                          <dd title={String(f.value)}>{f.kind === 'time' ? fmtAgo(Number(f.value)) : f.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {key === 'drive' && c!.state === 'ok' && <BackupPanel />}
                  {key === 'drive' && <DriveAccount c={c!} onChange={run} />}
                  {c!.link && (
                    <a className="conn-link" href={c!.link} target="_blank" rel="noreferrer noopener">
                      Open in Google Drive ↗
                    </a>
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

/** What a "Back up now" run did, in words. */
function resultText(r: BackupResult) {
  if (r.error) return { tone: 'err' as const, text: `Backup stopped: ${r.error}` };
  if (!r.ran) return { tone: 'info' as const, text: 'A backup is already running — it carries on by itself.' };
  const done = [
    r.copied && `${r.copied} file${r.copied === 1 ? '' : 's'} copied`,
    r.created && `${r.created} folder${r.created === 1 ? '' : 's'} made`,
    r.updated && `${r.updated} renamed or moved`,
    r.toOld && `${r.toOld} moved to _Old versions`,
    r.removed && `${r.removed} deleted file${r.removed === 1 ? '' : 's'} moved to Drive's Trash`,
  ].filter(Boolean);
  const head = done.length ? done.join(', ') : 'Nothing new to copy — everything is backed up';
  if (r.failed) return { tone: 'warn' as const, text: `${head}. ${r.failed} file${r.failed === 1 ? '' : 's'} failed and will be retried.` };
  if (r.remaining) return { tone: 'info' as const, text: `${head}. More to go — press again, or the server timer carries on.` };
  return { tone: 'ok' as const, text: head + '.' };
}

/** Google Drive card: how far the backup has got, files that keep failing, and "Back up now". */
function BackupPanel() {
  const s = useStore();
  const [st, setSt] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<ReturnType<typeof resultText> | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    backupStatus().then(setSt, () => setSt(null));
  }, []);
  // while a run is going (timer or another person's button), look again every few seconds
  useEffect(() => {
    if (!st?.running || busy) return;
    const t = setTimeout(() => backupStatus().then(setSt, () => {}), 4000);
    return () => clearTimeout(t);
  }, [st, busy]);
  const go = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await backupNow();
      setSt(r.status);
      const m = resultText(r.result);
      setMsg(m);
      if (m.tone === 'ok') s.toast('Backup done', { tone: 'ok' });
    } catch (e) {
      setMsg({ tone: 'err', text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  if (!st) return null;
  const pct = st.total ? Math.round((st.backedUp / st.total) * 100) : 100;
  const running = busy || st.running;
  return (
    <div className="backup">
      <div className="backup-top">
        <div>
          <strong>
            {st.total ? `${st.backedUp.toLocaleString()} of ${st.total.toLocaleString()} files backed up` : 'No files to back up yet'}
          </strong>
          <small className="muted">
            {[
              st.waiting > 0 && `${st.waiting.toLocaleString()} waiting`,
              st.failed > 0 && `${st.failed} failing`,
              st.old > 0 && `${st.old.toLocaleString()} old version${st.old === 1 ? '' : 's'} kept`,
              st.lastRun ? `last run ${fmtAgo(st.lastRun)}` : 'not run yet',
              st.verifiedAt && `full check ${fmtAgo(st.verifiedAt)}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </small>
        </div>
        <Button kind="primary" size="sm" onClick={go} disabled={running} icon={<span className={`conn-refresh${running ? ' spin' : ''}`}>↻</span>}>
          {busy ? 'Backing up…' : st.running ? 'Running…' : 'Back up now'}
        </Button>
      </div>
      <div className={`backup-bar${running ? ' live' : ''}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Backed up">
        <i style={{ width: `${pct}%` }} />
      </div>
      {busy && <p className="muted small">Copying for up to 20 seconds — big files continue on the next run.</p>}
      {msg && <p className={`conn-msg ${msg.tone === 'err' ? 'fail' : msg.tone === 'warn' ? 'warn' : msg.tone === 'ok' ? 'ok' : 'note'}`}>{msg.text}</p>}
      <label className="backup-switch">
        <span>
          <strong>Remove from Drive when deleted for good</strong>
          <small className="muted">
            After Delete now, Empty Trash or the 90-day clean-up, the Drive copy goes to Google Drive's Trash (you can still get it back there for 30 days). Moving something to the library's Trash never touches Drive.
          </small>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={!!st.mirrorDeletes}
          disabled={saving || !s.powers.settings}
          title={s.powers.settings ? undefined : 'Only the Super admin can change this'}
          onChange={async (e) => {
            const on = e.target.checked;
            setSaving(true);
            try {
              setSt((await backupSettings({ mirrorDeletes: on })).status);
              s.toast(on ? 'Deleted files will be removed from Drive too' : 'Drive keeps everything, even deleted files', { tone: 'ok' });
            } catch (err) {
              s.toast(errText(err), { tone: 'err' });
            } finally {
              setSaving(false);
            }
          }}
        />
      </label>
      {st.failing.length > 0 && (
        <div className="backup-fails">
          <span className="muted small">Keeps failing</span>
          {st.failing.slice(0, 5).map((f) => (
            <div key={f.name + f.nextTry} className="backup-fail">
              <strong title={f.name}>{f.name}</strong>
              <small>
                {f.error || 'Unknown error'} · tried {f.attempts}×{f.nextTry ? ` · next try ${fmtAgo(f.nextTry).replace(' ago', '')}` : ''}
              </small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The Drive card's sign-in: "Connect Google Drive" (goes to Google, comes back here) when nothing is
 * connected, or who is connected and "Disconnect". Only when the OAuth client is set up on the server.
 */
function DriveAccount({ c, onChange }: { c: Check; onChange: () => void }) {
  const s = useStore();
  const [asking, setAsking] = useState(false);
  if (!c.canConnect) return null;
  if (!s.powers.settings) {
    return (
      <div className="drive-connect">
        <div>
          <strong>{c.connected ? `Connected as ${c.account}` : 'Google Drive isn’t connected'}</strong>
          <small className="muted">Only the Super admin can connect or disconnect Google Drive.</small>
        </div>
      </div>
    );
  }
  const connect = () => (window.location.href = '/api/admin/drive/connect');
  if (!c.connected) {
    return (
      <div className="drive-connect">
        <div>
          <strong>{c.state === 'fail' ? 'Connect Google Drive again' : 'Back up to your Google Drive'}</strong>
          <small className="muted">Sign in with the Google account to copy into. Moon Library can only see the backup files it makes itself.</small>
        </div>
        <button type="button" className="google-btn" onClick={connect}>
          <GoogleG /> Connect Google Drive
        </button>
      </div>
    );
  }
  return (
    <div className="drive-connect connected">
      <div>
        <strong>Connected as {c.account}</strong>
        <small className="muted">Backs up into “Moon Library backup” in this account's My Drive.</small>
      </div>
      <span className="drive-connect-actions">
        {c.state === 'fail' && (
          <Button size="sm" onClick={connect}>
            Reconnect
          </Button>
        )}
        <Button size="sm" kind="plain" onClick={() => setAsking(true)}>
          Disconnect
        </Button>
      </span>
      {asking && (
        <ConfirmDialog
          title="Disconnect Google Drive?"
          text={`The backup stops, and Moon Library gives up its access to ${c.account}. What's already in Drive stays there.`}
          action="Disconnect"
          danger
          onClose={() => setAsking(false)}
          onConfirm={async () => {
            setAsking(false);
            try {
              await driveDisconnect();
              s.toast('Google Drive disconnected', { tone: 'ok' });
            } catch (e) {
              s.toast(errText(e), { tone: 'err' });
            }
            onChange();
          }}
        />
      )}
    </div>
  );
}

/** Google's "G", for the sign-in button (their brand rules ask for it on Google sign-in buttons). */
function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

