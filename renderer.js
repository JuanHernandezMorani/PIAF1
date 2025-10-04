const HANDLE_CANVAS_PX = 8;
const MOVE_HANDLE_CANVAS_PX = 12;
const MIN_POLYGON_AREA = 5;
const MIN_EYE_POLYGON_AREA = 1;
const SAVE_DEBOUNCE_MS = 500;

const ORIENTATIONS = [
  { id: 0, key: 'top', label: 'Top' },
  { id: 1, key: 'front', label: 'Front' },
  { id: 2, key: 'back', label: 'Back' },
  { id: 3, key: 'left', label: 'Left' },
  { id: 4, key: 'right', label: 'Right' },
  { id: 5, key: 'bottom', label: 'Bottom' }
];
const ORIENTATION_COUNT = ORIENTATIONS.length;
const ORIENT_DEFAULT_ID = 0;

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
    }
  };
}

function deepMerge(base, override) {
  const result = Array.isArray(base) ? base.slice() : { ...base };
  if (!override || typeof override !== 'object') {
    return result;
  }
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
  return merged;
}

function cloneData(data) {
  return JSON.parse(JSON.stringify(data));
}

const state = {
  images: [],
  annotations: {},
  classes: [],
  classMap: new Map(),
  colors: new Map(),
  currentImageIndex: -1,
  currentLayer: 'base',
  currentClassName: null,
  scale: 1,
  zoom: 1,
  panX: 0,
  panY: 0,
  isPanning: false,
  panStart: { x: 0, y: 0 },
  drawingDraft: null,
  selectedObjectId: null,
  selectedVertexIndex: null,
  draggingVertex: false,
  draggingObject: false,
  dragStartPoint: null,
  dragStartPolygon: null,
  hoveredHandle: null,
  hoveredMoveHandle: null,
  hoveredObjectId: null,
  canvasRect: { left: 0, top: 0, width: 0, height: 0 },
  imageElement: null,
  imageAlphaData: null,
  dirtyImages: new Set(),
  annotationErrors: new Map(),
  saveInProgress: false,
  lastSaveTs: 0,
  migrationCount: 0,
  loadErrors: [],
  migrationNotified: false,
  config: createDefaultConfig(),
  configDirty: false,
  configLoadError: false,
  orientationOptions: ORIENTATIONS,
  currentOrientationId: ORIENT_DEFAULT_ID,
  orientationIssues: { missing: 0 }
};

/**
 * Configura un contexto 2D para renderizar pixel-art sin interpolación en la mayor
 * cantidad de navegadores posibles. Los prefijos se mantienen por compatibilidad con
 * motores antiguos de Chromium, Gecko y Edge Legacy.
 *
 * @param {CanvasRenderingContext2D} context - Contexto 2D de canvas a configurar.
 * @returns {CanvasRenderingContext2D} El mismo contexto recibido para permitir chaining.
 * @throws {TypeError} Si el parámetro recibido no es un contexto válido.
 */
function applyPixelPerfectConfig(context) {
  if (!context || typeof context !== 'object') {
    throw new TypeError('applyPixelPerfectConfig requiere un contexto 2D válido.');
  }

  // Vendor prefixes necesarios para navegadores antiguos: webkit (Chrome < 41), moz
  // (Firefox ESR), ms (Edge Legacy) y la propiedad estándar.
  const smoothingFlags = [
    'imageSmoothingEnabled',
    'webkitImageSmoothingEnabled',
    'mozImageSmoothingEnabled',
    'msImageSmoothingEnabled'
  ];

  smoothingFlags.forEach(flag => {
    if (flag in context) {
      try {
        context[flag] = false;
      } catch (error) {
        console.warn(`No se pudo desactivar ${flag} en el contexto de canvas.`, error);
      }
    }
  });

  return context;
}

/**
 * Crea un canvas auxiliar para operaciones intermedias como herramientas, overlays o
 * sampling de alpha. Se aconseja liberar manualmente sus dimensiones una vez utilizado
 * para facilitar la recolección de memoria.
 *
 * @param {number} width - Ancho deseado del canvas auxiliar.
 * @param {number} height - Alto deseado del canvas auxiliar.
 * @param {{ willReadFrequently?: boolean }} [options] - Atributos opcionales del contexto.
 * @returns {{ canvas: HTMLCanvasElement, context: CanvasRenderingContext2D }|null} Canvas y
 *   contexto configurados, o null si la creación falla.
 */
function createAuxiliaryContext(width, height, options = {}) {
  const safeWidth = Number.isFinite(width) && width > 0 ? Math.floor(width) : 0;
  const safeHeight = Number.isFinite(height) && height > 0 ? Math.floor(height) : 0;

  if (!safeWidth || !safeHeight) {
    console.error('createAuxiliaryContext requiere dimensiones positivas.');
    return null;
  }

  const offscreen = document.createElement('canvas');
  offscreen.width = safeWidth;
  offscreen.height = safeHeight;

  let context = null;
  try {
    context = offscreen.getContext('2d', {
      alpha: true,
      willReadFrequently: Boolean(options.willReadFrequently)
    });
  } catch (error) {
    console.error('No se pudo crear el contexto auxiliar 2D.', error);
    return null;
  }

  if (!context) {
    console.error('El navegador no retornó un contexto 2D auxiliar.');
    return null;
  }

  try {
    applyPixelPerfectConfig(context);
  } catch (error) {
    console.warn('No se pudo aplicar la configuración pixel-perfect al contexto auxiliar.', error);
  }

  return { canvas: offscreen, context };
}

/**
 * Administra un canvas 2D asegurando renderizados pixel-perfect, validaciones de zoom y
 * operaciones resilientes ante errores de dibujo.
 */
class PixelPerfectRenderer {
  /**
   * @param {HTMLCanvasElement|null} canvasElement - Canvas objetivo del renderer.
   * @param {{ maxZoom?: number, minZoom?: number, contextAttributes?: CanvasRenderingContext2DSettings }} [options]
   *   Configuración avanzada para límites de zoom y atributos del contexto.
   * @throws {TypeError} Si el canvas no es válido.
   * @throws {Error} Si no fue posible obtener un contexto 2D compatible.
   */
  constructor(canvasElement, options = {}) {
    if (!(canvasElement instanceof HTMLCanvasElement)) {
      throw new TypeError('PixelPerfectRenderer requiere un elemento <canvas> válido.');
    }

    this.canvas = canvasElement;
    this.maxZoom = Number.isFinite(options.maxZoom) && options.maxZoom > 0 ? options.maxZoom : 128;
    this.minZoom = Number.isFinite(options.minZoom) && options.minZoom > 0 ? options.minZoom : 1 / this.maxZoom;
    this.#context = this.#createContext(options.contextAttributes);

    // Forzamos la configuración pixel-perfect desde el inicio para evitar flickering.
    this.ensurePixelPerfectConfig();
  }

  /** @type {CanvasRenderingContext2D|null} */
  #context = null;

  /**
   * Crea el contexto 2D asegurando transparencia alpha y lecturas frecuentes seguras.
   *
   * @param {CanvasRenderingContext2DSettings} [attributes] - Atributos personalizados.
   * @returns {CanvasRenderingContext2D} Contexto creado.
   * @private
   */
  #createContext(attributes = {}) {
    const config = {
      alpha: true,
      willReadFrequently: true,
      ...attributes
    };

    let context = null;
    try {
      context = this.canvas.getContext('2d', config);
    } catch (error) {
      console.error('No se pudo crear el contexto 2D del canvas principal.', error);
      throw new Error('Contexto 2D no disponible para PixelPerfectRenderer.');
    }

    if (!context) {
      throw new Error('El navegador devolvió un contexto 2D nulo.');
    }

    return context;
  }

  /**
   * Retorna el contexto 2D administrado.
   *
   * @returns {CanvasRenderingContext2D} Contexto activo.
   */
  getContext() {
    if (!this.#context) {
      throw new Error('El contexto 2D no está inicializado.');
    }
    return this.#context;
  }

  /**
   * Reaplica la configuración pixel-perfect al contexto administrado.
   */
  ensurePixelPerfectConfig() {
    try {
      applyPixelPerfectConfig(this.getContext());
    } catch (error) {
      console.error('No fue posible aplicar la configuración pixel-perfect al canvas principal.', error);
    }
  }

  /**
   * Borra todo el canvas de forma segura manteniendo la transparencia.
   */
  clearCanvas() {
    const context = this.getContext();
    try {
      context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    } catch (error) {
      console.error('No se pudo limpiar el canvas principal.', error);
    }
  }

  /**
   * Calcula las dimensiones finales de un renderizado según zoom y escala externa.
   *
   * @param {number} baseWidth - Ancho original de la textura.
   * @param {number} baseHeight - Alto original de la textura.
   * @param {number} zoom - Factor de zoom aplicado por el usuario.
   * @param {number} scale - Factor de escala adicional (fit-to-screen, DPI, etc.).
   * @returns {{ baseWidth: number, baseHeight: number, zoomedWidth: number, zoomedHeight: number, drawWidth: number, drawHeight: number }}
   */
  calculateDrawMetrics(baseWidth, baseHeight, zoom, scale) {
    const safeBaseWidth = Number.isFinite(baseWidth) && baseWidth > 0 ? baseWidth : 1;
    const safeBaseHeight = Number.isFinite(baseHeight) && baseHeight > 0 ? baseHeight : 1;
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    let safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;

    if (safeZoom > this.maxZoom) {
      console.warn(`Zoom ${safeZoom} excede el máximo permitido (${this.maxZoom}). Se limitará.`);
      safeZoom = this.maxZoom;
    } else if (safeZoom < this.minZoom) {
      console.warn(`Zoom ${safeZoom} es inferior al mínimo permitido (${this.minZoom}). Se ajustará.`);
      safeZoom = this.minZoom;
    }

    const zoomedWidth = safeBaseWidth * safeZoom;
    const zoomedHeight = safeBaseHeight * safeZoom;

    return {
      baseWidth: safeBaseWidth,
      baseHeight: safeBaseHeight,
      zoomedWidth,
      zoomedHeight,
      drawWidth: zoomedWidth * safeScale,
      drawHeight: zoomedHeight * safeScale
    };
  }

  /**
   * Dibuja una textura preservando los píxeles. Si la operación falla se recurre a un
   * patrón de fallback para evitar dejar artefactos en pantalla.
   *
   * @param {HTMLImageElement|HTMLCanvasElement} texture - Fuente a dibujar.
   * @param {{
   *   sourceWidth?: number,
   *   sourceHeight?: number,
   *   destX?: number,
   *   destY?: number,
   *   destWidth?: number,
   *   destHeight?: number
   * }} [options] - Opciones de renderizado.
   */
  drawTexture(texture, options = {}) {
    if (!texture) {
      console.error('drawTexture recibió una textura inválida.');
      return;
    }

    const context = this.getContext();
    this.ensurePixelPerfectConfig();

    const sourceWidth = Number.isFinite(options.sourceWidth) && options.sourceWidth > 0
      ? options.sourceWidth
      : texture.naturalWidth || texture.width || 0;
    const sourceHeight = Number.isFinite(options.sourceHeight) && options.sourceHeight > 0
      ? options.sourceHeight
      : texture.naturalHeight || texture.height || 0;
    const destX = Number.isFinite(options.destX) ? options.destX : 0;
    const destY = Number.isFinite(options.destY) ? options.destY : 0;
    const destWidth = Number.isFinite(options.destWidth) && options.destWidth > 0
      ? options.destWidth
      : sourceWidth;
    const destHeight = Number.isFinite(options.destHeight) && options.destHeight > 0
      ? options.destHeight
      : sourceHeight;

    if (!sourceWidth || !sourceHeight || !destWidth || !destHeight) {
      console.error('drawTexture requiere dimensiones positivas para dibujar.');
      return;
    }

    try {
      context.drawImage(
        texture,
        0,
        0,
        sourceWidth,
        sourceHeight,
        destX,
        destY,
        destWidth,
        destHeight
      );
    } catch (error) {
      console.error('drawTexture falló al dibujar la textura. Se usará un patrón de fallback.', error);
      this.#drawFallback(destX, destY, destWidth, destHeight);
    }
  }

  /**
   * Exporta el canvas actual a PNG conservando el canal alpha.
   *
   * @returns {string|null} DataURL en formato PNG o null si ocurre un error.
   */
  exportToPng() {
    try {
      this.ensurePixelPerfectConfig();
      return this.canvas.toDataURL('image/png');
    } catch (error) {
      console.error('No se pudo exportar la textura a PNG.', error);
      return null;
    }
  }

  /**
   * Crea un contexto auxiliar reutilizando la helper global para mantener consistencia.
   *
   * @param {number} width - Ancho del canvas auxiliar.
   * @param {number} height - Alto del canvas auxiliar.
   * @param {{ willReadFrequently?: boolean }} [options] - Opciones adicionales.
   * @returns {{ canvas: HTMLCanvasElement, context: CanvasRenderingContext2D }|null}
   */
  createAuxiliaryContext(width, height, options = {}) {
    return createAuxiliaryContext(width, height, options);
  }

  /**
   * Dibuja un patrón visual indicando que la textura no pudo renderizarse.
   *
   * @param {number} x - Posición X de destino.
   * @param {number} y - Posición Y de destino.
   * @param {number} width - Ancho del área afectada.
   * @param {number} height - Alto del área afectada.
   * @private
   */
  #drawFallback(x, y, width, height) {
    const context = this.getContext();
    const patternSize = 8;
    context.save();
    context.fillStyle = 'rgba(255, 0, 0, 0.35)';
    context.fillRect(x, y, width, height);
    context.fillStyle = 'rgba(255, 255, 255, 0.4)';
    for (let row = 0; row < height; row += patternSize) {
      for (let col = 0; col < width; col += patternSize) {
        if (((row + col) / patternSize) % 2 === 0) {
          context.fillRect(x + col, y + row, patternSize, patternSize);
        }
      }
    }
    context.restore();
  }
}

