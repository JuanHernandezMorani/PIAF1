const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loadImages: () => ipcRenderer.invoke('load-images'),
  loadExistingData: () => ipcRenderer.invoke('load-existing-data'),
  saveJsonl: data => ipcRenderer.invoke('save-jsonl', data),
  saveData: data => ipcRenderer.invoke('save-jsonl', data),
  saveYoloTxtBatch: perImageLines => ipcRenderer.invoke('save-yolo-txt-batch', perImageLines),
  exportDataset: payload => ipcRenderer.invoke('export-dataset', payload),
  loadClasses: () => ipcRenderer.invoke('load-classes'),
  saveClasses: classes => ipcRenderer.invoke('save-classes', classes)
});