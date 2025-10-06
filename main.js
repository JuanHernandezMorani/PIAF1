const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Swal = require('sweetalert2');

const fsp = fs.promises;

const docsRoot = path.join(os.homedir(), 'Documents', 'DataTextureGUI');
const dirs = {
  unboxed: path.join(docsRoot, 'unboxedTextures'),
  normal: path.join(docsRoot, 'normalTextures'),
  labels: path.join(docsRoot, 'labels'),
  train: path.join(docsRoot, 'trainingData'),
  config: path.join(docsRoot, 'config')
};

const internal = {
  mc: path.join(__dirname, 'toDrawMinecraft'),
  tx: path.join(__dirname, 'toDrawNormal')
};

const MODE_SETTINGS = {
  minecraft: {
    key: 'minecraft',
    html: 'index.html',
    imageDir: dirs.unboxed,
    jsonlFile: 'trainDataMinecraft.jsonl',
    fullJsonlFile: 'trainDataMinecraft.full.jsonl',
    yamlFile: 'datasetMinecraft.yaml',
    datasetDir: 'minecraftDataset'
  },
  texture: {
    key: 'texture',
    html: 'textures.html',
    imageDir: dirs.normal,
    jsonlFile: 'trainDataNormal.jsonl',
    fullJsonlFile: 'trainDataNormal.full.jsonl',
    yamlFile: 'datasetNormal.yaml',
    datasetDir: 'textureDataset'
  }
};

let currentMode = 'minecraft';

const ORIENTATIONS = [
  { id: 0, key: 'arriba', label: 'Top' },
  { id: 1, key: 'frente', label: 'Front' },
  { id: 2, key: 'espalda', label: 'Back' },
  { id: 3, key: 'izquierda', label: 'Left' },
  { id: 4, key: 'derecha', label: 'Right' },
  { id: 5, key: 'abajo', label: 'Bottom' }
];
const ORIENTATION_COUNT = ORIENTATIONS.length;
const ORIENT_DEFAULT_ID = 0;
const NON_ORIENTATION_CLASSES = [
  'eyes',
  'mouth',
  'heart',
  'cracks',
  'cristal',
  'flower',
  'zombie_zone',
  'sky',
  'stars',
  'wings',
  'claws',
  'aletas',
  'fangs'
];

let mainWindow;

const projectRoot = __dirname;
const paths = {
  images: MODE_SETTINGS.minecraft.imageDir,
  jsonl: path.join(dirs.train, MODE_SETTINGS.minecraft.jsonlFile),
  fullJsonl: path.join(dirs.train, MODE_SETTINGS.minecraft.fullJsonlFile),
  labels: dirs.labels,
  classes: path.join(projectRoot, 'classes.txt'),
  dataset: path.join(dirs.train, MODE_SETTINGS.minecraft.datasetDir),
  datasetYaml: path.join(dirs.train, MODE_SETTINGS.minecraft.yamlFile),
  config: path.join(dirs.config, 'config.json')
};

