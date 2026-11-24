// Vipad desktop shell (Windows, macOS, Linux).
const { app, BrowserWindow, Menu, shell, session, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const vban = require('./vban.cjs');
const virtualMic = require('./virtualmic.cjs');

const ACTIONS = ['record', 'multitrack', 'library', 'check-updates'];
const actionFromArgv = (argv) => {
  const a = argv.find((x) => x.startsWith('--action='));
  const v = a && a.slice('--action='.length);
  return ACTIONS.includes(v) ? v : null;
};
const sendAction = (action) => {
  if (!win || !action) return;
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => win.webContents.send('vipad:action', action));
  else win.webContents.send('vipad:action', action);
};

const isMac = process.platform === 'darwin';
let win = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      sendAction(actionFromArgv(argv));
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#070707',
    title: 'Vipad',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: !isMac,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  win.once('ready-to-show', () => win.show());
  const startAction = actionFromArgv(process.argv);
  win.loadFile(path.join(__dirname, '..', 'dist', 'app.html'), startAction ? { query: { action: startAction } } : undefined);

  // Open external links in the system browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    } else if (!/app\.html/.test(url)) {
      // the bundled landing page redirects to app.html; keep the editor in focus
      e.preventDefault();
    }
  });
  win.on('closed', () => (win = null));
}

