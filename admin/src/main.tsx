/*
 * The staff admin (served by Flask at /admin): the team's library of images, videos,
 * documents and design files. The app lives in src/app; src/lib holds the upload client.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { applySaved } from './app/theme';

applySaved();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
