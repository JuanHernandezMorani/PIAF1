const { contextBridge, ipcRenderer } = require('electron');
const os = require('os');
const path = require('path');

const baseDocs = path.join(os.homedir(), 'Documents', 'DataTextureGUI');
const exposedDirs = {
  base: baseDocs,
  unboxed: path.join(baseDocs, 'unboxedTextures'),
  normal: path.join(baseDocs, 'normalTextures'),
  labels: path.join(baseDocs, 'labels'),
  train: path.join(baseDocs, 'trainingData'),
  config: path.join(baseDocs, 'config')
};

const modeFiles = {
  minecraft: {
    jsonl: path.join(exposedDirs.train, 'trainDataMinecraft.jsonl'),
    fullJsonl: path.join(exposedDirs.train, 'trainDataMinecraft.full.jsonl'),
    yaml: path.join(exposedDirs.train, 'datasetMinecraft.yaml')
  },
  texture: {
    jsonl: path.join(exposedDirs.train, 'trainDataNormal.jsonl'),
    fullJsonl: path.join(exposedDirs.train, 'trainDataNormal.full.jsonl'),
    yaml: path.join(exposedDirs.train, 'datasetNormal.yaml')
  }
};

contextBridge.exposeInMainWorld('PIAF_PATHS', {
  baseDocs,
  dirs: exposedDirs,
  modeFiles
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