/** Create a desktop shortcut for the installed app. */
function createDesktopShortcut() {
  try {
    const desktop = app.getPath('desktop');
    if (process.platform === 'win32') {
      const target = path.join(desktop, 'Vipad.lnk');
      const ok = shell.writeShortcutLink(target, fs.existsSync(target) ? 'replace' : 'create', {
        target: process.execPath,
        description: 'Vipad — audio recorder & editor',
        icon: process.execPath,
        iconIndex: 0,
        appUserModelId: 'com.vipad.app',
      });
      return ok ? { ok: true, path: target } : { ok: false, error: 'Windows refused to create the shortcut' };
    }
    if (process.platform === 'linux') {
      const exec = process.env.APPIMAGE || process.execPath;
      const iconDir = path.join(os.homedir(), '.local', 'share', 'icons');
      fs.mkdirSync(iconDir, { recursive: true });
      const iconPath = path.join(iconDir, 'vipad.png');
      fs.writeFileSync(iconPath, fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.png')));
      const entry = [
        '[Desktop Entry]', 'Type=Application', 'Name=Vipad', 'Comment=Record, edit and perfect your audio',
        `Exec="${exec}" %F`, `Icon=${iconPath}`, 'Terminal=false', 'Categories=AudioVideo;Audio;Recorder;',
        'MimeType=audio/wav;audio/x-wav;audio/mpeg;audio/ogg;audio/flac;audio/mp4;', 'StartupWMClass=Vipad',
        'Actions=record;multitrack;', '', '[Desktop Action record]', 'Name=New recording', `Exec="${exec}" --action=record`,
        '', '[Desktop Action multitrack]', 'Name=Multitrack', `Exec="${exec}" --action=multitrack`, '',
      ].join('\n');
      const appsDir = path.join(os.homedir(), '.local', 'share', 'applications');
      fs.mkdirSync(appsDir, { recursive: true });
      const files = [path.join(appsDir, 'vipad.desktop')];
      if (fs.existsSync(desktop)) files.push(path.join(desktop, 'vipad.desktop'));
      for (const f of files) {
        fs.writeFileSync(f, entry);
        fs.chmodSync(f, 0o755);
      }
      return { ok: true, path: files[files.length - 1] };
    }
    return { ok: false, error: 'On macOS, open Applications and drag Vipad to the Dock (or right-click its Dock icon → Options → Keep in Dock).' };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

function setupQuickActions() {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.vipad.app');
    app.setUserTasks([
      { program: process.execPath, arguments: '--action=record', iconPath: process.execPath, iconIndex: 0, title: 'New recording', description: 'Start a new recording' },
      { program: process.execPath, arguments: '--action=multitrack', iconPath: process.execPath, iconIndex: 0, title: 'Multitrack', description: 'Open the multitrack mixer' },
      { program: process.execPath, arguments: '--action=library', iconPath: process.execPath, iconIndex: 0, title: 'Library', description: 'Saved and recovered recordings' },
    ]);
  }
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setMenu(Menu.buildFromTemplate([
      { label: 'New Recording', click: () => sendAction('record') },
      { label: 'Multitrack', click: () => sendAction('multitrack') },
      { label: 'Library', click: () => sendAction('library') },
    ]));
  }
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Recording', accelerator: 'R', registerAccelerator: false, click: () => sendAction('record') },
        { type: 'separator' },
        ...(process.platform !== 'darwin'
          ? [{
              label: 'Create Desktop Shortcut',
              click: () => {
                const r = createDesktopShortcut();
                dialog.showMessageBox(win, { type: r.ok ? 'info' : 'warning', message: r.ok ? 'Desktop shortcut created' : 'Could not create the shortcut', detail: r.ok ? r.path : r.error });
              },
            }, { type: 'separator' }]
          : []),
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom', label: 'Maximize / Restore' },
        {
          label: 'Always on Top',
          type: 'checkbox',
          checked: false,
          click: (item) => win && win.setAlwaysOnTop(item.checked),
        },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Multitrack Mixer', click: () => sendAction('multitrack') },
        { label: 'Library', click: () => sendAction('library') },
        { type: 'separator' },
        ...(isMac ? [{ role: 'front' }, { role: 'window' }] : [{ role: 'close' }]),
      ],
    },
    {
      role: 'help',
      submenu: [
        { label: 'Check for Updates…', click: () => sendAction('check-updates') },
        { label: 'User Guide', click: () => shell.openExternal('https://vipad-five.vercel.app/guide') },
        { type: 'separator' },
        { label: 'Vipad on GitHub', click: () => shell.openExternal('https://github.com/abahvictor360-sketch/Vipad') },
        { label: 'Report an issue', click: () => shell.openExternal('https://github.com/abahvictor360-sketch/Vipad/issues') },
        {
          label: 'About Vipad',
          click: () => dialog.showMessageBox({ type: 'info', title: 'About Vipad', message: `Vipad ${app.getVersion()}`, detail: 'Audio recorder & editor.' }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  // Only grant the microphone; deny every other permission request.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => {
    const audioOnly = permission === 'media' && (!details.mediaTypes || details.mediaTypes.every((t) => t === 'audio'));
    cb(audioOnly || permission === 'clipboard-sanitized-write' || permission === 'speaker-selection');
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media' || permission === 'speaker-selection');
  ipcMain.handle('vipad:create-shortcut', () => createDesktopShortcut());
  setupLinkIpc();
  buildMenu();
  setupQuickActions();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ---------------------------------------------------------------- Vipad Link: VBAN + Linux virtual microphone
let vbanTx = null;
let vbanRx = null;
function setupLinkIpc() {
  ipcMain.handle('vipad:vmic-status', () => virtualMic.status());
  ipcMain.handle('vipad:vmic-create', () => virtualMic.create());
  ipcMain.handle('vipad:vmic-remove', () => virtualMic.remove());
  ipcMain.handle('vipad:vban-send-start', (_e, opts) => {
    vbanTx?.close();
    vbanTx = vban.createSender({ host: String(opts.host), port: Number(opts.port) || vban.DEFAULT_PORT, streamName: String(opts.streamName || 'Vipad') });
    return true;
  });
  ipcMain.on('vipad:vban-packet', (_e, sampleRate, channels, pcm) => vbanTx?.send(sampleRate, channels, new Int16Array(pcm.buffer ?? pcm, pcm.byteOffset ?? 0, (pcm.byteLength ?? pcm.length * 2) / 2)));
  ipcMain.handle('vipad:vban-send-stop', () => { vbanTx?.close(); vbanTx = null; return true; });
  ipcMain.handle('vipad:vban-recv-start', (e, opts) => {
    vbanRx?.close();
    const wc = e.sender;
    vbanRx = vban.createReceiver({
      port: Number(opts.port) || vban.DEFAULT_PORT,
      streamName: String(opts.streamName || ''),
      onAudio: (p) => !wc.isDestroyed() && wc.send('vipad:vban-audio', { sampleRate: p.sampleRate, channels: p.channels, streamName: p.streamName, from: p.from, samples: p.samples }),
      onError: (err) => !wc.isDestroyed() && wc.send('vipad:vban-error', err.message),
    });
    return true;
  });
  ipcMain.handle('vipad:vban-recv-stop', () => { vbanRx?.close(); vbanRx = null; return true; });
}

app.on('will-quit', () => {
  vbanTx?.close();
  vbanRx?.close();
  void virtualMic.remove();
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
