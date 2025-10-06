const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

async function buildPaths() {
  const docsPath = await ipcRenderer.invoke('get-documents-path');
  const baseDocs = path.join(docsPath, 'DataTextureGUI');
  const dirs = {
    base: baseDocs,
    unboxed: path.join(baseDocs, 'unboxedTextures'),
    normal: path.join(baseDocs, 'normalTextures'),
    labels: path.join(baseDocs, 'labels'),
    train: path.join(baseDocs, 'trainingData'),
    config: path.join(baseDocs, 'config')
  };

  const modeFiles = {
    minecraft: {
      jsonl: path.join(dirs.train, 'trainDataMinecraft.jsonl'),
      fullJsonl: path.join(dirs.train, 'trainDataMinecraft.full.jsonl'),
      yaml: path.join(dirs.train, 'datasetMinecraft.yaml')
    },
    texture: {
      jsonl: path.join(dirs.train, 'trainDataNormal.jsonl'),
      fullJsonl: path.join(dirs.train, 'trainDataNormal.full.jsonl'),
      yaml: path.join(dirs.train, 'datasetNormal.yaml')
    }
  };

  contextBridge.exposeInMainWorld('PIAF_PATHS', { dirs, modeFiles });
}

buildPaths().catch(err => {
  console.error('Failed to expose PIAF_PATHS:', err);
});

contextBridge.exposeInMainWorld('electronAPI', {
  loadImages: () => ipcRenderer.invoke('load-images'),
  loadExistingData: () => ipcRenderer.invoke('load-existing-data'),
  saveJsonl: data => ipcRenderer.invoke('save-jsonl', data),
  saveData: data => ipcRenderer.invoke('save-jsonl', data),
  saveYoloTxtBatch: perImageLines => ipcRenderer.invoke('save-yolo-txt-batch', perImageLines),
  exportDataset: payload => ipcRenderer.invoke('export-dataset', payload),
  loadClasses: () => ipcRenderer.invoke('load-classes'),
  saveClasses: classes => ipcRenderer.invoke('save-classes', classes),
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: cfg => ipcRenderer.invoke('save-config', cfg),
  ensureAletas: () => ipcRenderer.invoke('ensure-aletas')
});
