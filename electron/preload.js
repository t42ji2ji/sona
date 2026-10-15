const { contextBridge, ipcRenderer } = require('electron')

const config = ipcRenderer.sendSync('sona:config')

contextBridge.exposeInMainWorld('sona', {
  apiBase: config.apiBase,
  token: config.token,
  platform: config.platform,
  openExternal: (url) => ipcRenderer.invoke('sona:openExternal', url),
  pickFile: (filters) => ipcRenderer.invoke('sona:pickFile', filters),
  pickFolder: (defaultPath) => ipcRenderer.invoke('sona:pickFolder', defaultPath),
})

// 只給 splash.html 用
contextBridge.exposeInMainWorld('sonaBoot', {
  onStatus: (cb) => {
    ipcRenderer.on('boot:status', (_e, s) => cb(s))
    ipcRenderer.invoke('boot:status').then(cb)
  },
  retry: () => ipcRenderer.invoke('boot:retry'),
  openLog: () => ipcRenderer.invoke('boot:openLog'),
})