let canvas = document.getElementById('imageCanvas');
let ctx = null;
let pixelRenderer = null;

try {
  if (canvas) {
    pixelRenderer = new PixelPerfectRenderer(canvas);
    ctx = pixelRenderer.getContext();
  } else {
    console.error('No se encontró el canvas #imageCanvas en el DOM.');
  }
} catch (error) {
  console.error('Falló la inicialización del PixelPerfectRenderer. Se intentará un contexto de reserva.', error);
  try {
    ctx = canvas?.getContext?.('2d', { alpha: true }) || null;
    if (ctx) {
      applyPixelPerfectConfig(ctx);
    }
  } catch (fallbackError) {
    console.error('Tampoco se pudo crear un contexto de reserva.', fallbackError);
  }
}

/**
 * Obtiene las dimensiones originales de la textura actual considerando anotaciones y
 * datos EXIF. Si no hay textura disponible se recurre a las dimensiones del canvas para
 * mantener la lógica de zoom consistente.
 *
 * @returns {{ width: number, height: number }} Dimensiones base garantizando valores > 0.
 */
function getBaseImageDimensions() {
  const annotation = getCurrentAnnotation();
  const image = state.imageElement;

  const fallbackWidth = canvas?.width || 1;
  const fallbackHeight = canvas?.height || 1;

  const width = Math.max(
    1,
    Number(annotation?.width) || image?.naturalWidth || fallbackWidth
  );
  const height = Math.max(
    1,
    Number(annotation?.height) || image?.naturalHeight || fallbackHeight
  );

  if (!image) {
    console.warn('No hay textura cargada; se usarán dimensiones de fallback.');
  }

  return { width, height };
}

/**
 * Calcula las dimensiones finales a dibujar en pantalla considerando zoom del usuario y
 * escala automática. Se apoya en PixelPerfectRenderer para validar los límites.
 *
 * @returns {{ baseWidth: number, baseHeight: number, zoomedWidth: number, zoomedHeight: number, drawWidth: number, drawHeight: number }}
 */
function getZoomedDrawDimensions() {
  const { width, height } = getBaseImageDimensions();
  if (!pixelRenderer) {
    return {
      baseWidth: width,
      baseHeight: height,
      zoomedWidth: width * state.zoom,
      zoomedHeight: height * state.zoom,
      drawWidth: width * state.zoom * state.scale,
      drawHeight: height * state.zoom * state.scale
    };
  }

  try {
    return pixelRenderer.calculateDrawMetrics(width, height, state.zoom, state.scale);
  } catch (error) {
    console.error('Error al calcular dimensiones de renderizado. Se usarán valores por defecto.', error);
    return {
      baseWidth: width,
      baseHeight: height,
      zoomedWidth: width,
      zoomedHeight: height,
      drawWidth: width,
      drawHeight: height
    };
  }
}
const zoneSelect = document.getElementById('zoneSelect');
const imageList = document.getElementById('imageList');
const zonesList = document.getElementById('zonesList');
const layerSelect = document.getElementById('layerSelect');
const saveBtn = document.getElementById('saveBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const imageNameLabel = document.getElementById('imageName');
const imageIndexLabel = document.getElementById('imageIndex');
const noImages = document.getElementById('noImages');
const zonesPanel = document.querySelector('.zones-panel');

let toastContainer;
let bannerContainer;
let configPanel;
let classFiltersContainer;
let orientationFiltersContainer;
let expandOrientationsToggle;
let missingOrientationSelect;
let saveConfigButton;
let creationOrientationSelect;
let selectedObjectPanel;
let objectOrientationSelect;
let orientationIssuesBanner;
let selectedObjectWarnings;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupAuxiliaryContainers();
  setupConfigPanel();
  setupEventListeners();
  await ensureAletasClass();
  await loadClasses();
  await loadConfig();
  await loadImages();
  await loadExistingData();
  renderConfigPanel();
  updateImageList();
  if (state.images.length > 0) {
    setCurrentImage(0);
    noImages.style.display = 'none';
    canvas.style.display = 'block';
  } else {
    noImages.style.display = 'block';
    canvas.style.display = 'none';
  }
}

function setupAuxiliaryContainers() {
  toastContainer = document.createElement('div');
  toastContainer.id = 'toastContainer';
  toastContainer.style.position = 'fixed';
  toastContainer.style.bottom = '16px';
  toastContainer.style.right = '16px';
  toastContainer.style.display = 'flex';
  toastContainer.style.flexDirection = 'column';
  toastContainer.style.gap = '8px';
  toastContainer.style.zIndex = '9999';
  document.body.appendChild(toastContainer);

  bannerContainer = document.createElement('div');
  bannerContainer.id = 'bannerContainer';
  bannerContainer.style.position = 'fixed';
  bannerContainer.style.top = '16px';
  bannerContainer.style.left = '50%';
  bannerContainer.style.transform = 'translateX(-50%)';
  bannerContainer.style.zIndex = '9998';
  bannerContainer.style.display = 'flex';
  bannerContainer.style.flexDirection = 'column';
  bannerContainer.style.gap = '8px';
  document.body.appendChild(bannerContainer);
}