function copyIfMissing(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  try {
    if (!fs.existsSync(src)) {
      return;
    }
    for (const file of fs.readdirSync(src)) {
      const srcPath = path.join(src, file);
      const destPath = path.join(dest, file);
      if (fs.existsSync(destPath)) {
        continue;
      }
      const stat = fs.statSync(srcPath);
      if (stat.isDirectory()) {
        copyIfMissing(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  } catch (error) {
    console.error('Error copiando ejemplos:', error);
  }
}

function ensureExternalData() {
  let firstSetup = false;
  if (!fs.existsSync(docsRoot)) {
    fs.mkdirSync(docsRoot, { recursive: true });
    firstSetup = true;
  }
  Object.values(dirs).forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
  copyIfMissing(internal.mc, dirs.unboxed);
  copyIfMissing(internal.tx, dirs.normal);
  return firstSetup;
}

function createDefaultConfig() {
  const orientationFilter = {};
  ORIENTATIONS.forEach(orientation => {
    orientationFilter[String(orientation.id)] = true;
  });
  return {
    export: {
      expandOrientations: false,
      missingOrientationPolicy: 'default',
      filter: {
        classes: {},
        orientations: orientationFilter
      }
    },
    default_mode: null,
    theme: 'default',
    recent_files: [],
    last_opened: null
  };
}

function deepMerge(base, override) {
  if (!override || typeof override !== 'object') {
    return Array.isArray(base) ? base.slice() : { ...base };
  }
  const result = Array.isArray(base) ? base.slice() : { ...base };
  Object.keys(override).forEach(key => {
    const value = override[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = deepMerge(base && base[key] ? base[key] : {}, value);
    } else {
      result[key] = value;
    }
  });
  return result;
}

function mergeConfigWithDefaults(partial) {
  const defaults = createDefaultConfig();
  if (!partial || typeof partial !== 'object') {
    return defaults;
  }
  const merged = deepMerge(defaults, partial);
  if (!merged.export || typeof merged.export !== 'object') {
    merged.export = defaults.export;
  }
  if (!merged.export.filter || typeof merged.export.filter !== 'object') {
    merged.export.filter = defaults.export.filter;
  }
  const orientationFilter = { ...defaults.export.filter.orientations, ...(merged.export.filter.orientations || {}) };
  merged.export.filter.orientations = orientationFilter;
  if (!merged.export.filter.classes || typeof merged.export.filter.classes !== 'object') {
    merged.export.filter.classes = {};
  }
  if (!merged.default_mode || !['minecraft', 'texture'].includes(merged.default_mode)) {
    merged.default_mode = defaults.default_mode;
  }
  if (!merged.theme || typeof merged.theme !== 'string') {
    merged.theme = defaults.theme;
  }
  if (!Array.isArray(merged.recent_files)) {
    merged.recent_files = [];
  }
  if (merged.last_opened && typeof merged.last_opened !== 'string') {
    merged.last_opened = defaults.last_opened;
  }
  return merged;
}

const LEGACY_ZONES = [
  'img_zone', 'eyes', 'wings', 'chest', 'back', 'extremities', 'fangs', 'claws',
  'head', 'mouth', 'heart', 'cracks', 'cristal', 'flower', 'zombie_zone',
  'armor', 'sky', 'stars', 'extra'
];

function getModeSetting(mode = currentMode) {
  return MODE_SETTINGS[mode] || MODE_SETTINGS.minecraft;
}

function setCurrentMode(modeName) {
  const normalized = MODE_SETTINGS[modeName] ? modeName : 'minecraft';
  currentMode = normalized;
  const settings = getModeSetting(normalized);
  paths.images = settings.imageDir;
  paths.jsonl = path.join(dirs.train, settings.jsonlFile);
  paths.fullJsonl = path.join(dirs.train, settings.fullJsonlFile);
  paths.dataset = path.join(dirs.train, settings.datasetDir);
  paths.datasetYaml = path.join(dirs.train, settings.yamlFile);
}

async function determineStartupMode(win) {
  let config;
  try {
    config = await readConfigSafe();
  } catch (error) {
    console.warn('No se pudo leer config al iniciar, usando valores por defecto.', error);
    config = createDefaultConfig();
  }

  const defaultMode = config && MODE_SETTINGS[config.default_mode] ? config.default_mode : null;
  if (defaultMode) {
    setCurrentMode(defaultMode);
    return { mode: defaultMode, remembered: true };
  }

  const selectionHtml = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Selecciona modo</title><script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script></head><body style="background:#1e1e1e;color:#f1f1f1;font-family:Arial, sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;"></body></html>`;
  await win.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(selectionHtml)}`);
  win.show();
  win.focus();

  const { mode, remember } = await win.webContents.executeJavaScript(`new Promise(resolve => { const attempt = () => { if (window.Swal && typeof window.Swal.fire === 'function') { Swal.fire({ title: 'Selecciona modo de trabajo', input: 'radio', inputOptions: { minecraft: 'Minecraft Mode (orientaciones 3D)', texture: 'Texture Mode (texturas 2D)' }, inputValidator: value => !value && 'Debes elegir un modo', confirmButtonText: 'Continuar', allowOutsideClick: false, footer: '<label style="display:flex;align-items:center;gap:8px;justify-content:center;"><input type="checkbox" id="rememberMode" /> Recordar mi elección</label>' }).then(result => { const selected = result.value || 'minecraft'; const checkbox = document.getElementById('rememberMode'); const rememberChoice = checkbox ? checkbox.checked : false; resolve({ mode: selected, remember: rememberChoice }); }); } else { setTimeout(attempt, 50); } }; attempt(); })`);

  const modeName = MODE_SETTINGS[mode] ? mode : 'minecraft';
  setCurrentMode(modeName);

  try {
    if (remember) {
      config.default_mode = modeName;
    } else {
      config.default_mode = null;
    }
    await writeConfigAtomic(config);
  } catch (error) {
    console.warn('No se pudo actualizar config.json con el modo seleccionado', error);
  }

  return { mode: modeName, remembered: Boolean(remember) };
}

async function createWindow() {
  const firstSetup = ensureExternalData();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(true);
    mainWindow.setAlwaysOnTop(false);
  });

  const { mode } = await determineStartupMode(mainWindow);
  const modeSetting = getModeSetting(mode);

  mainWindow.webContents.once('did-finish-load', () => {
    if (firstSetup) {
      mainWindow.webContents.executeJavaScript(`if (window.Swal && typeof window.Swal.fire === 'function') { Swal.fire({ title: 'Carpeta de datos creada', text: 'Tus datos se guardarán en Documentos/DataTextureGUI/', icon: 'info', confirmButtonText: 'Entendido' }); }`).catch(() => {});
    }
  });

  await mainWindow.loadFile(modeSetting.html);
}

