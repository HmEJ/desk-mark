const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    onConfig: cb => ipcRenderer.on('config-updated', (_, d) => cb(d)),
    onVisibility: cb => ipcRenderer.on('watermark-visibility', (_, visible) => cb(visible)),
    getConfig: () => ipcRenderer.invoke('settings:get-config'),
    saveConfig: config => ipcRenderer.invoke('settings:save-config', config),
    toggleWatermark: enabled => ipcRenderer.invoke('settings:toggle-watermark', enabled),
    reloadConfig: () => ipcRenderer.invoke('settings:reload-config')
});