function setupConfigPanel() {
  if (!zonesPanel) return;
  configPanel = document.createElement('div');
  configPanel.id = 'configPanel';
  configPanel.style.display = 'flex';
  configPanel.style.flexDirection = 'column';
  configPanel.style.gap = '12px';
  configPanel.style.marginBottom = '12px';
  zonesPanel.insertBefore(configPanel, zonesList);

  orientationIssuesBanner = document.createElement('div');
  orientationIssuesBanner.style.display = 'none';
  orientationIssuesBanner.style.padding = '8px 12px';
  orientationIssuesBanner.style.borderRadius = '4px';
  orientationIssuesBanner.style.backgroundColor = '#fff3cd';
  orientationIssuesBanner.style.color = '#856404';
  orientationIssuesBanner.style.fontSize = '13px';
  orientationIssuesBanner.style.border = '1px solid #ffeeba';
  configPanel.appendChild(orientationIssuesBanner);

  const creationSection = document.createElement('div');
  creationSection.style.display = 'flex';
  creationSection.style.flexDirection = 'column';
  creationSection.style.gap = '4px';
  const creationLabel = document.createElement('label');
  creationLabel.textContent = 'Orientación al crear nuevo objeto';
  creationLabel.style.fontWeight = '600';
  creationOrientationSelect = document.createElement('select');
  creationOrientationSelect.addEventListener('change', () => {
    state.currentOrientationId = Number(creationOrientationSelect.value);
  });
  creationSection.appendChild(creationLabel);
  creationSection.appendChild(creationOrientationSelect);
  configPanel.appendChild(creationSection);

  const exportSection = document.createElement('div');
  exportSection.style.display = 'flex';
  exportSection.style.flexDirection = 'column';
  exportSection.style.gap = '6px';

  const expandRow = document.createElement('label');
  expandRow.style.display = 'flex';
  expandRow.style.alignItems = 'center';
  expandRow.style.gap = '8px';
  expandRow.textContent = 'Expandir orientaciones en exportación';
  expandOrientationsToggle = document.createElement('input');
  expandOrientationsToggle.type = 'checkbox';
  expandOrientationsToggle.addEventListener('change', () => {
    state.config.export.expandOrientations = expandOrientationsToggle.checked;
    markConfigDirty();
    updateOrientationIssues();
    updateZonesList();
  });
  expandRow.prepend(expandOrientationsToggle);
  exportSection.appendChild(expandRow);

  const missingRow = document.createElement('div');
  missingRow.style.display = 'flex';
  missingRow.style.flexDirection = 'column';
  missingRow.style.gap = '4px';
  const missingLabel = document.createElement('label');
  missingLabel.textContent = 'Si falta orientación:';
  missingOrientationSelect = document.createElement('select');
  const defaultOption = document.createElement('option');
  defaultOption.value = 'default';
  defaultOption.textContent = 'Usar orientación por defecto (Top)';
  const skipOption = document.createElement('option');
  skipOption.value = 'skip';
  skipOption.textContent = 'Omitir objeto en exportación';
  missingOrientationSelect.append(defaultOption, skipOption);
  missingOrientationSelect.addEventListener('change', () => {
    state.config.export.missingOrientationPolicy = missingOrientationSelect.value;
    markConfigDirty();
    updateOrientationIssues();
  });
  missingRow.appendChild(missingLabel);
  missingRow.appendChild(missingOrientationSelect);
  exportSection.appendChild(missingRow);

  saveConfigButton = document.createElement('button');
  saveConfigButton.type = 'button';
  saveConfigButton.textContent = 'Guardar configuración';
  saveConfigButton.addEventListener('click', persistConfig);
  exportSection.appendChild(saveConfigButton);

  configPanel.appendChild(exportSection);

  const classSection = document.createElement('div');
  const classTitle = document.createElement('strong');
  classTitle.textContent = 'Clases activas';
  classSection.appendChild(classTitle);
  classFiltersContainer = document.createElement('div');
  classFiltersContainer.style.display = 'flex';
  classFiltersContainer.style.flexDirection = 'column';
  classFiltersContainer.style.gap = '4px';
  classSection.appendChild(classFiltersContainer);
  configPanel.appendChild(classSection);

  const orientSection = document.createElement('div');
  const orientTitle = document.createElement('strong');
  orientTitle.textContent = 'Orientaciones activas';
  orientSection.appendChild(orientTitle);
  orientationFiltersContainer = document.createElement('div');
  orientationFiltersContainer.style.display = 'flex';
  orientationFiltersContainer.style.flexWrap = 'wrap';
  orientationFiltersContainer.style.gap = '6px';
  orientSection.appendChild(orientationFiltersContainer);
  configPanel.appendChild(orientSection);

  selectedObjectPanel = document.createElement('div');
  selectedObjectPanel.style.display = 'none';
  selectedObjectPanel.style.flexDirection = 'column';
  selectedObjectPanel.style.gap = '6px';
  selectedObjectPanel.style.padding = '8px';
  selectedObjectPanel.style.border = '1px solid #ccc';
  selectedObjectPanel.style.borderRadius = '4px';
  selectedObjectPanel.style.backgroundColor = '#f9f9f9';
  const selectedTitle = document.createElement('strong');
  selectedTitle.textContent = 'Objeto seleccionado';
  const orientationLabel = document.createElement('label');
  orientationLabel.textContent = 'Orientación';
  objectOrientationSelect = document.createElement('select');
  objectOrientationSelect.addEventListener('change', () => {
    const annotation = getCurrentAnnotation();
    if (!annotation || !state.selectedObjectId) return;
    const object = getObjectById(state.selectedObjectId);
    if (!object) return;
    const newId = Number(objectOrientationSelect.value);
    object.class_orientation_id = newId;
    if (object.meta) {
      delete object.meta.orientationDefaulted;
    }
    updateDerivedData(annotation, object);
    markImageDirty(annotation.file_name);
    updateOrientationIssues();
    updateZonesList();
    redrawCanvas();
  });
  selectedObjectPanel.appendChild(selectedTitle);
  selectedObjectPanel.appendChild(orientationLabel);
  selectedObjectPanel.appendChild(objectOrientationSelect);
  selectedObjectWarnings = document.createElement('div');
  selectedObjectWarnings.style.fontSize = '12px';
  selectedObjectWarnings.style.color = '#8a6d3b';
  selectedObjectPanel.appendChild(selectedObjectWarnings);
  configPanel.appendChild(selectedObjectPanel);
}

function setupEventListeners() {
  zoneSelect.addEventListener('change', () => {
    state.currentClassName = zoneSelect.value;
    redrawCanvas();
  });

  layerSelect.addEventListener('change', () => {
    const annotation = getCurrentAnnotation();
    if (annotation) {
      annotation.layer = layerSelect.value;
      markImageDirty(annotation.file_name);
    }
  });

  saveBtn.addEventListener('click', () => triggerSave(false));
  prevBtn.addEventListener('click', () => navigateImage(-1));
  nextBtn.addEventListener('click', () => navigateImage(1));

  canvas.addEventListener('mousedown', handleMouseDown);
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
  canvas.addEventListener('mouseleave', () => {
    state.hoveredHandle = null;
    state.hoveredMoveHandle = null;
    state.hoveredObjectId = null;
    redrawCanvas();
  });
  canvas.addEventListener('wheel', handleWheel, { passive: false });
  canvas.addEventListener('dblclick', handleDoubleClick);

  document.addEventListener('keydown', handleKeyDown);
  window.addEventListener('resize', () => {
    if (state.currentImageIndex >= 0) {
      resizeCanvasToContainer();
      fitImageToCanvas();
      redrawCanvas();
    }
  });
}

async function loadClasses() {
  const result = await window.electronAPI.loadClasses();
  if (!result.success) {
    showToast(`Error al cargar classes.txt: ${result.error}`, 'error');
    state.classes = [];
  } else {
    state.classes = result.classes || [];
    if (result.inferred) {
      showBanner(`Se generó classes.txt con ${state.classes.length} clases inferidas.`);
    }
  }
  syncConfigWithClasses();
  buildClassSelector();
  syncAnnotationsWithClassMap();
  renderConfigPanel();
}

function buildClassSelector() {
  zoneSelect.innerHTML = '';
  state.classMap = new Map();
  state.colors = new Map();
  state.classes.forEach((className, index) => {
    const option = document.createElement('option');
    option.value = className;
    option.textContent = `${index + 1}. ${className}`;
    zoneSelect.appendChild(option);
    state.classMap.set(className, index);
    state.colors.set(className, generateColorForClass(className));
  });
  if (state.classes.length > 0) {
    zoneSelect.value = state.classes[0];
    state.currentClassName = state.classes[0];
  } else {
    state.currentClassName = null;
  }
}

function getOrientationById(id) {
  return ORIENTATIONS.find(option => option.id === id) || null;
}

function getOrientationLabel(id) {
  const orientation = getOrientationById(id);
  return orientation ? orientation.label : 'Desconocida';
}

function getOrientationKey(id) {
  const orientation = getOrientationById(id);
  return orientation ? orientation.key : 'unknown';
}

function generateColorForClass(className) {
  let hash = 0;
  for (let i = 0; i < className.length; i += 1) {
    hash = (hash << 5) - hash + className.charCodeAt(i);
    hash |= 0;
  }
  const r = (hash & 0xff0000) >> 16;
  const g = (hash & 0x00ff00) >> 8;
  const b = hash & 0x0000ff;
  const base = [Math.abs(r) % 200, Math.abs(g) % 200, Math.abs(b) % 200];
  return `rgba(${base[0]}, ${base[1]}, ${base[2]}, 0.4)`;
}

async function loadImages() {
  const imagesResult = await window.electronAPI.loadImages();
  if (!imagesResult.success) {
    showToast(`Error al cargar imágenes: ${imagesResult.error}`, 'error');
    state.images = [];
    return;
  }
  state.images = imagesResult.images || [];
}

async function ensureAletasClass() {
  try {
    const result = await window.electronAPI.ensureAletas();
    if (!result.success) {
      showToast(`No se pudo verificar la clase "aletas": ${result.error}`, 'warning');
    } else if (result.added) {
      showToast('Se agregó la clase "aletas" a classes.txt.', 'info');
    }
  } catch (error) {
    showToast(`No se pudo asegurar la clase "aletas": ${error.message}`, 'warning');
  }
}

async function loadExistingData() {
  const result = await window.electronAPI.loadExistingData();
  if (!result.success) {
    showToast(`No se pudo cargar trainData.jsonl: ${result.error}`, 'error');
    return;
  }
  const migrationStats = { migrated: 0 };
  (result.data || []).forEach(item => {
    const annotation = normalizeAnnotation(item, migrationStats);
    if (annotation && annotation.file_name) {
      state.annotations[annotation.file_name] = annotation;
    }
  });
  state.migrationCount = migrationStats.migrated;
  syncAnnotationsWithClassMap();
  if (state.migrationCount > 0 && !state.migrationNotified) {
    showBanner(`Se migraron ${state.migrationCount} cajas a polígonos rectangulares.`);
    state.migrationNotified = true;
  }
  if (Array.isArray(result.errors) && result.errors.length > 0) {
    result.errors.forEach(error => {
      state.loadErrors.push(error);
    });
    showToast(`Se omitieron ${result.errors.length} líneas corruptas en trainData.jsonl`, 'warning');
  }
}

async function loadConfig() {
  try {
    const result = await window.electronAPI.loadConfig();
    if (!result.success) {
      state.config = createDefaultConfig();
      state.configLoadError = true;
      showToast(`Config por defecto: ${result.error}`, 'warning');
    } else {
      state.config = mergeConfigWithDefaults(result.config);
      state.configLoadError = false;
    }
  } catch (error) {
    state.config = createDefaultConfig();
    state.configLoadError = true;
    showToast(`Config por defecto: ${error.message}`, 'warning');
  }
  syncConfigWithClasses();
  state.configDirty = false;
  renderConfigPanel();
}

function markConfigDirty() {
  state.configDirty = true;
  if (saveConfigButton) {
    saveConfigButton.disabled = false;
  }
}

async function persistConfig() {
  try {
    const result = await window.electronAPI.saveConfig(state.config);
    if (!result.success) {
      throw new Error(result.error || 'Error desconocido al guardar config.json');
    }
    state.config = mergeConfigWithDefaults(result.config);
    state.configDirty = false;
    showToast('Configuración guardada.', 'success');
  } catch (error) {
    showToast(`No se pudo guardar la configuración: ${error.message}`, 'error');
  }
  renderConfigPanel();
}

function populateOrientationSelect(select) {
  if (!select) return;
  const previous = select.value;
  select.innerHTML = '';
  state.orientationOptions.forEach(option => {
    const opt = document.createElement('option');
    opt.value = String(option.id);
    opt.textContent = `${option.label} (${option.key})`;
    select.appendChild(opt);
  });
  if (previous) {
    select.value = previous;
  }
}

function renderConfigPanel() {
  if (!configPanel) return;
  populateOrientationSelect(creationOrientationSelect);
  populateOrientationSelect(objectOrientationSelect);
  if (creationOrientationSelect) {
    creationOrientationSelect.value = String(state.currentOrientationId);
  }
  if (expandOrientationsToggle) {
    expandOrientationsToggle.checked = Boolean(state.config.export.expandOrientations);
  }
  if (missingOrientationSelect) {
    missingOrientationSelect.value = state.config.export.missingOrientationPolicy || 'default';
  }
  if (saveConfigButton) {
    saveConfigButton.disabled = !state.configDirty;
  }
  renderClassFilters();
  renderOrientationFilters();
  renderSelectedObjectPanel();
  updateOrientationIssues();
}

