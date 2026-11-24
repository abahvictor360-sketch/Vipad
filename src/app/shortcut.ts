/**
 * "Create shortcut / Install app".
 * - Chrome / Edge / Android browsers: the native install prompt (adds a desktop / home-screen icon).
 * - Desktop app (Electron): asks the main process to create a desktop shortcut.
 * - iPhone / iPad / other browsers: shows the right manual steps.
 */
import { create } from 'zustand';
import { useEditor } from '../store/editor';
import { isElectron, isNative } from './platform';

interface InstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

export const useInstall = create<{ prompt: InstallPromptEvent | null; installed: boolean }>(() => ({
  prompt: null,
  installed: typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches,
}));

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    useInstall.setState({ prompt: e as InstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => {
    useInstall.setState({ prompt: null, installed: true });
    useEditor.getState().toast('Vipad was added to your device — open it from your desktop or home screen.', 'success');
  });
}

interface DesktopBridge { createShortcut?: () => Promise<{ ok: boolean; path?: string; error?: string }> }
const bridge = () => (window as unknown as { vipadDesktop?: DesktopBridge }).vipadDesktop;

export async function createShortcut(): Promise<void> {
  const ed = useEditor.getState();
  if (isElectron()) {
    const b = bridge();
    if (b?.createShortcut) {
      const r = await b.createShortcut();
      ed.toast(r.ok ? `Desktop shortcut created${r.path ? ` (${r.path})` : ''}` : `Couldn’t create shortcut: ${r.error ?? 'unknown error'}`, r.ok ? 'success' : 'error');
      return;
    }
  }
  if (isNative()) {
    ed.toast('Vipad is installed — it is already on your home screen. Long-press its icon for quick actions.', 'info');
    return;
  }
  const p = useInstall.getState().prompt;
  if (p) {
    await p.prompt();
    const { outcome } = await p.userChoice;
    useInstall.setState({ prompt: null });
    if (outcome === 'dismissed') ed.toast('No problem — you can install Vipad any time from Help → Create Shortcut.', 'info');
    return;
  }
  ed.setDialog({ type: 'shortcut' });
}
