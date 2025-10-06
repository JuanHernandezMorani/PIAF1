const { contextBridge, ipcRenderer } = require('electron');

const getPIAFPaths = () => {
  for (const arg of process.argv) {
    if (arg.startsWith('--PIAF_PATHS=')) {
      try {
        const raw = arg.slice('--PIAF_PATHS='.length);
        return JSON.parse(raw);
      } catch (e) {
        console.error('[DEBUG PRELOAD] Error parseando PIAF_PATHS:', e);
      }
    }
  }

  const fallbackPaths = {
    dirs: { base: '', unboxed: '', normal: '', labels: '', train: '', config: '' },
    modeFiles: { textureMode: '', classes: '', orientations: '' },
    datasets: { minecraft: {}, texture: {} },
    baseDocs: require('path').join(require('os').homedir(), 'Documents', 'DataTextureGUI')
  };
  console.warn('[DEBUG PRELOAD] Usando fallback paths');
  return fallbackPaths;
};

contextBridge.exposeInMainWorld('electronAPI', {
  loadImages: options => ipcRenderer.invoke('load-images', options),
  loadExistingData: () => ipcRenderer.invoke('load-existing-data'),
  saveJsonl: data => ipcRenderer.invoke('save-jsonl', data),
  saveData: data => ipcRenderer.invoke('save-jsonl', data),
  saveYoloTxtBatch: perImageLines => ipcRenderer.invoke('save-yolo-txt-batch', perImageLines),
  exportDataset: payload => ipcRenderer.invoke('export-dataset', payload),
  loadClasses: () => ipcRenderer.invoke('load-classes'),
  saveClasses: classes => ipcRenderer.invoke('save-classes', classes),
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: cfg => ipcRenderer.invoke('save-config', cfg),
  ensureAletas: () => ipcRenderer.invoke('ensure-aletas'),
  fsExists: targetPath => ipcRenderer.invoke('fs-exists', targetPath),
  readDirectory: targetPath => ipcRenderer.invoke('read-directory', targetPath),
  readFile: targetPath => ipcRenderer.invoke('read-file', targetPath),
  getPIAFPaths: () => getPIAFPaths()
});

contextBridge.exposeInMainWorld('PIAF_PATHS', getPIAFPaths());
