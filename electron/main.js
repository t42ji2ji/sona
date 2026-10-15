const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('node:path')
const { startBackend, backendCommand } = require('./backend')

const BG = '#121212'
const DEV_URL = 'http://localhost:5173'

let win = null
let backend = null // { port, token, stop }
let logFile = null
let booting = false
let quitting = false
let lastStatus = {}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  app.whenReady().then(() => {
    createWindow()
    boot()
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: BG,
    show: false,
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' }
      : { titleBarStyle: 'hidden', titleBarOverlay: { color: BG, symbolColor: '#ffffff', height: 40 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => { win = null })
  // 介面裡的外部連結交給系統瀏覽器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.loadFile(path.join(__dirname, 'splash.html'))
}

function status(payload) {
  lastStatus = payload
  if (win) win.webContents.send('boot:status', payload)
}

async function boot() {
  if (booting || backend) return
  booting = true
  try { await bootOnce() } finally { booting = false }
}

async function bootOnce() {
  const dataDir = path.join(app.getPath('appData'), 'Sona')
  const uv = app.isPackaged
    ? path.join(process.resourcesPath, 'uv', process.platform === 'win32' ? 'uv.exe' : 'uv')
    : 'uv'
  const backendDir = app.isPackaged ? path.join(process.resourcesPath, 'backend') : path.join(__dirname, '..', 'backend')
  const cmd = backendCommand({ uv, backendDir, dataDir, packaged: app.isPackaged })
  logFile = cmd.logFile

  status({ text: '正在準備執行環境' })
  try {
    backend = await startBackend({
      ...cmd,
      onStatus: (text) => status({ text }),
      onExit: (code) => {
        backend = null
        if (quitting) return
        if (win) win.loadFile(path.join(__dirname, 'splash.html')).then(() => status({ error: `後端意外結束（code ${code}）` }))
      },
    })
  } catch (err) {
    status({ error: err.message })
    return
  }
  status({ text: '正在啟動' })
  if (app.isPackaged) await win.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'))
  else await loadDevUrl()
}

// vite 可能比 electron 晚起來，連不上就重試
async function loadDevUrl() {
  for (;;) {
    try { return await win.loadURL(DEV_URL) } catch { await new Promise((r) => setTimeout(r, 500)) }
  }
}

ipcMain.on('sona:config', (e) => {
  e.returnValue = backend
    ? { apiBase: `http://127.0.0.1:${backend.port}`, token: backend.token, platform: process.platform }
    : { apiBase: null, token: null, platform: process.platform }
})
ipcMain.handle('sona:openExternal', (_e, url) => {
  if (/^https?:/.test(url)) return shell.openExternal(url)
})
ipcMain.handle('sona:pickFile', async (_e, filters) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.handle('boot:status', () => lastStatus)
ipcMain.handle('boot:retry', () => boot())
ipcMain.handle('boot:openLog', () => logFile && shell.openPath(logFile))

app.on('before-quit', (e) => {
  if (!backend || quitting) return
  quitting = true
  e.preventDefault()
  backend.stop().finally(() => app.quit())
})
app.on('window-all-closed', () => app.quit())
