// Minimal, safe bridge between the desktop shell and the web UI (contextIsolation on, no Node in the page).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vipadDesktop', {
  /** Create a desktop shortcut (Windows .lnk / Linux .desktop). */
  createShortcut: () => ipcRenderer.invoke('vipad:create-shortcut'),
  /** Receive quick actions from the jump list / dock menu / native menu (e.g. "record"). */
  onAction: (cb) => {
    const handler = (_e, action) => cb(String(action));
    ipcRenderer.on('vipad:action', handler);
    return () => ipcRenderer.removeListener('vipad:action', handler);
  },
  platform: process.platform,
});
