/* Signed out → the sign-in page. Signed in → the shell with the current page, and the viewer on top. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ADMIN_URL, me as loadMe, onSignedOut, signOut, staffMe, type Me } from './api';
import { gsap, motionOK, ScrollTrigger } from './motion';
import { AccountPage } from './pages/Account';
import { CollectionPage } from './pages/Collection';
import { LibraryPage } from './pages/Library';
import { SendPage } from './pages/Send';
import { SignIn } from './pages/SignIn';
import { Viewer } from './pages/Viewer';
import { StoreProvider, useStore } from './store';
import { Shell } from './ui/Shell';

function Pages() {
  const s = useStore();
  const wrap = useRef<HTMLDivElement>(null);
  const key = s.route.page === 'collection' ? `c-${s.route.id}` : s.route.page;
  useLayoutEffect(() => {
    if (motionOK()) gsap.fromTo(wrap.current, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power3.out', clearProps: 'transform' });
    requestAnimationFrame(() => ScrollTrigger.refresh());
  }, [key]);
  return (
    <Shell>
      <div ref={wrap} key={key}>
        {s.route.page === 'library' ? <LibraryPage /> : s.route.page === 'collection' ? <CollectionPage id={s.route.id} /> : s.route.page === 'send' ? <SendPage /> : <AccountPage />}
      </div>
      {s.viewer && <Viewer key={s.viewer.entries[s.viewer.index]?.file.id} />}
    </Shell>
  );
}

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    // a client stays here; a member of staff who is already signed in goes straight to the admin
    loadMe()
      .then(async (r) => {
        if (r.user) return setMe(r as Me);
        const st = await staffMe().catch(() => ({ user: null }));
        if (st.user) return location.replace(ADMIN_URL);
        setMe(null);
      })
      .catch(() => setMe(null));
    onSignedOut(() => setMe(null));
    return () => onSignedOut(null);
  }, []);
  const out = useCallback(() => {
    signOut().catch(() => {});
    setMe(null);
    history.replaceState(null, '', location.pathname);
  }, []);
  if (me === undefined)
    return (
      <div className="boot">
        <span className="boot-moon" />
      </div>
    );
  if (!me) return <SignIn onIn={setMe} />;
  return (
    <StoreProvider me={me} onSignOut={out}>
      <Pages />
    </StoreProvider>
  );
}
