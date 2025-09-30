const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const fsp = fs.promises;

let mainWindow;

const projectRoot = __dirname;
const paths = {
  images: path.join(projectRoot, 'toDraw'),
  jsonl: path.join(projectRoot, 'trainData.jsonl'),
  labels: path.join(projectRoot, 'labels'),
  classes: path.join(projectRoot, 'classes.txt'),
  dataset: path.join(projectRoot, 'dataset')
};

const LEGACY_ZONES = [
  'img_zone', 'eyes', 'wings', 'chest', 'back', 'extremities', 'fangs', 'claws',
  'head', 'mouth', 'heart', 'cracks', 'cristal', 'flower', 'zombie_zone',
  'armor', 'sky', 'stars', 'extra'
];

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

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function writeFileAtomic(targetPath, data, options = 'utf8') {
  const tmpPath = `${targetPath}.tmp`;
  await fsp.writeFile(tmpPath, data, options);
  await fsp.rename(tmpPath, targetPath);
}

async function readJsonlSafe(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(line => line.trim().length > 0);
    const records = [];
    const errors = [];
    lines.forEach((line, index) => {
      try {
        records.push(JSON.parse(line));
      } catch (err) {
        errors.push({ line: index + 1, error: err.message, content: line });
      }
    });
    return { records, errors };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { records: [], errors: [], missing: true };
    }
    throw err;
  }
}

function sanitiseClasses(list) {
  const seen = new Set();
  const classes = [];
  list.forEach(item => {
    const name = String(item || '').trim();
    if (!name) {
      return;
    }
    const lower = name.toLowerCase();
    if (seen.has(lower)) {
      return;
    }
    seen.add(lower);
    classes.push(name);
  });
  return classes;
}

async function inferClasses() {
  const inferred = new Set();
  try {
    const { records } = await readJsonlSafe(paths.jsonl);
    records.forEach(record => {
      if (record && Array.isArray(record.objects)) {
        record.objects.forEach(obj => {
          if (obj && obj.class_name) {
            inferred.add(String(obj.class_name));
          }
        });
      } else {
        LEGACY_ZONES.forEach(zone => {
          if (Array.isArray(record?.[zone]) && record[zone].length > 0) {
            inferred.add(zone);
          }
        });
      }
    });
  } catch (err) {
    // ignore inference errors – fallback to legacy list
  }

  if (inferred.size === 0) {
    LEGACY_ZONES.forEach(zone => inferred.add(zone));
  }

  const classes = Array.from(inferred);
  classes.sort((a, b) => a.localeCompare(b, 'es'));
  return classes;
}

ipcMain.handle('load-images', async () => {
  try {
    await ensureDir(paths.images);
    const files = await fsp.readdir(paths.images);
    const imageFiles = files.filter(file => /\.(png|jpg|jpeg|gif|bmp)$/i.test(file));
    const images = imageFiles.map(file => {
      const imagePath = path.join(paths.images, file);
      return {
        name: file,
        path: imagePath,
        dataUrl: `file://${imagePath}`
      };
    });
    return { success: true, images };
  } catch (error) {
    let detail = error.message;
    if (error.code === 'EACCES') {
      detail = 'Permiso denegado. Ejecuta la aplicación con privilegios o mueve el proyecto a un directorio accesible.';
    } else if (error.code === 'ENOSPC') {
      detail = 'Sin espacio en disco para leer la carpeta de imágenes.';
    }
    return { success: false, error: detail };
  }
});

ipcMain.handle('load-existing-data', async () => {
  try {
    const { records, errors, missing } = await readJsonlSafe(paths.jsonl);
    return {
      success: true,
      data: records,
      errors,
      missing
    };
  } catch (error) {
    let detail = error.message;
    if (error.code === 'EACCES') {
      detail = 'Permiso denegado al leer trainData.jsonl';
    }
    return { success: false, error: detail };
  }
});

async function saveJsonl(data) {
  const lines = data.map(item => JSON.stringify(item));
  const payload = lines.join('\n');
  await writeFileAtomic(paths.jsonl, payload, 'utf8');
}

const handleSaveJsonl = async (event, data) => {
  try {
    await saveJsonl(data);
    return { success: true };
  } catch (error) {
    let detail = error.message;
    if (error.code === 'EACCES') {
      detail = 'Permiso denegado al guardar trainData.jsonl. Ejecuta como administrador o cambia el directorio del proyecto.';
    } else if (error.code === 'ENOSPC') {
      detail = 'No hay espacio en disco para guardar trainData.jsonl.';
    }
    return { success: false, error: detail };
  }
};

ipcMain.handle('save-jsonl', handleSaveJsonl);
ipcMain.handle('save-data', handleSaveJsonl);

