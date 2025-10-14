window.PIAF_MODE = 'texture';
console.log('[PIAF] Iniciando en modo TEXTURE (2D)');

const REQUIRED_TEXTURE_DIRS = ['base', 'normal', 'labels', 'train', 'config'];

function normaliseSlashes(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .replace(/\/\.(\/|$)/g, '/');
}

function convertToPlatformPath(pathString) {
  const normalised = normaliseSlashes(pathString);
  if (/^[a-zA-Z]:\//.test(normalised)) {
    return normalised.replace(/\//g, '\\');
  }
  if (normalised.startsWith('//')) {
    return normalised.replace(/\//g, '\\');
  }
  return normalised;
}

function joinPaths(base, ...segments) {
  const parts = [];
  const pushPart = part => {
    if (typeof part !== 'string') {
      return;
    }
    const trimmed = normaliseSlashes(part).replace(/^\/+/, '');
    if (trimmed.length > 0) {
      parts.push(trimmed);
    }
  };

  if (typeof base === 'string' && base.length > 0) {
    const cleanedBase = normaliseSlashes(base);
    if (/^[a-zA-Z]:\//.test(cleanedBase)) {
      parts.push(cleanedBase);
    } else {
      parts.push(cleanedBase.replace(/\/$/, ''));
    }
  }

  segments.forEach(pushPart);

  if (parts.length === 0) {
    return '';
  }

  let combined = parts[0];
  for (let i = 1; i < parts.length; i += 1) {
    const segment = parts[i];
    if (segment.length === 0) {
      continue;
    }
    combined = `${combined}/${segment}`;
  }
  const isUnc = combined.startsWith('//');
  let collapsed = combined.replace(/\/{2,}/g, '/');
  if (isUnc && !collapsed.startsWith('//')) {
    collapsed = `//${collapsed.replace(/^\/+/, '')}`;
  }
  return convertToPlatformPath(collapsed);
}

function deepClone(value) {
  try {
    return value ? JSON.parse(JSON.stringify(value)) : value;
  } catch (error) {
    if (value && typeof value === 'object') {
      return Array.isArray(value) ? value.slice() : { ...value };
    }
    return value;
  }
}

function mergeDeep(base, override, overrideWins = true) {
  const target = (base && typeof base === 'object' && !Array.isArray(base))
    ? { ...base }
    : {};
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return target;
  }

  Object.keys(override).forEach(key => {
    const value = override[key];
    const current = target[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = mergeDeep(current || {}, value, overrideWins);
    } else if (overrideWins || current === undefined || current === null || current === '') {
      target[key] = value;
    }
  });
  return target;
}

function detectBaseDocsCandidate(paths) {
  if (!paths || typeof paths !== 'object') {
    return '';
  }
  const candidate = paths.baseDocs
    || (paths.dirs && (paths.dirs.base || paths.dirs.normal || paths.dirs.unboxed))
    || '';
  return typeof candidate === 'string' ? candidate : '';
}

function deriveAppRoot() {
  try {
    const href = window.location?.href;
    if (!href) {
      return '';
    }
    const url = new URL(href);
    if (url.protocol !== 'file:') {
      return '';
    }
    let pathname = decodeURIComponent(url.pathname || '');
    if (/^[a-zA-Z]:/.test(pathname.slice(1))) {
      pathname = pathname.slice(1);
    }
    return pathname.replace(/[^/\\]+$/, '').replace(/\/+$/, '');
  } catch (error) {
    console.warn('[PIAF][texture] No se pudo derivar el directorio base de la aplicación.', error);
    return '';
  }
}

function createStructureFromBase(baseDocsCandidate) {
  const baseDocs = convertToPlatformPath(baseDocsCandidate || '');
  const trainingDir = baseDocs ? joinPaths(baseDocs, 'trainingData') : '';
  const configDir = baseDocs ? joinPaths(baseDocs, 'config') : '';
  return {
    baseDocs,
    dirs: {
      base: baseDocs,
      unboxed: baseDocs ? joinPaths(baseDocs, 'unboxed') : '',
      normal: baseDocs ? joinPaths(baseDocs, 'normal') : '',
      labels: baseDocs ? joinPaths(baseDocs, 'labels') : '',
      train: trainingDir,
      config: configDir
    },
    modeFiles: {
      textureMode: configDir ? joinPaths(configDir, 'textureMode.txt') : '',
      classes: configDir ? joinPaths(configDir, 'classes.txt') : '',
      orientations: configDir ? joinPaths(configDir, 'orientations.txt') : ''
    },
    datasets: {
      minecraft: {
        jsonl: trainingDir ? joinPaths(trainingDir, 'trainDataMinecraft.jsonl') : '',
        fullJsonl: trainingDir ? joinPaths(trainingDir, 'trainDataMinecraft.full.jsonl') : '',
        yaml: trainingDir ? joinPaths(trainingDir, 'datasetMinecraft.yaml') : ''
      },
      texture: {
        jsonl: trainingDir ? joinPaths(trainingDir, 'trainDataNormal.jsonl') : '',
        fullJsonl: trainingDir ? joinPaths(trainingDir, 'trainDataNormal.full.jsonl') : '',
        yaml: trainingDir ? joinPaths(trainingDir, 'datasetNormal.yaml') : ''
      }
    }
  };
}

function ensureStructure(paths, baseDocsCandidate) {
  const baseStructure = createStructureFromBase(baseDocsCandidate);
  const merged = mergeDeep(baseStructure, paths || {}, true);
  const baseDocs = detectBaseDocsCandidate(merged);
  const refinedStructure = createStructureFromBase(baseDocs || baseDocsCandidate);
  return mergeDeep(refinedStructure, merged, true);
}

function hasValidTextureDirs(paths) {
  if (!paths || typeof paths !== 'object' || !paths.dirs) {
    return false;
  }
  return REQUIRED_TEXTURE_DIRS.every(key => {
    const value = paths.dirs[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

async function verifyDirectoryAccess(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') {
    return false;
  }
  if (!window.electronAPI || typeof window.electronAPI.fsExists !== 'function') {
    return true;
  }
  try {
    return await window.electronAPI.fsExists(targetPath);
  } catch (error) {
    console.warn('[PIAF][texture] No se pudo verificar la carpeta de texturas.', error);
    return false;
  }
}

function createBundleFallback() {
  const appRoot = deriveAppRoot();
  const bundleBase = appRoot ? joinPaths(appRoot, 'DataTextureGUI') : '';
  const fallbackStructure = createStructureFromBase(bundleBase);
  if (appRoot && !fallbackStructure.modeFiles.classes) {
    fallbackStructure.modeFiles.classes = joinPaths(appRoot, 'classes.txt');
  }
  return fallbackStructure;
}

async function prepareTexturePaths() {
  const existing = deepClone(window.PIAF_PATHS);
  const fallback = createBundleFallback();
  let prepared = mergeDeep(fallback, existing || {}, true);

  const bridgeAvailable = Boolean(window.electronAPI?.getPIAFPaths);
  if (bridgeAvailable) {
    try {
      const bridgePaths = await window.electronAPI.getPIAFPaths();
      prepared = mergeDeep(prepared, ensureStructure(bridgePaths, detectBaseDocsCandidate(bridgePaths)), true);
    } catch (error) {
      console.warn('[PIAF][texture] No se pudieron obtener rutas desde el backend. Se continuará con los valores actuales.', error);
    }
  }

  const baseDocs = detectBaseDocsCandidate(prepared) || detectBaseDocsCandidate(existing) || fallback.baseDocs;
  prepared = ensureStructure(prepared, baseDocs);

  if (!hasValidTextureDirs(prepared)) {
    prepared = ensureStructure(fallback, fallback.baseDocs);
  }

  const hasAccess = await verifyDirectoryAccess(prepared?.dirs?.normal);
  if (!hasAccess) {
    console.warn('[PIAF][texture] No se pudo acceder a la carpeta de texturas en Documentos. Se utilizará el paquete de respaldo.');
    prepared = ensureStructure(createBundleFallback(), fallback.baseDocs);
    window.__PIAF_BUNDLE_FALLBACK__ = true;
  } else {
    window.__PIAF_BUNDLE_FALLBACK__ = false;
  }

  window.PIAF_PATHS = prepared;
  console.log('[PIAF][texture] Rutas finales preparadas:', prepared);
  return prepared;
}

async function bootstrapTextureRenderer() {
  try {
    await prepareTexturePaths();
  } catch (error) {
    console.error('[PIAF][texture] Error preparando rutas para el modo texture. Se continuará con los valores disponibles.', error);
  } finally {
    attachRenderer();
  }
}

function attachRenderer() {
  if (document.getElementById('__PIAF_RENDERER_SCRIPT__')) {
    return;
  }
  const script = document.createElement('script');
  script.id = '__PIAF_RENDERER_SCRIPT__';
  script.src = 'renderer.js';
  script.defer = true;
  script.onload = () => console.log('[PIAF] renderer.js cargado correctamente en modo TEXTURE');
  script.onerror = err => console.error('[PIAF] Error al cargar renderer base:', err);
  document.head.appendChild(script);
}

bootstrapTextureRenderer();

if (!window.__PIAF_ERROR_BOUND__) {
  window.__PIAF_ERROR_BOUND__ = true;

  window.addEventListener('error', event => {
    console.error('🚨 [GLOBAL ERROR]', event.error);
    if (typeof Swal !== 'undefined' && Swal?.fire) {
      Swal.fire({
        title: 'Error inesperado',
        html: `<pre>${event.error?.message || 'Error desconocido'}</pre>`,
        icon: 'error',
        confirmButtonText: 'Cerrar'
      });
    }
  });

  window.addEventListener('unhandledrejection', event => {
    console.error('🚨 [UNHANDLED PROMISE]', event.reason);
    if (typeof Swal !== 'undefined' && Swal?.fire) {
      Swal.fire({
        title: 'Error en promesa',
        html: `<pre>${event.reason?.message || 'Error no manejado'}</pre>`,
        icon: 'error',
        confirmButtonText: 'Cerrar'
      });
    }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  console.log('[PIAF] DOM listo - inicializando comportamiento Texture específico');
  const title = document.querySelector('h1');
  if (title) title.textContent = 'PIAF Texture Annotator (2D Mode)';
});
