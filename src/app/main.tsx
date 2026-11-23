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
  import('../store/editor').then((m) => ((window as unknown as { __vipad: unknown }).__vipad = m.useEditor));
}