function renderClassFilters() {
  if (!classFiltersContainer) return;
  classFiltersContainer.innerHTML = '';
  if (!state.classes || state.classes.length === 0) {
    const empty = document.createElement('span');
    empty.textContent = 'Sin clases disponibles.';
    classFiltersContainer.appendChild(empty);
    return;
  }
  state.classes.forEach(className => {
    const wrapper = document.createElement('label');
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '6px';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const enabled = state.config.export.filter.classes[className];
    checkbox.checked = enabled !== false;
    checkbox.addEventListener('change', () => {
      state.config.export.filter.classes[className] = checkbox.checked;
      markConfigDirty();
      updateZonesList();
    });
    const label = document.createElement('span');
    label.textContent = className;
    wrapper.appendChild(checkbox);
    wrapper.appendChild(label);
    classFiltersContainer.appendChild(wrapper);
  });
}

function renderOrientationFilters() {
  if (!orientationFiltersContainer) return;
  orientationFiltersContainer.innerHTML = '';
  ORIENTATIONS.forEach(option => {
    const wrapper = document.createElement('label');
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '4px';
    wrapper.style.minWidth = '120px';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const enabled = state.config.export.filter.orientations[String(option.id)];
    checkbox.checked = enabled !== false;
    checkbox.addEventListener('change', () => {
      state.config.export.filter.orientations[String(option.id)] = checkbox.checked;
      markConfigDirty();
      updateZonesList();
    });
    const label = document.createElement('span');
    label.textContent = option.label;
    wrapper.appendChild(checkbox);
    wrapper.appendChild(label);
    orientationFiltersContainer.appendChild(wrapper);
  });
}

function renderSelectedObjectPanel() {
  if (!selectedObjectPanel) return;
  const object = getObjectById(state.selectedObjectId);
  if (!object) {
    selectedObjectPanel.style.display = 'none';
    return;
  }
  selectedObjectPanel.style.display = 'flex';
  const orientationId = Number.isInteger(object.class_orientation_id)
    ? object.class_orientation_id
    : ORIENT_DEFAULT_ID;
  if (objectOrientationSelect) {
    objectOrientationSelect.value = String(orientationId);
  }
  if (selectedObjectWarnings) {
    const warnings = object.validation?.warnings || [];
    selectedObjectWarnings.textContent = warnings.join(' · ');
  }
}

function updateOrientationIssues() {
  if (!orientationIssuesBanner) return;
  let missing = 0;
  Object.values(state.annotations).forEach(annotation => {
    annotation.objects.forEach(object => {
      if (!Number.isInteger(object.class_orientation_id) || object.class_orientation_id < 0 || object.class_orientation_id >= ORIENTATION_COUNT || object.meta?.orientationDefaulted) {
        missing += 1;
      }
    });
  });
  state.orientationIssues.missing = missing;
  orientationIssuesBanner.innerHTML = '';
  if (state.config.export.expandOrientations && missing > 0) {
    orientationIssuesBanner.style.display = 'flex';
    orientationIssuesBanner.style.justifyContent = 'space-between';
    orientationIssuesBanner.style.alignItems = 'center';
    const text = document.createElement('span');
    text.textContent = `${missing} objeto(s) sin orientación definida. Asigna una orientación antes de exportar expandido.`;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Asignar Top a todos';
    button.addEventListener('click', () => {
      assignDefaultOrientationToAll();
    });
    orientationIssuesBanner.appendChild(text);
    orientationIssuesBanner.appendChild(button);
  } else {
    orientationIssuesBanner.style.display = 'none';
  }
}

function assignDefaultOrientationToAll() {
  const affectedFiles = new Set();
  Object.values(state.annotations).forEach(annotation => {
    annotation.objects.forEach(object => {
      if (!Number.isInteger(object.class_orientation_id) || object.class_orientation_id < 0 || object.class_orientation_id >= ORIENTATION_COUNT || object.meta?.orientationDefaulted) {
        object.class_orientation_id = ORIENT_DEFAULT_ID;
        if (object.meta) {
          delete object.meta.orientationDefaulted;
        }
        updateDerivedData(annotation, object);
        affectedFiles.add(annotation.file_name);
      }
    });
  });
  affectedFiles.forEach(fileName => {
    if (fileName) {
      state.dirtyImages.add(fileName);
    }
  });
  updateOrientationIssues();
  updateZonesList();
  redrawCanvas();
  showToast('Se asignó orientación por defecto (Top) a los objetos pendientes.', 'info');
}

function syncConfigWithClasses() {
  if (!state.config || !state.config.export || !state.config.export.filter) {
    state.config = createDefaultConfig();
  }
  const current = state.config.export.filter.classes || {};
  const updated = {};
  state.classes.forEach(className => {
    if (Object.prototype.hasOwnProperty.call(current, className)) {
      updated[className] = current[className];
    } else {
      updated[className] = className.toLowerCase() === 'aletas' ? false : true;
    }
  });
  state.config.export.filter.classes = updated;
  if (!state.config.export.filter.orientations) {
    state.config.export.filter.orientations = {};
  }
  ORIENTATIONS.forEach(option => {
    if (!Object.prototype.hasOwnProperty.call(state.config.export.filter.orientations, String(option.id))) {
      state.config.export.filter.orientations[String(option.id)] = true;
    }
  });
}

function isObjectEnabledByConfig(object, config = state.config) {
  if (!object || !config || !config.export) return false;
  const filters = config.export.filter || {};
  const classesFilter = filters.classes || {};
  const orientationsFilter = filters.orientations || {};
  const classEnabled = classesFilter[object.class_name] !== false;
  if (!classEnabled) return false;
  const orientationId = Number.isInteger(object.class_orientation_id)
    ? object.class_orientation_id
    : ORIENT_DEFAULT_ID;
  const orientationEnabled = orientationsFilter[String(orientationId)] !== false;
  if (!orientationEnabled) return false;
  if (!object.isValid || object.validation?.blockExport) return false;
  if (config.export.missingOrientationPolicy === 'skip' && object.meta?.orientationDefaulted) {
    return false;
  }
  return true;
}

function normalizeAnnotation(item, migrationStats = { migrated: 0 }) {
  if (!item || !item.file_name) {
    return null;
  }
  const base = {
    file_name: item.file_name,
    width: item.width || null,
    height: item.height || null,
    layer: item.layer || 'base',
    objects: []
  };
  if (Array.isArray(item.objects)) {
    base.objects = item.objects.map(obj => {
      const cleanPolygon = Array.isArray(obj.polygon)
        ? obj.polygon.map(pt => ({ x: Number(pt.x), y: Number(pt.y) }))
        : [];
      const rawOrientation = Number(obj.class_orientation_id);
      let orientationId = Number.isInteger(rawOrientation) ? rawOrientation : ORIENT_DEFAULT_ID;
      let orientationDefaulted = false;
      if (!Number.isInteger(rawOrientation) || rawOrientation < 0 || rawOrientation >= ORIENTATION_COUNT) {
        orientationId = ORIENT_DEFAULT_ID;
        orientationDefaulted = true;
      }
      const meta = obj.meta ? { ...obj.meta } : {};
      if (orientationDefaulted) {
        meta.orientationDefaulted = true;
      }
      return {
        id: obj.id || crypto.randomUUID(),
        class_name: obj.class_name,
        class_id: typeof obj.class_id === 'number' ? obj.class_id : state.classMap.get(obj.class_name) || 0,
        class_orientation_id: orientationId,
        polygon: cleanPolygon,
        bbox: obj.bbox || null,
        isValid: obj.isValid !== false,
        meta,
        enabled: obj.enabled !== false
      };
    });
  } else {
    const objects = [];
    const legacyZones = Object.keys(item).filter(key => key !== 'file_name' && key !== 'layer');
    legacyZones.forEach(zoneName => {
      const entries = Array.isArray(item[zoneName]) ? item[zoneName] : [];
      entries.forEach(entry => {
        const polygon = bboxToPolygon(entry);
        const object = {
          id: crypto.randomUUID(),
          class_name: zoneName,
          class_id: state.classMap.get(zoneName) ?? 0,
          class_orientation_id: ORIENT_DEFAULT_ID,
          polygon,
          bbox: entry ? { x: entry.x, y: entry.y, w: entry.w, h: entry.h } : null,
          isValid: true,
          meta: { migrated: true, orientationDefaulted: true },
          enabled: true
        };
        objects.push(object);
        migrationStats.migrated += 1;
      });
    });
    base.objects = objects;
  }
  base.objects.forEach(obj => {
    updateDerivedData(base, obj);
  });
  return base;
}

function bboxToPolygon(bbox) {
  if (!bbox) {
    return [];
  }
  const x1 = bbox.x;
  const y1 = bbox.y;
  const x2 = bbox.x + bbox.w;
  const y2 = bbox.y + bbox.h;
  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 }
  ];
}

/**
 * Extrae los datos de alpha de una imagen utilizando un canvas auxiliar. Se usa en
 * herramientas de validación para detectar transparencias.
 *
 * @param {HTMLImageElement} image - Imagen de origen previamente cargada.
 * @returns {{ width: number, height: number, data: Uint8ClampedArray, hasAlpha: boolean }|null}
 */
function extractAlphaDataFromImage(image) {
  if (!image) {
    console.warn('extractAlphaDataFromImage recibió una imagen nula.');
    return null;
  }

  const width = image?.naturalWidth || image?.width || 0;
  const height = image?.naturalHeight || image?.height || 0;
  if (!width || !height) {
    console.warn('La imagen no contiene dimensiones válidas para extraer alpha.');
    return null;
  }

  const aux = pixelRenderer?.createAuxiliaryContext(width, height, { willReadFrequently: true })
    || createAuxiliaryContext(width, height, { willReadFrequently: true });

  if (!aux) {
    return null;
  }

  const { canvas: offscreen, context } = aux;

  try {
    context.drawImage(image, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const { data } = imageData;
    let hasAlpha = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) {
        hasAlpha = true;
        break;
      }
    }
    // Liberamos memoria reduciendo el tamaño del canvas auxiliar.
    offscreen.width = 0;
    offscreen.height = 0;
    return { width: imageData.width, height: imageData.height, data, hasAlpha };
  } catch (error) {
    console.warn('No se pudo extraer datos de alpha de la imagen:', error);
    offscreen.width = 0;
    offscreen.height = 0;
    return null;
  }
}