app.whenReady().then(() => createWindow()).catch(error => {
  console.error('Error al crear la ventana principal:', error);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch(error => {
      console.error('Error al recrear la ventana principal:', error);
    });
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

async function readConfigSafe() {
  const defaults = createDefaultConfig();
  try {
    const raw = await fsp.readFile(paths.config, 'utf8');
    const parsed = JSON.parse(raw);
    return mergeConfigWithDefaults(parsed);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await writeConfigAtomic(defaults);
      return defaults;
    }
    if (err.name === 'SyntaxError') {
      try {
        await fsp.rename(paths.config, `${paths.config}.bak`);
      } catch (renameErr) {
        console.error('No se pudo respaldar config.json corrupto:', renameErr);
      }
      await writeConfigAtomic(defaults);
      return defaults;
    }
    throw err;
  }
}

async function writeConfigAtomic(config) {
  const payload = JSON.stringify(config, null, 2);
  await ensureDir(path.dirname(paths.config));
  await writeFileAtomic(paths.config, `${payload}\n`, 'utf8');
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
    const primary = await readJsonlSafe(paths.fullJsonl);
    const dataset = primary.records && primary.records.length > 0
      ? primary.records
      : (await readJsonlSafe(paths.jsonl)).records;
    dataset.forEach(record => {
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

async function ensureAletasInClasses() {
  try {
    const raw = await fsp.readFile(paths.classes, 'utf8');
    const entries = raw.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    const hasAletas = entries.some(line => line.toLowerCase() === 'aletas');
    if (!hasAletas) {
      entries.push('aletas');
      const unique = sanitiseClasses(entries);
      await writeFileAtomic(paths.classes, `${unique.join('\n')}\n`, 'utf8');
      return { success: true, added: true };
    }
    return { success: true, added: false };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { success: true, added: false };
    }
    return { success: false, error: err.message };
  }
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
    const primary = await readJsonlSafe(paths.fullJsonl);
    let records = primary.records;
    let errors = primary.errors;
    let missing = primary.missing;
    let source = 'full';
    if (primary.missing) {
      const fallback = await readJsonlSafe(paths.jsonl);
      records = fallback.records;
      errors = fallback.errors;
      missing = fallback.missing;
      source = 'filtered';
    }
    return {
      success: true,
      data: records,
      errors,
      missing,
      source
    };
  } catch (error) {
    let detail = error.message;
    if (error.code === 'EACCES') {
      detail = 'Permiso denegado al leer archivos JSONL';
    }
    return { success: false, error: detail };
  }
});

async function saveJsonl(targetPath, data) {
  const payloadLines = Array.isArray(data) ? data.map(item => JSON.stringify(item)) : [];
  const payload = payloadLines.join('\n');
  await ensureDir(path.dirname(targetPath));
  await writeFileAtomic(targetPath, payload, 'utf8');
}

const handleSaveJsonl = async (event, payload) => {
  const normalized = { filtered: [], full: [] };
  if (Array.isArray(payload)) {
    normalized.filtered = payload;
    normalized.full = payload;
  } else if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.filtered)) {
      normalized.filtered = payload.filtered;
    }
    if (Array.isArray(payload.full)) {
      normalized.full = payload.full;
    }
  }

  const errors = [];

  const filteredName = path.basename(paths.jsonl);
  const fullName = path.basename(paths.fullJsonl);

  try {
    await saveJsonl(paths.jsonl, normalized.filtered);
  } catch (error) {
    let detail = error.message;
    if (error.code === 'EACCES') {
      detail = `Permiso denegado al guardar ${filteredName}. Ejecuta como administrador o cambia el directorio del proyecto.`;
    } else if (error.code === 'ENOSPC') {
      detail = `No hay espacio en disco para guardar ${filteredName}.`;
    }
    errors.push({ file: filteredName, error: detail });
  }

  try {
    await saveJsonl(paths.fullJsonl, normalized.full);
  } catch (error) {
    let detail = error.message;
    if (error.code === 'EACCES') {
      detail = `Permiso denegado al guardar ${fullName}. Ejecuta como administrador o cambia el directorio del proyecto.`;
    } else if (error.code === 'ENOSPC') {
      detail = `No hay espacio en disco para guardar ${fullName}.`;
    }
    errors.push({ file: fullName, error: detail });
  }

  if (errors.length > 0) {
    const first = errors[0];
    return {
      success: false,
      error: `Error al guardar anotaciones: ${first.error}`,
      details: errors
    };
  }

  return { success: true };
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

