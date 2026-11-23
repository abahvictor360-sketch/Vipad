// Vipad desktop shell (Windows, macOS, Linux).
const { app, BrowserWindow, Menu, shell, session, dialog } = require('electron');
const path = require('node:path');

const isMac = process.platform === 'darwin';
let win = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
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
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'dist', 'app.html'));

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

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
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
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
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
    cb(audioOnly || permission === 'clipboard-sanitized-write');
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
