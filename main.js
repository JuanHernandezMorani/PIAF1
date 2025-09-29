const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle('load-images', async () => {
  try {
    const toDrawPath = path.join(__dirname, 'toDraw');
    try {
      await fs.access(toDrawPath);
    } catch {
      await fs.mkdir(toDrawPath, { recursive: true });
      return { success: true, images: [] };
    }
    
    const files = await fs.readdir(toDrawPath);
    const imageFiles = files.filter(file => 
      /\.(png|jpg|jpeg|gif|bmp)$/i.test(file)
    );
    
    const images = imageFiles.map(file => {
      const imagePath = path.join(toDrawPath, file);
      return {
        name: file,
        path: imagePath,
        dataUrl: `file://${imagePath}`
      };
    });
    
    return { success: true, images };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-data', async (event, data) => {
  try {
    const savePath = path.join(__dirname, 'trainData.jsonl');
    const lines = data.map(item => JSON.stringify(item));
    await fs.writeFile(savePath, lines.join('\n'));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-existing-data', async () => {
    try {
        const dataPath = path.join(__dirname, 'trainData.jsonl');
        const data = await fs.readFile(dataPath, 'utf8');
        const lines = data.split('\n').filter(line => line.trim() !== '');
        const jsonData = lines.map(line => JSON.parse(line));
        return { success: true, data: jsonData };
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { success: true, data: [], error: 'FILE_NOT_FOUND' };
        }
        return { success: false, error: error.message };
    }
});