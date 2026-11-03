# Moon Library — client website

Part of the Moon Library project: the site at the root of **library.moon-interactive.com**. It is also the one sign-in page for everyone — clients sign in with their email and stay here; staff sign in with their ID and go on to the admin at `/admin`.

Clients see the designs, videos and files the team shared with them, and send files back. There is no database of its own: it talks to the Flask server at `/api/client`, so whatever a designer shares in the admin's **Clients** tab appears here straight away.

## Run it

Nothing extra: `sh start.sh` in the project folder builds this site and serves it at http://127.0.0.1:5100.

To work on it with live reload, keep `sh start.sh` running and, in this folder:

```bash
npm install
npm run dev
```

→ http://localhost:5200. The API and `/admin` are passed through to the server, so staff sign-in works here too. If the server runs elsewhere, copy `.env.example` to `.env` and change `BACKEND_URL`.

A client login: in the admin, **Clients → (a client) → Add login**.

## What clients can do

- **Library** — their collections (the folders shared with them, with everything inside), the newest work, and shared links. Filter by images / videos / documents, or search.
- **Viewer** — full screen, arrow keys or swipe, download the original.
- **Send files** — drag and drop anything (up to 5 GB each), check the list, then press Send. It lands in **From <client>** in the team's library.
- **Account** — light / dark / automatic, change password, sign out.

## On a server

Built with the rest: `(cd client && npm ci && npm run build)` → `client/dist/`, which the Flask server serves at `/` (see the main README and `deploy/nginx.conf.example`).

## Built with

React 19, TypeScript, Vite, and GSAP (SplitText, ScrollTrigger). Animations are turned off for people who ask their device for reduced motion.
