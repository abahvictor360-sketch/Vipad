/** Quick actions from app-icon shortcuts (PWA manifest, Windows jump list, macOS dock, Linux launcher). */
import { useEditor } from '../store/editor';
import { useSettings } from '../store/settings';
import { checkForUpdates } from './updates';

export function runAction(action: string | null) {
  if (!action) return;
  const st = useEditor.getState();
  switch (action) {
    case 'record':
      useSettings.getState().set({ multitrack: false });
      st.setDialog({ type: 'record' }); // one click to start: browsers need a user gesture before the mic/audio can run
      break;
    case 'multitrack':
      useSettings.getState().set({ multitrack: true });
      break;
    case 'library':
      st.setDialog({ type: 'library' });
      break;
    case 'check-updates':
      void checkForUpdates(true);
      break;
  }
}

/** Listen for actions sent by the desktop shell while the app is already open. */
export function listenForDesktopActions() {
  const b = (window as unknown as { vipadDesktop?: { onAction?: (cb: (a: string) => void) => void } }).vipadDesktop;
  b?.onAction?.((a) => runAction(a));
}