function adjustPolygonToAlpha(polygon, alphaData) {
  if (!Array.isArray(polygon) || polygon.length === 0) {
    return { polygon: [], movedVertices: [], autoAdjusted: false, discard: false };
  }
  if (!alphaData || !alphaData.hasAlpha || !alphaData.data || !alphaData.width || !alphaData.height) {
    return { polygon: polygon.map(pt => ({ x: pt.x, y: pt.y })), movedVertices: [], autoAdjusted: false, discard: false };
  }

  const { width, height, data } = alphaData;
  if (!width || !height) {
    return { polygon: polygon.map(pt => ({ x: pt.x, y: pt.y })), movedVertices: [], autoAdjusted: false, discard: false };
  }

  const adjusted = polygon.map(point => ({ x: point.x, y: point.y }));
  const moved = new Set();

  const neighborOffsets = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], /* self */ [1, 0],
    [-1, 1], [0, 1], [1, 1]
  ];
  const flankPairs = [
    [[-1, 0], [1, 0]],
    [[0, -1], [0, 1]],
    [[-1, -1], [1, 1]],
    [[-1, 1], [1, -1]]
  ];

  const getAlpha = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return 0;
    }
    const index = (y * width + x) * 4 + 3;
    return data[index];
  };

  const isSurroundedByAlpha = (x, y) => {
    let neighborCount = 0;
    for (let i = 0; i < neighborOffsets.length; i += 1) {
      const [dx, dy] = neighborOffsets[i];
      const nx = x + dx;
      const ny = y + dy;
      if (nx === x && ny === y) {
        continue;
      }
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        return false;
      }
      neighborCount += 1;
      if (getAlpha(nx, ny) === 0) {
        return false;
      }
    }
    return neighborCount > 0;
  };

  const isFlankedByAlpha = (x, y) => {
    for (let i = 0; i < flankPairs.length; i += 1) {
      const [a, b] = flankPairs[i];
      const ax = x + a[0];
      const ay = y + a[1];
      const bx = x + b[0];
      const by = y + b[1];
      if (ax < 0 || ay < 0 || ax >= width || ay >= height) {
        continue;
      }
      if (bx < 0 || by < 0 || bx >= width || by >= height) {
        continue;
      }
      if (getAlpha(ax, ay) > 0 && getAlpha(bx, by) > 0) {
        return true;
      }
    }
    return false;
  };

  const findNearestAlpha = (startX, startY) => {
    const queue = [];
    const visited = new Uint8Array(width * height);
    const clampX = Math.min(Math.max(startX, 0), width - 1);
    const clampY = Math.min(Math.max(startY, 0), height - 1);
    queue.push({ x: clampX, y: clampY });
    visited[clampY * width + clampX] = 1;
    let head = 0;
    const directions = [
      [-1, 0], [1, 0], [0, -1], [0, 1],
      [-1, -1], [-1, 1], [1, -1], [1, 1]
    ];

    while (head < queue.length) {
      const current = queue[head];
      head += 1;
      const alpha = getAlpha(current.x, current.y);
      if (alpha > 0) {
        return { x: current.x, y: current.y };
      }
      for (let i = 0; i < directions.length; i += 1) {
        const [dx, dy] = directions[i];
        const nx = current.x + dx;
        const ny = current.y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          continue;
        }
        const idx = ny * width + nx;
        if (visited[idx]) {
          continue;
        }
        visited[idx] = 1;
        queue.push({ x: nx, y: ny });
      }
    }
    return null;
  };

  for (let i = 0; i < adjusted.length; i += 1) {
    const point = adjusted[i];
    const pixelX = Math.round(point.x);
    const pixelY = Math.round(point.y);
    const alpha = getAlpha(pixelX, pixelY);
    if (alpha > 0) {
      continue;
    }
    if (isSurroundedByAlpha(pixelX, pixelY)) {
      continue;
    }
    if (isFlankedByAlpha(pixelX, pixelY)) {
      continue;
    }
    const nearest = findNearestAlpha(pixelX, pixelY);
    if (!nearest) {
      return { polygon: [], movedVertices: [], autoAdjusted: false, discard: true };
    }
    point.x = nearest.x;
    point.y = nearest.y;
    moved.add(i);
  }

  const movedVertices = Array.from(moved).sort((a, b) => a - b);
  return { polygon: adjusted, movedVertices, autoAdjusted: movedVertices.length > 0, discard: false };
}

function setCurrentImage(index) {
  if (index < 0 || index >= state.images.length) {
    return;
  }
  state.currentImageIndex = index;
  updateImageList();
  loadCurrentImage();
}

function navigateImage(direction) {
  if (state.images.length === 0) return;
  const newIndex = (state.currentImageIndex + direction + state.images.length) % state.images.length;
  setCurrentImage(newIndex);
}

function getCurrentImage() {
  if (state.currentImageIndex < 0 || state.currentImageIndex >= state.images.length) {
    return null;
  }
  return state.images[state.currentImageIndex];
}

function getCurrentAnnotation() {
  const image = getCurrentImage();
  if (!image) return null;
  if (!state.annotations[image.name]) {
    state.annotations[image.name] = {
      file_name: image.name,
      width: null,
      height: null,
      layer: 'base',
      objects: []
    };
  }
  return state.annotations[image.name];
}

function loadCurrentImage() {
  const image = getCurrentImage();
  if (!image) {
    return;
  }
  const annotation = getCurrentAnnotation();
  state.imageAlphaData = null;
  const img = new Image();
  img.onload = () => {
    state.imageElement = img;
    state.imageAlphaData = extractAlphaDataFromImage(img);
    annotation.width = img.naturalWidth;
    annotation.height = img.naturalHeight;
    resizeCanvasToContainer();
    fitImageToCanvas();
    layerSelect.value = annotation.layer || 'base';
    updateImageInfo();
    updateZonesList();
    redrawCanvas();
  };
  img.onerror = () => {
    showToast(`No se pudo cargar la imagen ${image.name}`, 'error');
  };
  img.src = image.dataUrl;
}

/**
 * Ajusta el tamaño del canvas al contenedor disponible, preservando la configuración de
 * pixel-art y evitando valores mínimos que generarían divisiones por cero.
 */
function resizeCanvasToContainer() {
  if (!canvas) {
    console.error('resizeCanvasToContainer no pudo ejecutarse: canvas inexistente.');
    return;
  }

  const container = canvas.parentElement;
  if (!container) {
    console.error('resizeCanvasToContainer requiere un contenedor para calcular el tamaño.');
    return;
  }

  const rect = container.getBoundingClientRect();
  const width = Math.max(rect.width || 0, 100);
  const height = Math.max(rect.height || 0, 100);

  canvas.width = width;
  canvas.height = height;
  state.canvasRect = { left: rect.left, top: rect.top, width, height };

  pixelRenderer?.ensurePixelPerfectConfig();
}

/**
 * Reescala la textura actual para que encaje en el canvas respetando su relación de
 * aspecto. Reinicia el zoom del usuario para evitar saltos bruscos.
 */
function fitImageToCanvas() {
  if (!canvas) {
    console.error('fitImageToCanvas no puede ejecutarse sin canvas.');
    return;
  }
  if (!state.imageElement) {
    console.warn('fitImageToCanvas llamado sin imagen cargada.');
    return;
  }
  const annotation = getCurrentAnnotation();
  if (!annotation) {
    console.warn('fitImageToCanvas requiere una anotación activa.');
    return;
  }

  const imgWidth = Math.max(1, annotation.width || state.imageElement.naturalWidth || canvas.width);
  const imgHeight = Math.max(1, annotation.height || state.imageElement.naturalHeight || canvas.height);
  const scaleX = canvas.width / imgWidth;
  const scaleY = canvas.height / imgHeight;
  state.scale = Math.max(0.01, Math.min(scaleX, scaleY));
  state.zoom = 1;
  const { drawWidth, drawHeight } = getZoomedDrawDimensions();
  state.panX = (canvas.width - drawWidth) / 2;
  state.panY = (canvas.height - drawHeight) / 2;
}

function updateImageInfo() {
  const image = getCurrentImage();
  if (!image) {
    imageNameLabel.textContent = '-';
    imageIndexLabel.textContent = '0/0';
    return;
  }
  imageNameLabel.textContent = image.name;
  imageIndexLabel.textContent = `${state.currentImageIndex + 1}/${state.images.length}`;
}

function updateImageList() {
  imageList.innerHTML = '';
  state.images.forEach((img, idx) => {
    const li = document.createElement('li');
    li.textContent = img.name;
    if (idx === state.currentImageIndex) {
      li.classList.add('active');
    }
    li.addEventListener('click', () => setCurrentImage(idx));
    imageList.appendChild(li);
  });
}

function markImageDirty(fileName) {
  if (fileName) {
    state.dirtyImages.add(fileName);
  }
}

function handleMouseDown(event) {
  if (!state.imageElement) return;
  state.canvasRect = canvas.getBoundingClientRect();
  if (event.ctrlKey || event.metaKey) {
    state.isPanning = true;
    state.panStart = { x: event.clientX, y: event.clientY };
    return;
  }
  const point = getImagePointFromEvent(event);
  if (!point) return;

  if (state.drawingDraft) {
    const radius = getHandleRadiusImage();
    const firstPoint = state.drawingDraft.points[0];
    if (distance(point, firstPoint) <= radius && state.drawingDraft.points.length >= 3) {
      finalizeDraftPolygon();
    } else {
      state.drawingDraft.points.push(point);
    }
    redrawCanvas();
    return;
  }

  const vertexHit = findVertexHandle(point);
  if (vertexHit) {
    selectObject(vertexHit.objectId, vertexHit.vertexIndex);
    state.draggingVertex = true;
    return;
  }

  const moveHandleHit = findMoveHandle(point);
  if (moveHandleHit) {
    selectObject(moveHandleHit.objectId, null);
    state.draggingObject = true;
    state.dragStartPoint = point;
    state.dragStartPolygon = getObjectById(moveHandleHit.objectId).polygon.map(pt => ({ x: pt.x, y: pt.y }));
    return;
  }

  const objectHit = findObjectContainingPoint(point);
  if (objectHit) {
    selectObject(objectHit.id, null);
    state.draggingObject = true;
    state.dragStartPoint = point;
    state.dragStartPolygon = objectHit.polygon.map(pt => ({ x: pt.x, y: pt.y }));
    return;
  }

  if (!state.currentClassName) {
    showToast('Selecciona una clase antes de dibujar.', 'warning');
    return;
  }

  startDraft(point);
}

