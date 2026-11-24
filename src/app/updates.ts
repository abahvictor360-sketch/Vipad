/**
 * Update notifications.
 * - Web / PWA: the service worker downloads new versions in the background; when one is ready the
 *   user gets an "Update now" banner (nothing reloads under them while they edit).
 * - Desktop (Electron) and Android: the latest GitHub release is checked at startup and every
 *   6 hours; a newer version shows an in-app banner plus a system notification with a download link.
 * - After updating, a one-time "Updated to vX" message links to the release notes.
 */
import { create } from 'zustand';
import { useSettings } from '../store/settings';
import { useEditor } from '../store/editor';
import { isElectron, isNative } from './platform';

export const REPO = 'abahvictor360-sketch/Vipad';
export const CURRENT = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

export interface AvailableUpdate { version: string; notesUrl: string; downloadUrl: string; publishedAt: string; body: string }

interface UpdateState {
  available: AvailableUpdate | null;
  swReady: boolean;
  applySw: (() => void) | null;
  checking: boolean;
  lastChecked: number | null;
}

export const useUpdates = create<UpdateState>(() => ({ available: null, swReady: false, applySw: null, checking: false, lastChecked: null }));

/** Compare dotted versions ("1.10.0" > "1.9.3"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** The installer that matches this device. */
export function assetForPlatform(): string | null {
  if (isNative()) return /iphone|ipad|ipod/i.test(navigator.userAgent) ? 'Vipad-ios-unsigned.ipa' : 'Vipad-android.apk';
  if (isElectron()) {
    const p = navigator.platform.toLowerCase();
    if (p.includes('win')) return 'Vipad-Setup-x64.exe';
    if (p.includes('mac')) return 'Vipad-mac-universal.dmg';
    return 'Vipad-linux-x86_64.AppImage';
  }
  return null;
}

function notifySystem(u: AvailableUpdate) {
  try {
    if (typeof Notification === 'undefined') return;
    const show = () => {
      const n = new Notification(`Vipad ${u.version} is available`, { body: 'A new version is ready to download. Click to get it.', icon: './icons/icon-192.png', tag: `vipad-update-${u.version}` });
      n.onclick = () => { window.focus(); window.open(u.downloadUrl, '_blank'); };
    };
    if (Notification.permission === 'granted') show();
    else if (Notification.permission === 'default' && isElectron()) void Notification.requestPermission().then((p) => p === 'granted' && show());
  } catch {
    /* notifications unsupported — the in-app banner is enough */
  }
}

/**
 * Check GitHub for a newer release. Installed apps (desktop/mobile) only: the web app is always
 * served at the latest version and updates through the service worker instead.
 */
export async function checkForUpdates(manual = false): Promise<AvailableUpdate | null> {
  const ed = useEditor.getState();
  const installed = isElectron() || isNative();
  if (!installed) {
    if (manual) {
      const sw = useUpdates.getState();
      if (sw.swReady) ed.toast('A new version is ready — press “Update now”.', 'info');
      else {
        try {
          const reg = await navigator.serviceWorker?.getRegistration();
          await reg?.update();
        } catch { /* offline */ }
        ed.toast(useUpdates.getState().swReady ? 'Update downloaded — press “Update now”.' : `You’re on the latest web version (v${CURRENT}).`, 'success');
      }
    }
    return null;
  }
  useUpdates.setState({ checking: true });
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(`GitHub returned ${r.status}`);
    const j = await r.json();
    const version = String(j.tag_name ?? '').replace(/^v/, '');
    useUpdates.setState({ lastChecked: Date.now() });
    if (version && compareVersions(version, CURRENT) > 0) {
      const asset = assetForPlatform();
      const u: AvailableUpdate = {
        version,
        notesUrl: j.html_url ?? `https://github.com/${REPO}/releases/latest`,
        downloadUrl: asset ? `https://github.com/${REPO}/releases/latest/download/${asset}` : `https://github.com/${REPO}/releases/latest`,
        publishedAt: j.published_at ?? '',
        body: String(j.body ?? '').slice(0, 600),
      };
      const s = useSettings.getState();
      if (manual || s.dismissedUpdate !== version) {
        useUpdates.setState({ available: u });
        if (!manual && s.notifyUpdates) notifySystem(u);
      }
      return u;
    }
    if (manual) ed.toast(`You’re up to date — Vipad v${CURRENT} is the latest version.`, 'success');
    return null;
  } catch (e) {
    if (manual) ed.toast(`Couldn’t check for updates: ${(e as Error).message}. Check your internet connection.`, 'error');
    return null;
  } finally {
    useUpdates.setState({ checking: false });
  }
}

export function dismissUpdate() {
  const u = useUpdates.getState().available;
  if (u) useSettings.getState().set({ dismissedUpdate: u.version });
  useUpdates.setState({ available: null });
}

let started = false;
/** Start background update checks and show the "updated to" message once after an update. */
export function startUpdateChecks() {
  if (started) return;
  started = true;
  const s = useSettings.getState();
  if (s.lastSeenVersion && compareVersions(CURRENT, s.lastSeenVersion) > 0) {
    useEditor.getState().toast(`Vipad was updated to v${CURRENT}. See “Help → Check for Updates” for release notes.`, 'success');
  }
  if (s.lastSeenVersion !== CURRENT) s.set({ lastSeenVersion: CURRENT });
  if (!s.notifyUpdates) return;
  setTimeout(() => void checkForUpdates(false), 5000);
  setInterval(() => useSettings.getState().notifyUpdates && void checkForUpdates(false), 6 * 3600 * 1000);
}
