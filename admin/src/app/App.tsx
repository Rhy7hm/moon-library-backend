/* Signed in → the library; otherwise sign-in (or first-time setup). */
import { useCallback, useEffect, useState } from 'react';
import { errText, getMe, login, setup, type Me } from './api';
import { IMoon } from './icons';
import { Shell } from './shell';
import { StoreProvider } from './store';
import { Button } from './ui';
import './app.css';

type State = { phase: 'loading' } | { phase: 'in'; me: Me } | { phase: 'out'; needsSetup: boolean; needsKey: boolean };

export default function App() {
  const [st, setSt] = useState<State>({ phase: 'loading' });
  const check = useCallback(async () => {
    try {
      const r = await getMe();
      setSt(r.user ? { phase: 'in', me: r.user } : { phase: 'out', needsSetup: !!r.needsSetup, needsKey: !!r.setupNeedsKey });
    } catch {
      setSt({ phase: 'out', needsSetup: false, needsKey: true });
    }
  }, []);
  useEffect(() => {
    check();
  }, [check]);

  if (st.phase === 'loading')
    return (
      <div className="boot">
        <IMoon className="boot-mark" />
      </div>
    );
  if (st.phase === 'out') return <SignIn setupMode={st.needsSetup} needsKey={st.needsKey} onIn={(me) => setSt({ phase: 'in', me })} />;
  return (
    <StoreProvider me={st.me} onSignOut={check}>
      <Shell onSignedOut={check} />
    </StoreProvider>
  );
}

function SignIn({ setupMode, needsKey, onIn }: { setupMode: boolean; needsKey: boolean; onIn: (me: Me) => void }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = setupMode ? await setup({ name: name.trim(), username: username.trim().toLowerCase(), password, key: needsKey ? key : undefined }) : await login(username.trim().toLowerCase(), password);
      onIn(r.user);
    } catch (x) {
      setErr(errText(x));
      setBusy(false);
    }
  };
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <span className="auth-mark">
          <IMoon />
        </span>
        <h1>{setupMode ? 'Welcome to Moon Library' : 'Sign in'}</h1>
        <p className="muted">{setupMode ? 'Create the first Owner account. You can add your team afterwards.' : 'Your team’s images, videos and design files.'}</p>
        {setupMode && (
          <label className="field">
            <span>Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus />
          </label>
        )}
        <label className="field">
          <span>ID</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoFocus={!setupMode} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setupMode ? 'new-password' : 'current-password'} />
          {setupMode && <small>At least 8 characters.</small>}
        </label>
        {setupMode && needsKey && (
          <label className="field">
            <span>Setup key</span>
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} />
            <small>The SETUP_KEY from the server’s settings.</small>
          </label>
        )}
        {err && <p className="auth-err">{err}</p>}
        <Button kind="primary" type="submit" disabled={busy || !username || !password || (setupMode && !name)}>
          {busy ? 'Please wait…' : setupMode ? 'Create account' : 'Sign in'}
        </Button>
      </form>
      <p className="auth-foot">Moon Library</p>
    </div>
  );
}