function handleMouseMove(event) {
  if (!state.imageElement) return;
  const point = getImagePointFromEvent(event);
  if (state.isPanning) {
    const dx = event.clientX - state.panStart.x;
    const dy = event.clientY - state.panStart.y;
    state.panX += dx;
    state.panY += dy;
    state.panStart = { x: event.clientX, y: event.clientY };
    redrawCanvas();
    return;
  }

  if (state.drawingDraft) {
    state.drawingDraft.preview = point;
    redrawCanvas();
    return;
  }

  if (state.draggingVertex && state.selectedObjectId) {
    const annotation = getCurrentAnnotation();
    const object = getObjectById(state.selectedObjectId);
    if (object && annotation) {
      const vertexIndex = state.selectedVertexIndex;
      if (vertexIndex != null) {
        object.polygon[vertexIndex] = clampPointToImage(point, annotation);
        updateDerivedData(annotation, object);
        markImageDirty(annotation.file_name);
        updateZonesList();
        redrawCanvas();
      }
    }
    return;
  }

  if (state.draggingObject && state.selectedObjectId && state.dragStartPoint) {
    const annotation = getCurrentAnnotation();
    const object = getObjectById(state.selectedObjectId);
    if (object && annotation) {
      const dx = point.x - state.dragStartPoint.x;
      const dy = point.y - state.dragStartPoint.y;
      object.polygon = state.dragStartPolygon.map(pt => clampPointToImage({ x: pt.x + dx, y: pt.y + dy }, annotation));
      updateDerivedData(annotation, object);
      markImageDirty(annotation.file_name);
      updateZonesList();
      redrawCanvas();
    }
    return;
  }

  state.hoveredHandle = null;
  state.hoveredMoveHandle = null;
  state.hoveredObjectId = null;

  if (point) {
    const vertexHit = findVertexHandle(point);
    if (vertexHit) {
      state.hoveredHandle = vertexHit;
      canvas.style.cursor = 'pointer';
    } else {
      const moveHit = findMoveHandle(point);
      if (moveHit) {
        state.hoveredMoveHandle = moveHit;
        canvas.style.cursor = 'move';
      } else {
        const objectHit = findObjectContainingPoint(point);
        if (objectHit) {
          state.hoveredObjectId = objectHit.id;
          canvas.style.cursor = 'move';
        } else {
          canvas.style.cursor = 'default';
        }
      }
    }
  }
  redrawCanvas();
}

function handleMouseUp() {
  state.isPanning = false;
  if (state.draggingVertex) {
    state.draggingVertex = false;
    state.selectedVertexIndex = null;
  }
  if (state.draggingObject) {
    state.draggingObject = false;
    state.dragStartPoint = null;
    state.dragStartPolygon = null;
  }
}

function handleWheel(event) {
  if (!state.imageElement) return;
  event.preventDefault();
  const delta = event.deltaY < 0 ? 1.1 : 0.9;
  const mousePoint = getCanvasPointFromEvent(event);
  const beforeZoom = canvasPointToImage(mousePoint.x, mousePoint.y);
  state.zoom = Math.min(Math.max(state.zoom * delta, 0.1), 10);
  const afterZoom = canvasPointToImage(mousePoint.x, mousePoint.y);
  if (beforeZoom && afterZoom) {
    state.panX += (afterZoom.x - beforeZoom.x) * state.scale * state.zoom;
    state.panY += (afterZoom.y - beforeZoom.y) * state.scale * state.zoom;
  }
  redrawCanvas();
}

function handleDoubleClick(event) {
  if (state.drawingDraft) {
    event.preventDefault();
    finalizeDraftPolygon();
    return;
  }
  const annotation = getCurrentAnnotation();
  if (!annotation || !state.selectedObjectId) return;
  const object = getObjectById(state.selectedObjectId);
  if (!object) return;
  const point = getImagePointFromEvent(event);
  if (!point) return;
  const edge = findEdgeForInsertion(object, point);
  if (edge != null) {
    object.polygon.splice(edge + 1, 0, point);
    updateDerivedData(annotation, object);
    markImageDirty(annotation.file_name);
    updateZonesList();
    redrawCanvas();
  }
}

function handleKeyDown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    triggerSave(true);
    return;
  }

  if (event.key === 'Enter' && state.drawingDraft) {
    event.preventDefault();
    finalizeDraftPolygon();
    return;
  }

  if (event.key === 'Escape' && state.drawingDraft) {
    event.preventDefault();
    state.drawingDraft = null;
    redrawCanvas();
    return;
  }

  if (event.key === 'Delete' || event.key === 'Backspace') {
    const annotation = getCurrentAnnotation();
    if (!annotation) return;
    if (state.selectedObjectId && state.selectedVertexIndex != null) {
      const object = getObjectById(state.selectedObjectId);
      if (object) {
        if (object.polygon.length <= 3) {
          showToast('No es posible eliminar el vértice: el polígono quedaría inválido.', 'warning');
          return;
        }
        object.polygon.splice(state.selectedVertexIndex, 1);
        state.selectedVertexIndex = null;
        updateDerivedData(annotation, object);
        markImageDirty(annotation.file_name);
        updateZonesList();
        redrawCanvas();
      }
      return;
    }
    if (state.selectedObjectId) {
      const index = annotation.objects.findIndex(obj => obj.id === state.selectedObjectId);
      if (index >= 0) {
        annotation.objects.splice(index, 1);
        markImageDirty(annotation.file_name);
        state.selectedObjectId = null;
        state.selectedVertexIndex = null;
        renderSelectedObjectPanel();
        updateZonesList();
        redrawCanvas();
      }
    }
  }

  if ((event.ctrlKey || event.metaKey) && event.key === '0') {
    event.preventDefault();
    fitImageToCanvas();
    redrawCanvas();
  }
}

function triggerSave(fromShortcut) {
  const now = Date.now();
  if (fromShortcut && now - state.lastSaveTs < SAVE_DEBOUNCE_MS) {
    return;
  }
  state.lastSaveTs = now;
  saveAnnotations();
}

async function saveAnnotations() {
  if (state.saveInProgress) {
    showToast('Guardado en curso, espera un momento…', 'info');
    return;
  }
  const annotations = Object.values(state.annotations);
  const perImageLines = {};
  const filteredAnnotations = [];
  const fullAnnotations = [];
  state.annotationErrors.clear();

  annotations.forEach(annotation => {
    const fullClone = cloneData(annotation);
    fullClone.objects = fullClone.objects.map((obj, index) => {
      const original = annotation.objects[index];
      const enabled = isObjectEnabledByConfig(original);
      return { ...obj, enabled };
    });
    fullAnnotations.push(fullClone);

    const filteredClone = cloneData(annotation);
    filteredClone.objects = [];
    annotation.objects.forEach(original => {
      if (isObjectEnabledByConfig(original)) {
        const cloneObj = cloneData(original);
        cloneObj.enabled = true;
        filteredClone.objects.push(cloneObj);
      }
    });
    filteredAnnotations.push(filteredClone);

    const validation = generateYoloLines(annotation, state.config, state.classMap);
    perImageLines[annotation.file_name] = validation.lines;
    if (validation.errors.length > 0) {
      state.annotationErrors.set(annotation.file_name, validation.errors);
    } else {
      state.annotationErrors.delete(annotation.file_name);
    }
  });

  updateZonesList();
  try {
    state.saveInProgress = true;
    const jsonlResult = await window.electronAPI.saveJsonl({ filtered: filteredAnnotations, full: fullAnnotations });
    if (!jsonlResult.success) {
      const detail = jsonlResult.details ? ` Detalles: ${JSON.stringify(jsonlResult.details)}` : '';
      throw new Error((jsonlResult.error || 'Error desconocido al guardar JSONL') + detail);
    }
    const txtResult = await window.electronAPI.saveYoloTxtBatch(perImageLines);
    if (!txtResult.success) {
      const detail = txtResult.details ? ` Detalles: ${JSON.stringify(txtResult.details)}` : '';
      throw new Error((txtResult.error || 'Error al guardar etiquetas YOLO') + detail);
    }
    state.dirtyImages.clear();
    const cleared = clearPendingAutoAdjustedVertices();
    if (cleared) {
      redrawCanvas();
    }
    showToast('Guardado completado.', 'success');
  } catch (error) {
    showToast(`Error al guardar: ${error.message}`, 'error');
  } finally {
    state.saveInProgress = false;
  }
}

function clearPendingAutoAdjustedVertices() {
  let changed = false;
  Object.values(state.annotations).forEach(annotation => {
    if (!annotation || !Array.isArray(annotation.objects)) {
      return;
    }
    annotation.objects.forEach(object => {
      if (object?.meta?.autoAdjustedPending) {
        object.meta.autoAdjustedPending = false;
        changed = true;
      }
    });
  });
  return changed;
}

function startDraft(point) {
  state.drawingDraft = {
    className: state.currentClassName,
    classId: state.classMap.get(state.currentClassName) ?? 0,
    points: [point],
    preview: null
  };
}

function finalizeDraftPolygon() {
  if (!state.drawingDraft) return;
  const draft = state.drawingDraft;
  state.drawingDraft = null;
  const annotation = getCurrentAnnotation();
  if (!annotation) return;
  if (draft.points.length < 3) {
    showToast('Un polígono debe tener al menos 3 vértices.', 'warning');
    redrawCanvas();
    return;
  }
  const object = {
    id: crypto.randomUUID(),
    class_name: draft.className,
    class_id: draft.classId,
    class_orientation_id: state.currentOrientationId,
    polygon: draft.points.map(pt => ({ x: pt.x, y: pt.y })),
    bbox: null,
    isValid: true,
    meta: {},
    enabled: true
  };
  const adjustResult = adjustPolygonToAlpha(object.polygon, state.imageAlphaData);
  if (adjustResult.discard) {
    showToast('Zona marcada inválida (alpha=0 sin borde válido)', 'warning');
    redrawCanvas();
    return;
  }
  if (adjustResult.autoAdjusted) {
    object.polygon = adjustResult.polygon;
    object.meta.autoAdjusted = true;
    object.meta.autoAdjustedPending = true;
    object.meta.adjustedVertices = adjustResult.movedVertices.slice();
  }
  updateDerivedData(annotation, object);
  annotation.objects.push(object);
  if (adjustResult.autoAdjusted) {
    showToast('Polígono ajustado al borde visible (alpha)', 'info');
  }
  selectObject(object.id, null);
  markImageDirty(annotation.file_name);
  updateZonesList();
  redrawCanvas();
}

function selectObject(objectId, vertexIndex) {
  state.selectedObjectId = objectId;
  state.selectedVertexIndex = vertexIndex != null ? vertexIndex : null;
  renderSelectedObjectPanel();
  redrawCanvas();
}

function getObjectById(objectId) {
  const annotation = getCurrentAnnotation();
  if (!annotation) return null;
  return annotation.objects.find(obj => obj.id === objectId) || null;
}

function getHandleRadiusImage() {
  return HANDLE_CANVAS_PX / (state.scale * state.zoom);
}

function getMoveHandleRadiusImage() {
  return MOVE_HANDLE_CANVAS_PX / (state.scale * state.zoom);
}

function findVertexHandle(point) {
  const annotation = getCurrentAnnotation();
  if (!annotation) return null;
  const radius = getHandleRadiusImage();
  for (let i = annotation.objects.length - 1; i >= 0; i -= 1) {
    const object = annotation.objects[i];
    for (let j = 0; j < object.polygon.length; j += 1) {
      const vertex = object.polygon[j];
      if (distance(point, vertex) <= radius) {
        return { objectId: object.id, vertexIndex: j };
      }
    }
  }
  return null;
}

