/* Settings: Account (password), Appearance (theme, accent colour) and Devices (where you're signed in). */
import { useEffect, useState } from 'react';
import { changePassword, errText, revokeOtherSessions, revokeSession, sessions as loadSessions } from './api';
import { fmtAgo, fmtDate } from './format';
import { ICheck, IDevice } from './icons';
import { useStore } from './store';
import { ACCENTS, useAccent, useTheme, type Theme } from './theme';
import { Button, PageHeader, Segmented } from './ui';

export type SettingsTab = 'account' | 'appearance' | 'devices';

export function SettingsPage({ tab }: { tab: SettingsTab }) {
  const s = useStore();
  return (
    <div className="page narrow">
      <PageHeader title="Settings" sub={`Signed in as ${s.me.name} (@${s.me.username}) · ${s.me.role[0].toUpperCase() + s.me.role.slice(1)}`} />
      <div className="settings-tabs">
        <Segmented
          label="Settings section"
          value={tab}
          onChange={(t) => s.go({ page: 'settings', tab: t })}
          options={[
            { value: 'account', label: 'Account' },
            { value: 'appearance', label: 'Appearance' },
            { value: 'devices', label: 'Devices' },
          ]}
        />
      </div>
      <div className="settings-body" key={tab}>
        {tab === 'account' ? <Account /> : tab === 'appearance' ? <Appearance /> : <Devices />}
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
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const mismatch = again && next !== again;
  return (
    <>
      <section className="panel">
        <h3>Profile</h3>
        <div className="profile-row">
          <span className="avatar lg">{s.me.name.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{s.me.name}</strong>
            <p className="muted">
              @{s.me.username} · {s.me.role[0].toUpperCase() + s.me.role.slice(1)}
            </p>
          </div>
        </div>
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
