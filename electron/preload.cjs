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
  /** Vipad Link: Linux virtual microphone (pactl) and VBAN (Voicemeeter) over UDP. */
  link: {
    micStatus: () => ipcRenderer.invoke('vipad:vmic-status'),
    createMic: () => ipcRenderer.invoke('vipad:vmic-create'),
    removeMic: () => ipcRenderer.invoke('vipad:vmic-remove'),
    vbanSendStart: (opts) => ipcRenderer.invoke('vipad:vban-send-start', opts),
    vbanPacket: (sampleRate, channels, pcm) => ipcRenderer.send('vipad:vban-packet', sampleRate, channels, pcm),
    vbanSendStop: () => ipcRenderer.invoke('vipad:vban-send-stop'),
    vbanRecvStart: (opts) => ipcRenderer.invoke('vipad:vban-recv-start', opts),
    vbanRecvStop: () => ipcRenderer.invoke('vipad:vban-recv-stop'),
    onVbanAudio: (cb) => {
      const h = (_e, p) => cb(p);
      ipcRenderer.on('vipad:vban-audio', h);
      return () => ipcRenderer.removeListener('vipad:vban-audio', h);
    },
    onVbanError: (cb) => {
      const h = (_e, m) => cb(String(m));
      ipcRenderer.on('vipad:vban-error', h);
      return () => ipcRenderer.removeListener('vipad:vban-error', h);
    },
  },
});