function findMoveHandle(point) {
  const annotation = getCurrentAnnotation();
  if (!annotation) return null;
  const radius = getMoveHandleRadiusImage();
  for (let i = annotation.objects.length - 1; i >= 0; i -= 1) {
    const object = annotation.objects[i];
    const centroid = getPolygonCentroid(object.polygon);
    if (centroid && distance(point, centroid) <= radius) {
      return { objectId: object.id };
    }
  }
  return null;
}

function findObjectContainingPoint(point) {
  const annotation = getCurrentAnnotation();
  if (!annotation) return null;
  for (let i = annotation.objects.length - 1; i >= 0; i -= 1) {
    const object = annotation.objects[i];
    if (pointInPolygon(point, object.polygon)) {
      return object;
    }
  }
  return null;
}

function findEdgeForInsertion(object, point) {
  const radius = getHandleRadiusImage();
  for (let i = 0; i < object.polygon.length; i += 1) {
    const a = object.polygon[i];
    const b = object.polygon[(i + 1) % object.polygon.length];
    const distanceToEdge = distancePointToSegment(point, a, b);
    if (distanceToEdge <= radius) {
      return i;
    }
  }
  return null;
}

function getImagePointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const canvasX = event.clientX - rect.left;
  const canvasY = event.clientY - rect.top;
  return canvasPointToImage(canvasX, canvasY);
}

function getCanvasPointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const canvasX = event.clientX - rect.left;
  const canvasY = event.clientY - rect.top;
  return { x: canvasX, y: canvasY };
}

function canvasPointToImage(canvasX, canvasY) {
  if (!state.imageElement) return null;
  const annotation = getCurrentAnnotation();
  if (!annotation) return null;
  const x = (canvasX - state.panX) / (state.scale * state.zoom);
  const y = (canvasY - state.panY) / (state.scale * state.zoom);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return { x, y };
  }
  return null;
}

function imagePointToCanvas(point) {
  return {
    x: state.panX + point.x * state.scale * state.zoom,
    y: state.panY + point.y * state.scale * state.zoom
  };
}

function clampPointToImage(point, annotation) {
  return {
    x: Math.min(Math.max(point.x, 0), annotation.width || point.x),
    y: Math.min(Math.max(point.y, 0), annotation.height || point.y)
  };
}

function updateDerivedData(annotation, object) {
  if (state.classMap.has(object.class_name)) {
    object.class_id = state.classMap.get(object.class_name);
  } else if (typeof object.class_id !== 'number') {
    object.class_id = 0;
  }
  const orientationId = Number(object.class_orientation_id);
  if (!Number.isInteger(orientationId) || orientationId < 0 || orientationId >= ORIENTATION_COUNT) {
    object.class_orientation_id = ORIENT_DEFAULT_ID;
    object.meta = object.meta || {};
    object.meta.orientationDefaulted = true;
  } else if (object.meta && object.meta.orientationDefaulted) {
    delete object.meta.orientationDefaulted;
  }
  if (!object.meta) {
    object.meta = {};
  }
  const bbox = computeBoundingBox(object.polygon);
  object.bbox = bbox;
  const validation = validatePolygon(annotation, object);
  validation.warnings = Array.isArray(validation.warnings) ? validation.warnings : [];
  if (object.meta?.autoAdjusted && Array.isArray(object.meta.adjustedVertices)) {
    object.meta.adjustedVertices.forEach(index => {
      const message = `Vértice ${index + 1} ajustado al borde visible (alpha).`;
      if (!validation.warnings.includes(message)) {
        validation.warnings.push(message);
      }
    });
  }
  if (object.meta?.orientationDefaulted) {
    const message = `Orientación por defecto aplicada (${getOrientationLabel(ORIENT_DEFAULT_ID)}).`;
    if (!validation.warnings.includes(message)) {
      validation.warnings.push(message);
    }
  }
  object.isValid = validation.errors.length === 0;
  object.validation = validation;
}

function computeBoundingBox(polygon) {
  if (!polygon || polygon.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  polygon.forEach(pt => {
    minX = Math.min(minX, pt.x);
    minY = Math.min(minY, pt.y);
    maxX = Math.max(maxX, pt.x);
    maxY = Math.max(maxY, pt.y);
  });
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function validatePolygon(annotation, object) {
  const errors = [];
  const warnings = [];
  let blockExport = false;
  const polygon = object.polygon || [];
  if (!Array.isArray(polygon) || polygon.length < 3) {
    errors.push('El polígono debe tener al menos 3 vértices.');
    return { errors, warnings, blockExport };
  }
  const { width, height } = annotation;
  for (let i = 0; i < polygon.length; i += 1) {
    const point = polygon[i];
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      errors.push('Coordenadas inválidas.');
      break;
    }
    if (width && (point.x < 0 || point.x > width) || height && (point.y < 0 || point.y > height)) {
      warnings.push('Algunos vértices fueron ajustados al borde de la imagen.');
    }
  }
  const className = typeof object.class_name === 'string'
    ? object.class_name
    : (annotation && typeof annotation.class_name === 'string'
        ? annotation.class_name
        : (typeof state.currentClassName === 'string' ? state.currentClassName : null));
  const minArea = className === 'ojos' ? MIN_EYE_POLYGON_AREA : MIN_POLYGON_AREA;
  const area = Math.abs(polygonArea(polygon));
  if (area < minArea) {
    if (className !== 'ojos') {
      errors.push('El área del polígono es demasiado pequeña.');
    }
  }
  if (hasSelfIntersection(polygon)) {
    warnings.push('El polígono tiene auto-intersecciones.');
    blockExport = true;
  }
  return { errors, warnings, blockExport };
}

function polygonArea(polygon) {
  let area = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function hasSelfIntersection(polygon) {
  const n = polygon.length;
  for (let i = 0; i < n; i += 1) {
    const a1 = polygon[i];
    const a2 = polygon[(i + 1) % n];
    for (let j = i + 1; j < n; j += 1) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) {
        continue;
      }
      const b1 = polygon[j];
      const b2 = polygon[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }
  return false;
}

function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = direction(p3, p4, p1);
  const d2 = direction(p3, p4, p2);
  const d3 = direction(p1, p2, p3);
  const d4 = direction(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;
  return false;
}

function direction(pi, pj, pk) {
  return (pk.x - pi.x) * (pj.y - pi.y) - (pj.x - pi.x) * (pk.y - pi.y);
}

function onSegment(pi, pj, pk) {
  return (
    Math.min(pi.x, pj.x) <= pk.x && pk.x <= Math.max(pi.x, pj.x) &&
    Math.min(pi.y, pj.y) <= pk.y && pk.y <= Math.max(pi.y, pj.y)
  );
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi + 0.0000001) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distancePointToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) {
    return distance(point, a);
  }
  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy);
  const clampedT = Math.max(0, Math.min(1, t));
  const projection = { x: a.x + clampedT * dx, y: a.y + clampedT * dy };
  return distance(point, projection);
}

function getPolygonCentroid(polygon) {
  if (!polygon || polygon.length === 0) return null;
  let x = 0;
  let y = 0;
  polygon.forEach(point => {
    x += point.x;
    y += point.y;
  });
  return { x: x / polygon.length, y: y / polygon.length };
}

/**
 * Redibuja la escena completa (textura base, objetos, overlays) aplicando salvaguardas
 * ante posibles fallos de renderizado de canvas.
 */
function redrawCanvas() {
  if (!canvas || !ctx) {
    console.error('redrawCanvas no puede ejecutarse: contexto o canvas ausente.');
    return;
  }

  if (pixelRenderer) {
    pixelRenderer.ensurePixelPerfectConfig();
    pixelRenderer.clearCanvas();
  } else {
    try {
      applyPixelPerfectConfig(ctx);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    } catch (error) {
      console.error('No se pudo limpiar el canvas con el fallback de contexto.', error);
    }
  }

  if (!state.imageElement) {
    return;
  }

  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } catch (error) {
    console.error('No se pudo restablecer la transformación del canvas.', error);
  }

  const { baseWidth, baseHeight, drawWidth, drawHeight } = getZoomedDrawDimensions();
  const destX = Math.round(state.panX);
  const destY = Math.round(state.panY);
  const destWidth = Math.round(drawWidth);
  const destHeight = Math.round(drawHeight);

  if (pixelRenderer) {
    pixelRenderer.drawTexture(state.imageElement, {
      sourceWidth: baseWidth,
      sourceHeight: baseHeight,
      destX,
      destY,
      destWidth,
      destHeight
    });
  } else {
    try {
      ctx.drawImage(
        state.imageElement,
        0,
        0,
        baseWidth,
        baseHeight,
        destX,
        destY,
        destWidth,
        destHeight
      );
    } catch (error) {
      console.error('drawImage falló en el renderer de fallback.', error);
    }
  }

  ctx.restore();

  try {
    drawObjects();
  } catch (error) {
    console.error('drawObjects falló durante el renderizado.', error);
  }

  try {
    drawDraft();
  } catch (error) {
    console.error('drawDraft falló durante el renderizado.', error);
  }

  try {
    drawOverlay();
  } catch (error) {
    console.error('drawOverlay falló durante el renderizado.', error);
  }
}

function drawObjects() {
  if (!ctx) {
    console.error('drawObjects no puede ejecutarse sin contexto 2D.');
    return;
  }
  const annotation = getCurrentAnnotation();
  if (!annotation) return;
  annotation.objects.forEach(object => {
    drawPolygon(object);
  });
}