ipcMain.handle('load-config', async () => {
  try {
    const config = await readConfigSafe();
    return { success: true, config };
  } catch (error) {
    let detail = error.message;
    if (error.code === 'EACCES') {
      detail = 'Permiso denegado al leer config.json';
    }
    return { success: false, error: detail };
  }
});

ipcMain.handle('save-config', async (event, newCfg) => {
  try {
    const merged = mergeConfigWithDefaults(newCfg);
    await writeConfigAtomic(merged);
    return { success: true, config: merged };
  } catch (error) {
    let detail = error.message;
    if (error.code === 'EACCES') {
      detail = 'Permiso denegado al escribir config.json';
    } else if (error.code === 'ENOSPC') {
      detail = 'No hay espacio en disco para guardar config.json';
    }
    return { success: false, error: detail };
  }
});

ipcMain.handle('ensure-aletas', async () => {
  const result = await ensureAletasInClasses();
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true, added: result.added };
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
    const expandOrientations = currentMode === 'minecraft' && Boolean(payload.expandOrientations);
    const classDisplayNames = [];
    classNames.forEach(className => {
      if (expandOrientations && !NON_ORIENTATION_CLASSES.includes(className)) {
        ORIENTATIONS.forEach(orientation => {
          classDisplayNames.push(`${className}:${orientation.key}`);
        });
      } else {
        classDisplayNames.push(className);
      }
    });
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

    const yamlNames = classDisplayNames.map(name => `'${name.replace(/'/g, "''")}'`);
    const datasetYaml = [
      'train: dataset/images/train',
      'val: dataset/images/val',
      'test: dataset/images/test',
      `names: [${yamlNames.join(', ')}]`
    ].join('\n');

    await ensureDir(path.dirname(paths.datasetYaml));
    await writeFileAtomic(paths.datasetYaml, `${datasetYaml}\n`, 'utf8');

    return { success: true, results };
  } catch (error) {
    return { success: false, error: error.message };
  }
});