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
  Promise.all([import('virtual:pwa-register'), import('./updates'), import('../store/editor')])
    .then(([{ registerSW }, { useUpdates }, { useEditor }]) => {
      const updateSW = registerSW({
        immediate: true,
        // a new version was downloaded in the background: offer it instead of reloading mid-edit
        onNeedRefresh: () => useUpdates.setState({ swReady: true, applySw: () => void updateSW(true) }),
        onOfflineReady: () => useEditor.getState().toast('Vipad is ready to work offline', 'success'),
        onRegisteredSW: (_url, reg) => reg && setInterval(() => void reg.update().catch(() => undefined), 60 * 60 * 1000),
      });
    })
    .catch(() => undefined);
}

// expose store for automated end-to-end tests
if (import.meta.env.DEV || new URLSearchParams(location.search).has('e2e')) {
  Promise.all([import('../store/editor'), import('../store/multitrack'), import('../store/settings'), import('../store/recording'), import('./updates')]).then(([e, m, s, r, u]) => {
    Object.assign(window as unknown as Record<string, unknown>, { __vipad: e.useEditor, __vipadMT: m.useMultitrack, __vipadSettings: s.useSettings, __vipadRec: r.useRecording, __vipadUpdates: u.useUpdates });
  });
}