function drawPolygon(object) {
  if (!object.polygon || object.polygon.length === 0) return;
  const color = state.colors.get(object.class_name) || 'rgba(255,255,255,0.4)';
  ctx.save();
  ctx.beginPath();
  object.polygon.forEach((point, index) => {
    const { x, y } = imagePointToCanvas(point);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.strokeStyle = object.isValid ? color.replace('0.4', '1') : 'rgba(255,0,0,0.8)';
  ctx.lineWidth = object.id === state.selectedObjectId ? 3 : 2;
  ctx.fill();
  ctx.stroke();

  drawPolygonHandles(object);
  drawPolygonLabel(object);
  ctx.restore();
}

function drawPolygonHandles(object) {
  const radius = HANDLE_CANVAS_PX;
  const highlightPending = object.meta?.autoAdjustedPending;
  const adjustedVerticesSet = highlightPending && Array.isArray(object.meta?.adjustedVertices)
    ? new Set(object.meta.adjustedVertices)
    : null;
  object.polygon.forEach((point, index) => {
    const { x, y } = imagePointToCanvas(point);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    const isAdjusted = adjustedVerticesSet ? adjustedVerticesSet.has(index) : false;
    ctx.fillStyle = isAdjusted ? '#ff7043' : 'white';
    ctx.fill();
    ctx.lineWidth = 2;
    const isSelected = object.id === state.selectedObjectId && state.selectedVertexIndex === index;
    if (isSelected) {
      ctx.strokeStyle = '#ff9800';
    } else {
      ctx.strokeStyle = isAdjusted ? '#ff7043' : '#333';
    }
    ctx.stroke();
  });
  const centroid = getPolygonCentroid(object.polygon);
  if (centroid) {
    const { x, y } = imagePointToCanvas(centroid);
    const size = MOVE_HANDLE_CANVAS_PX;
    ctx.beginPath();
    ctx.rect(x - size / 2, y - size / 2, size, size);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawPolygonLabel(object) {
  const centroid = getPolygonCentroid(object.polygon);
  if (!centroid) return;
  const { x, y } = imagePointToCanvas(centroid);
  ctx.save();
  ctx.fillStyle = '#222';
  ctx.font = '14px sans-serif';
  ctx.textBaseline = 'bottom';
  const orientationKey = getOrientationKey(object.class_orientation_id);
  const label = object.class_name ? `${object.class_name}:${orientationKey}` : `clase ${object.class_id}`;
  ctx.fillText(label, x + 6, y - 6);
  ctx.restore();
}

function drawDraft() {
  if (!ctx) {
    console.error('drawDraft no puede ejecutarse sin contexto 2D.');
    return;
  }
  if (!state.drawingDraft || state.drawingDraft.points.length === 0) return;
  ctx.save();
  ctx.strokeStyle = '#1976d2';
  ctx.fillStyle = 'rgba(25, 118, 210, 0.2)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  state.drawingDraft.points.forEach((point, index) => {
    const canvasPoint = imagePointToCanvas(point);
    if (index === 0) {
      ctx.moveTo(canvasPoint.x, canvasPoint.y);
    } else {
      ctx.lineTo(canvasPoint.x, canvasPoint.y);
    }
  });
  if (state.drawingDraft.preview) {
    const previewCanvas = imagePointToCanvas(state.drawingDraft.preview);
    ctx.lineTo(previewCanvas.x, previewCanvas.y);
  }
  ctx.stroke();
  state.drawingDraft.points.forEach(point => {
    const { x, y } = imagePointToCanvas(point);
    ctx.beginPath();
    ctx.arc(x, y, HANDLE_CANVAS_PX, 0, Math.PI * 2);
    ctx.fillStyle = '#1976d2';
    ctx.fill();
  });
  ctx.restore();
}

function drawOverlay() {
  if (!ctx) {
    console.error('drawOverlay no puede ejecutarse sin contexto 2D.');
    return;
  }
  const annotation = getCurrentAnnotation();
  if (!annotation) return;
  const zoomPercent = Math.round(state.scale * state.zoom * 100);
  const totalObjects = annotation.objects.length;
  const validObjects = annotation.objects.filter(obj => obj.isValid).length;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(10, 10, 220, 60);
  ctx.fillStyle = '#fff';
  ctx.font = '14px sans-serif';
  ctx.fillText(`Zoom: ${zoomPercent}%`, 20, 30);
  ctx.fillText(`Objetos: ${validObjects}/${totalObjects}`, 20, 50);
  ctx.restore();
}

/**
 * Exporta la textura visible a PNG preservando alpha. Si el entorno no soporta la
 * configuración avanzada intenta un fallback básico.
 *
 * @returns {string|null} Cadena base64 de la textura o null si la exportación falla.
 */
function getCurrentTexturePngDataUrl() {
  if (!canvas) {
    console.error('No es posible exportar la textura: canvas ausente.');
    return null;
  }

  if (pixelRenderer) {
    return pixelRenderer.exportToPng();
  }

  try {
    applyPixelPerfectConfig(ctx);
    return canvas.toDataURL('image/png');
  } catch (error) {
    console.error('Falló la exportación PNG desde el contexto de reserva.', error);
    return null;
  }
}

if (typeof window !== 'undefined') {
  window.getCurrentTexturePngDataUrl = getCurrentTexturePngDataUrl;
}

function updateZonesList() {
  const annotation = getCurrentAnnotation();
  zonesList.innerHTML = '';
  if (!annotation) {
    zonesList.textContent = 'Sin anotaciones.';
    return;
  }
  if (annotation.objects.length === 0) {
    zonesList.textContent = 'Sin objetos anotados.';
    return;
  }
  const groups = new Map();
  annotation.objects.forEach(object => {
    if (!groups.has(object.class_name)) {
      groups.set(object.class_name, []);
    }
    groups.get(object.class_name).push(object);
  });
  groups.forEach((objects, className) => {
    const container = document.createElement('div');
    container.classList.add('class-group');
    const header = document.createElement('div');
    const invalidCount = objects.filter(obj => !obj.isValid).length;
    const blockedCount = objects.filter(obj => obj.validation?.blockExport).length;
    const enabledCount = objects.filter(obj => isObjectEnabledByConfig(obj)).length;
    const summaryParts = [`${className} (${objects.length})`];
    if (invalidCount) {
      summaryParts.push(`${invalidCount} inválidos`);
    }
    if (blockedCount) {
      summaryParts.push(`${blockedCount} con advertencias`);
    }
    summaryParts.push(`${enabledCount} exportables`);
    header.textContent = summaryParts.join(' · ');
    header.classList.add('class-group-header');
    container.appendChild(header);
    objects.forEach(object => {
      const item = document.createElement('button');
      item.type = 'button';
      item.classList.add('object-item');
      if (object.id === state.selectedObjectId) {
        item.classList.add('active');
      }
      const orientationKey = getOrientationKey(object.class_orientation_id);
      const segments = [`ID ${object.id.slice(0, 8)}`, `${object.polygon.length} vértices`, `ori: ${orientationKey}`];
      if (!isObjectEnabledByConfig(object)) {
        segments.push('desactivado');
        item.style.opacity = '0.6';
      }
      if (object.meta?.orientationDefaulted) {
        segments.push('orientación por defecto');
      }
      item.textContent = segments.join(' · ');
      if (!object.isValid) {
        item.classList.add('invalid');
      }
      if (object.validation?.blockExport) {
        item.classList.add('warning');
      }
      if (object.meta?.orientationDefaulted) {
        item.classList.add('warning');
      }
      item.addEventListener('click', () => {
        selectObject(object.id, null);
      });
      container.appendChild(item);
    });
    zonesList.appendChild(container);
  });
  const errors = state.annotationErrors.get(annotation.file_name);
  if (errors && errors.length > 0) {
    const errorPanel = document.createElement('div');
    errorPanel.classList.add('error-panel');
    const title = document.createElement('strong');
    title.textContent = `Errores de anotación (${errors.length}):`;
    errorPanel.appendChild(title);
    const list = document.createElement('ul');
    errors.forEach(err => {
      const li = document.createElement('li');
      li.textContent = `${err.objectId.slice(0, 8)} · ${err.message}`;
      list.appendChild(li);
    });
    errorPanel.appendChild(list);
    zonesList.appendChild(errorPanel);
  }
  renderSelectedObjectPanel();
}

function generateYoloLines(annotation, config, classMap) {
  const lines = [];
  const errors = [];
  if (!annotation || !annotation.width || !annotation.height) {
    errors.push({ objectId: 'image', message: 'La imagen no tiene dimensiones definidas.' });
    return { lines, errors };
  }
  const { width, height } = annotation;
  const expandOrientations = Boolean(config?.export?.expandOrientations);
  const missingPolicy = config?.export?.missingOrientationPolicy || 'default';
  const filters = config?.export?.filter || {};
  annotation.objects.forEach(object => {
    if (!object.isValid) {
      errors.push({ objectId: object.id, message: (object.validation?.errors || ['Objeto inválido']).join(' · ') });
      return;
    }
    if (object.validation?.blockExport) {
      const warningMessage = object.validation?.warnings?.join(' · ') || 'El objeto tiene advertencias y no se exportó.';
      errors.push({ objectId: object.id, message: warningMessage });
      return;
    }
    const classEnabled = filters.classes ? filters.classes[object.class_name] !== false : true;
    if (!classEnabled) {
      return;
    }
    const baseClassId = classMap.get(object.class_name) ?? object.class_id ?? 0;
    let orientationId = Number.isInteger(object.class_orientation_id) ? object.class_orientation_id : null;
    const orientationValid = orientationId != null && orientationId >= 0 && orientationId < ORIENTATION_COUNT;
    if (!orientationValid) {
      if (missingPolicy === 'skip') {
        errors.push({ objectId: object.id, message: 'Orientación ausente → objeto omitido.' });
        return;
      }
      orientationId = ORIENT_DEFAULT_ID;
    }
    const orientationKey = String(orientationId);
    const orientationEnabled = filters.orientations ? filters.orientations[orientationKey] !== false : true;
    if (!orientationEnabled) {
      return;
    }
    const coords = normalisePolygon(object.polygon, width, height);
    if (!coords) {
      errors.push({ objectId: object.id, message: 'Normalización inválida.' });
      return;
    }
    if (expandOrientations) {
      const finalId = baseClassId * ORIENTATION_COUNT + orientationId;
      lines.push(`${finalId} ${coords.join(' ')}`);
    } else {
      lines.push(`${baseClassId} ${coords.join(' ')}`);
    }
  });
  return { lines, errors };
}

function normalisePolygon(polygon, width, height) {
  if (!polygon || !Array.isArray(polygon)) {
    return null;
  }
  const coords = [];
  for (const point of polygon) {
    const x = Number((point.x / width).toFixed(6));
    const y = Number((point.y / height).toFixed(6));
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    coords.push(x, y);
  }
  return coords;
}

function showToast(message, type = 'info') {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.padding = '10px 16px';
  toast.style.borderRadius = '4px';
  toast.style.color = '#fff';
  toast.style.fontSize = '14px';
  toast.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
  toast.style.backgroundColor = {
    success: '#4caf50',
    error: '#f44336',
    warning: '#ff9800',
    info: '#2196f3'
  }[type] || '#2196f3';
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
}

function showBanner(message) {
  if (!bannerContainer) return;
  const banner = document.createElement('div');
  banner.textContent = message;
  banner.style.backgroundColor = '#1976d2';
  banner.style.color = '#fff';
  banner.style.padding = '12px 20px';
  banner.style.borderRadius = '4px';
  banner.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
  bannerContainer.appendChild(banner);
  setTimeout(() => {
    banner.style.opacity = '0';
    banner.style.transition = 'opacity 0.4s';
    setTimeout(() => banner.remove(), 400);
  }, 6000);
}

function startDraftIfNeeded() {
  if (!state.drawingDraft && state.currentClassName) {
    startDraft({ x: 0, y: 0 });
  }
}

function syncAnnotationsWithClassMap() {
  Object.values(state.annotations).forEach(annotation => {
    annotation.objects.forEach(object => {
      if (state.classMap.has(object.class_name)) {
        object.class_id = state.classMap.get(object.class_name);
      }
      updateDerivedData(annotation, object);
    });
  });
  updateOrientationIssues();
}

// Export helpers for debugging (optional)
window.__DEBUG_STATE__ = state;
