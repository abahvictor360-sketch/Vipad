import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '../styles/tokens.css';
import '../styles/app.css';
import { App } from './App';
import { isElectron, isNative } from './platform';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support for the web/PWA build (desktop & mobile shells bundle assets locally).
if (!isElectron() && !isNative() && 'serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => undefined);
}

// expose store for automated end-to-end tests
if (import.meta.env.DEV || new URLSearchParams(location.search).has('e2e')) {
  Promise.all([import('../store/editor'), import('../store/multitrack'), import('../store/settings')]).then(([e, m, s]) => {
    Object.assign(window as unknown as Record<string, unknown>, { __vipad: e.useEditor, __vipadMT: m.useMultitrack, __vipadSettings: s.useSettings });
  });
}
