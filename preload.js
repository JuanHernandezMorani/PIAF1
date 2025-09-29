const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    loadImages: () => ipcRenderer.invoke('load-images'),
    saveData: (data) => ipcRenderer.invoke('save-data', data),
    loadExistingData: () => ipcRenderer.invoke('load-existing-data')
});