ipcMain.handle('save-yolo-txt-batch', async (event, perImageLines) => {
  try {
    await ensureDir(paths.labels);
    const errors = [];
    const promises = Object.entries(perImageLines).map(async ([fileName, lines]) => {
      const base = path.parse(fileName).name;
      const targetPath = path.join(paths.labels, `${base}.txt`);
      const content = Array.isArray(lines) && lines.length > 0 ? `${lines.join('\n')}\n` : '';
      try {
        await writeFileAtomic(targetPath, content, 'utf8');
      } catch (err) {
        let detail = err.message;
        if (err.code === 'EACCES') {
          detail = `Permiso denegado al escribir ${targetPath}`;
        } else if (err.code === 'ENOSPC') {
          detail = `Sin espacio en disco para escribir ${targetPath}`;
        }
        errors.push({ file: fileName, error: detail });
      }
    });
    await Promise.all(promises);
    if (errors.length > 0) {
      return { success: false, error: 'Algunos archivos no se pudieron guardar.', details: errors };
    }
    return { success: true };
  } catch (error) {
    let detail = error.message;
    if (error.code === 'EACCES') {
      detail = 'Permiso denegado al crear la carpeta labels/.';
    } else if (error.code === 'ENOSPC') {
      detail = 'No hay espacio en disco para escribir los labels.';
    }
    return { success: false, error: detail };
  }
});

ipcMain.handle('load-classes', async () => {
  try {
    let classes;
    let inferred = false;
    try {
      const raw = await fsp.readFile(paths.classes, 'utf8');
      classes = sanitiseClasses(raw.split(/\r?\n/));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
      inferred = true;
      classes = await inferClasses();
      await ensureDir(path.dirname(paths.classes));
      await writeFileAtomic(paths.classes, `${classes.join('\n')}\n`, 'utf8');
    }
    return { success: true, classes, inferred };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-classes', async (event, classes) => {
  try {
    const cleaned = sanitiseClasses(Array.isArray(classes) ? classes : []);
    await writeFileAtomic(paths.classes, `${cleaned.join('\n')}\n`, 'utf8');
    return { success: true, classes: cleaned };
  } catch (error) {
    let detail = error.message;
    if (error.code === 'EACCES') {
      detail = 'Permiso denegado al guardar classes.txt';
    }
    return { success: false, error: detail };
  }
});

function shuffle(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function copyFileSafe(src, dest) {
  await ensureDir(path.dirname(dest));
  await fsp.copyFile(src, dest);
}

ipcMain.handle('export-dataset', async (event, payload) => {
  try {
    if (!payload || !Array.isArray(payload.images) || !payload.labels) {
      throw new Error('Estructura de exportación inválida.');
    }

    const splits = payload.splits || { train: 0.7, val: 0.2, test: 0.1 };
    const classNames = sanitiseClasses(payload.classes || []);
    const fileNames = payload.images.map(item => item.fileName);
    const shuffled = shuffle(fileNames);

    const total = shuffled.length;
    const trainCount = Math.round(total * splits.train);
    const valCount = Math.round(total * splits.val);
    const testCount = total - trainCount - valCount;

    const splitMap = new Map();
    shuffled.forEach((name, index) => {
      let split = 'test';
      if (index < trainCount) {
        split = 'train';
      } else if (index < trainCount + valCount) {
        split = 'val';
      }
      splitMap.set(name, split);
    });

    await ensureDir(paths.dataset);

    const results = [];

    for (const image of payload.images) {
      const split = splitMap.get(image.fileName) || 'train';
      const destImage = path.join(paths.dataset, 'images', split, image.fileName);
      const destLabel = path.join(paths.dataset, 'labels', split, `${path.parse(image.fileName).name}.txt`);
      const labelLines = payload.labels[image.fileName] || [];

      try {
        await copyFileSafe(image.absolutePath, destImage);
        await ensureDir(path.dirname(destLabel));
        await writeFileAtomic(destLabel, labelLines.length ? `${labelLines.join('\n')}\n` : '', 'utf8');
        results.push({ file: image.fileName, split });
      } catch (err) {
        return {
          success: false,
          error: `Error al exportar ${image.fileName}: ${err.message}`
        };
      }
    }

    const datasetYaml = [
      `train: dataset/images/train`,
      `val: dataset/images/val`,
      `test: dataset/images/test`,
      `names: [${classNames.join(', ')}]`
    ].join('\n');

    await writeFileAtomic(path.join(paths.dataset, 'dataset.yaml'), `${datasetYaml}\n`, 'utf8');

    return { success: true, results };
  } catch (error) {
    return { success: false, error: error.message };
  }
});