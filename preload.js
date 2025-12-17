const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    onConfig: cb => ipcRenderer.on('config', (_, d) => cb(d)),
    onReload: cb => ipcRenderer.on('reload-config', cb)
});

