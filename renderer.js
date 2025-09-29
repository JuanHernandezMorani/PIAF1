let state = {
    images: [],
    currentImageIndex: -1,
    currentZone: 'img_zone',
    drawing: false,
    startX: 0,
    startY: 0,
    currentRect: null,
    zones: {},
    selectedZone: null,
    isDragging: false,
    isResizing: false,
    resizeHandle: null,
    canvasRect: { left: 0, top: 0, width: 0, height: 0 },
    scale: 1,
    zoom: 1,
    panX: 0,
    panY: 0,
    isPanning: false,
    panStartX: 0,
    panStartY: 0
};

const canvas = document.getElementById('imageCanvas');
const ctx = canvas.getContext('2d');
const zoneSelect = document.getElementById('zoneSelect');
const imageList = document.getElementById('imageList');
const zonesList = document.getElementById('zonesList');
const layerSelect = document.getElementById('layerSelect');
const saveBtn = document.getElementById('saveBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const imageName = document.getElementById('imageName');
const imageIndex = document.getElementById('imageIndex');
const noImages = document.getElementById('noImages');

const colors = {
    'img_zone': 'grey', 'eyes': 'red', 'wings': 'blue', 'chest': 'green',
    'back': 'yellow', 'extremities': 'orange', 'fangs': 'purple', 
    'claws': 'cyan', 'head': 'pink', 'mouth': 'darkred',
    'heart': 'darkorange', 'cracks': 'lightgrey', 'cristal': 'violet',
    'flower': 'lightgreen', 'zombie_zone': 'darkgreen', 'armor': 'darkblue',
    'sky': 'lightblue', 'stars': 'white', 'extra': 'magenta'
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
    const imagesResult = await window.electronAPI.loadImages();
    if (imagesResult.success) {
        state.images = imagesResult.images;
        if (state.images.length > 0) {
            noImages.style.display = 'none';
            canvas.style.display = 'block';
            await loadExistingData();
            state.currentImageIndex = 0;
            loadImage(state.currentImageIndex);
            updateImageList();
        } else {
            noImages.style.display = 'block';
            canvas.style.display = 'none';
        }
    } else {
        alert('Error al cargar imágenes: ' + imagesResult.error);
    }
    
    setupEventListeners();
}

async function loadExistingData() {
    const result = await window.electronAPI.loadExistingData();
    if (result.success && result.data) {
        const existingData = result.data;
        const missingImages = [];
        const imageNames = new Set(state.images.map(img => img.name));
        
        existingData.forEach(item => {
            const fileName = item.file_name;
            if (imageNames.has(fileName)) {
                if (!state.zones[fileName]) {
                    state.zones[fileName] = {
                        layer: 'base',
                        img_zone: [], eyes: [], wings: [], chest: [], back: [],
                        extremities: [], fangs: [], claws: [], head: [], mouth: [],
                        heart: [], cracks: [], cristal: [], flower: [], zombie_zone: [],
                        armor: [], sky: [], stars: [], extra: []
                    };
                }
                if (item.layer) {
                    state.zones[fileName].layer = item.layer;
                }
                const zoneTypes = Object.keys(state.zones[fileName]).filter(z => z !== 'layer');
                zoneTypes.forEach(zoneType => {
                    if (item[zoneType] && Array.isArray(item[zoneType])) {
                        state.zones[fileName][zoneType] = item[zoneType].map(zone => ({
                            x: zone.x,
                            y: zone.y,
                            w: zone.w,
                            h: zone.h
                        }));
                    }
                });
            } else {
                missingImages.push(fileName);
            }
        });
        
        if (missingImages.length > 0) {
            if (missingImages.length <= 10) {
                alert(`Advertencia: ${missingImages.length} imágenes del archivo trainData.jsonl no se encontraron en la carpeta:\n${missingImages.join('\n')}`);
            } else {
                alert(`Advertencia: ${missingImages.length} imágenes del archivo trainData.jsonl no se encontraron en la carpeta. Verifica la consola para ver la lista completa.`);
            }
        }
        
        if (state.currentImageIndex >= 0) {
            redrawCanvas();
            updateZonesList();
        }
    }
}

function setupEventListeners() {
    zoneSelect.addEventListener('change', () => {
        state.currentZone = zoneSelect.value;
        state.selectedZone = null;
        updateZonesList();
        redrawCanvas();
    });
    
    canvas.addEventListener('mousedown', startDrawing);
    window.addEventListener('mousemove', drawing);
    window.addEventListener('mouseup', stopDrawing);
    
    saveBtn.addEventListener('click', saveData);
    prevBtn.addEventListener('click', prevImage);
    nextBtn.addEventListener('click', nextImage);
    
    document.addEventListener('keydown', handleKeydown);
    
    layerSelect.addEventListener('change', updateLayer);
    
    window.addEventListener('resize', () => {
        if (state.currentImageIndex >= 0) {
            loadImage(state.currentImageIndex);
        }
    });
    
    canvas.addEventListener('wheel', handleWheel);
}

function loadImage(index) {
    if (index < 0 || index >= state.images.length) return;
    
    state.currentImageIndex = index;
    const image = state.images[index];
    
    if (!state.zones[image.name]) {
        state.zones[image.name] = {
            layer: 'base',
            img_zone: [], eyes: [], wings: [], chest: [], back: [],
            extremities: [], fangs: [], claws: [], head: [], mouth: [],
            heart: [], cracks: [], cristal: [], flower: [], zombie_zone: [],
            armor: [], sky: [], stars: [], extra: []
        };
    }
    
    imageName.textContent = image.name;
    imageIndex.textContent = `${index + 1}/${state.images.length}`;
    layerSelect.value = state.zones[image.name].layer;
    
    updateImageList();
    updateZonesList();
    
    const img = new Image();
    img.onload = function() {
        const container = canvas.parentElement;
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;
        
        const imgRatio = img.width / img.height;
        const containerRatio = containerWidth / containerHeight;
        
        let renderWidth, renderHeight;
        
        if (imgRatio > containerRatio) {
            renderWidth = containerWidth;
            renderHeight = containerWidth / imgRatio;
        } else {
            renderHeight = containerHeight;
            renderWidth = containerHeight * imgRatio;
        }
        
        canvas.width = containerWidth;
        canvas.height = containerHeight;
        
        state.scale = Math.min(renderWidth / img.width, renderHeight / img.height);
        
        const rect = canvas.getBoundingClientRect();
        state.canvasRect = {
            left: rect.left,
            top: rect.top,
            width: containerWidth,
            height: containerHeight
        };
        
        state.zoom = 1;
        state.panX = (containerWidth - img.width * state.scale) / 2;
        state.panY = (containerHeight - img.height * state.scale) / 2;
        
        redrawCanvas();
    };
    img.src = image.dataUrl;
}

function getMousePos(e) {
    const rect = state.canvasRect;
    const scale = state.scale * state.zoom;
    
    const x = (e.clientX - rect.left - state.panX) / scale;
    const y = (e.clientY - rect.top - state.panY) / scale;
    
    return { x, y };
}

function startDrawing(e) {
    if (e.button !== 0) return;
    
    const mousePos = getMousePos(e);
    const x = mousePos.x;
    const y = mousePos.y;
    
    if (x < 0 || y < 0 || x > canvas.width / (state.scale * state.zoom) || y > canvas.height / (state.scale * state.zoom)) return;
    
    if (e.ctrlKey || e.metaKey) {
        state.isPanning = true;
        state.panStartX = e.clientX - state.panX;
        state.panStartY = e.clientY - state.panY;
        canvas.style.cursor = 'grabbing';
        return;
    }
    
    const handleInfo = getHandleAt(x, y);
    if (handleInfo) {
        if (handleInfo.type === 'move') {
            state.isDragging = true;
            state.dragStartX = x;
            state.dragStartY = y;
        } else {
            state.isResizing = true;
            state.resizeHandle = handleInfo.type;
            state.resizeStartX = x;
            state.resizeStartY = y;
        }
        state.selectedZone = handleInfo.zone;
        updateZonesList();
        redrawCanvas();
        return;
    }
    
    const clickedZone = getZoneAt(x, y, state.currentZone);
    if (clickedZone) {
        state.selectedZone = clickedZone;
        state.isDragging = true;
        state.dragStartX = x;
        state.dragStartY = y;
        updateZonesList();
        redrawCanvas();
        return;
    }
    
    state.drawing = true;
    state.startX = x;
    state.startY = y;
    state.currentRect = {
        x: x,
        y: y,
        w: 0,
        h: 0
    };
}

function drawing(e) {
    if (!state.drawing && !state.isDragging && !state.isResizing && !state.isPanning) return;
    
    const mousePos = getMousePos(e);
    const x = mousePos.x;
    const y = mousePos.y;
    
    if (state.drawing) {
        redrawCanvas();
        
        const w = x - state.startX;
        const h = y - state.startY;
        
        state.currentRect.w = w;
        state.currentRect.h = h;
        
        drawZone(state.currentRect, state.currentZone, 0, true);
    } else if (state.isDragging && state.selectedZone && state.selectedZone.zoneType === state.currentZone) {
        const dx = x - state.dragStartX;
        const dy = y - state.dragStartY;
        
        const imageName = state.images[state.currentImageIndex].name;
        const zone = state.zones[imageName][state.selectedZone.zoneType][state.selectedZone.index];
        
        zone.x = Math.max(0, Math.min(1 - zone.w, zone.x + dx));
        zone.y = Math.max(0, Math.min(1 - zone.h, zone.y + dy));
        
        state.dragStartX = x;
        state.dragStartY = y;
        
        redrawCanvas();
    } else if (state.isResizing && state.selectedZone && state.selectedZone.zoneType === state.currentZone && state.resizeHandle) {
        const dx = x - state.resizeStartX;
        const dy = y - state.resizeStartY;
        
        const imageName = state.images[state.currentImageIndex].name;
        const zone = state.zones[imageName][state.selectedZone.zoneType][state.selectedZone.index];
        
        const handle = state.resizeHandle;
        
        if (handle === 'e') {
            zone.w = Math.max(0.01, Math.min(1 - zone.x, zone.w + dx));
        } else if (handle === 'w') {
            const newX = Math.max(0, Math.min(zone.x + zone.w - 0.01, zone.x + dx));
            zone.w = Math.max(0.01, zone.w - (newX - zone.x));
            zone.x = newX;
        } else if (handle === 's') {
            zone.h = Math.max(0.01, Math.min(1 - zone.y, zone.h + dy));
        } else if (handle === 'n') {
            const newY = Math.max(0, Math.min(zone.y + zone.h - 0.01, zone.y + dy));
            zone.h = Math.max(0.01, zone.h - (newY - zone.y));
            zone.y = newY;
        } else if (handle === 'ne') {
            zone.w = Math.max(0.01, Math.min(1 - zone.x, zone.w + dx));
            const newY = Math.max(0, Math.min(zone.y + zone.h - 0.01, zone.y + dy));
            zone.h = Math.max(0.01, zone.h - (newY - zone.y));
            zone.y = newY;
        } else if (handle === 'nw') {
            const newX = Math.max(0, Math.min(zone.x + zone.w - 0.01, zone.x + dx));
            zone.w = Math.max(0.01, zone.w - (newX - zone.x));
            zone.x = newX;
            const newY = Math.max(0, Math.min(zone.y + zone.h - 0.01, zone.y + dy));
            zone.h = Math.max(0.01, zone.h - (newY - zone.y));
            zone.y = newY;
        } else if (handle === 'se') {
            zone.w = Math.max(0.01, Math.min(1 - zone.x, zone.w + dx));
            zone.h = Math.max(0.01, Math.min(1 - zone.y, zone.h + dy));
        } else if (handle === 'sw') {
            const newX = Math.max(0, Math.min(zone.x + zone.w - 0.01, zone.x + dx));
            zone.w = Math.max(0.01, zone.w - (newX - zone.x));
            zone.x = newX;
            zone.h = Math.max(0.01, Math.min(1 - zone.y, zone.h + dy));
        }
        
        state.resizeStartX = x;
        state.resizeStartY = y;
        
        redrawCanvas();
    } else if (state.isPanning) {
        state.panX = e.clientX - state.panStartX;
        state.panY = e.clientY - state.panStartY;
        redrawCanvas();
    }
}

function stopDrawing(e) {
    if (state.drawing && state.currentRect) {
        if (Math.abs(state.currentRect.w) > 0.001 && Math.abs(state.currentRect.h) > 0.001) {
            if (state.currentRect.w < 0) {
                state.currentRect.x += state.currentRect.w;
                state.currentRect.w = -state.currentRect.w;
            }
            if (state.currentRect.h < 0) {
                state.currentRect.y += state.currentRect.h;
                state.currentRect.h = -state.currentRect.h;
            }
            
            const imageName = state.images[state.currentImageIndex].name;
            state.zones[imageName][state.currentZone].push({
                x: state.currentRect.x,
                y: state.currentRect.y,
                w: state.currentRect.w,
                h: state.currentRect.h
            });
            
            updateZonesList();
        }
    }
    
    state.drawing = false;
    state.isDragging = false;
    state.isResizing = false;
    state.isPanning = false;
    canvas.style.cursor = 'crosshair';
    state.currentRect = null;
    redrawCanvas();
}

function drawAllZones() {
    const imageName = state.images[state.currentImageIndex].name;
    const zones = state.zones[imageName];
    
    if (zones[state.currentZone]) {
        zones[state.currentZone].forEach((zone, index) => {
            drawZone(zone, state.currentZone, index, false);
        });
    }
}

function drawZone(zone, zoneType, index, isTemp) {
    const scale = state.scale * state.zoom;
    const x = zone.x * scale + state.panX;
    const y = zone.y * scale + state.panY;
    const w = zone.w * scale;
    const h = zone.h * scale;
    
    ctx.strokeStyle = colors[zoneType];
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
    
    if (!isTemp) {
        ctx.fillStyle = 'white';
        ctx.font = '12px Arial';
        ctx.fillText(`${zoneType} ${index + 1}`, x + 5, y + 15);
    }
}

function redrawCanvas() {
    const image = state.images[state.currentImageIndex];
    const img = new Image();
    img.onload = function() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const scale = state.scale * state.zoom;
        ctx.drawImage(img, state.panX, state.panY, img.width * scale, img.height * scale);
        
        drawAllZones();
        
        if (state.drawing && state.currentRect) {
            drawZone(state.currentRect, state.currentZone, 0, true);
        }
        
        if (state.selectedZone && state.selectedZone.zoneType === state.currentZone) {
            const imageName = state.images[state.currentImageIndex].name;
            const zone = state.zones[imageName][state.selectedZone.zoneType][state.selectedZone.index];
            
            const x = zone.x * scale + state.panX;
            const y = zone.y * scale + state.panY;
            const w = zone.w * scale;
            const h = zone.h * scale;
            
            drawHandles(x, y, w, h);
        }
        
        drawZoomInfo();
    };
    img.src = image.dataUrl;
}

function drawHandles(x, y, w, h) {
    const handleSize = 8;
    
    ctx.fillStyle = '#3498db';
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1;
    
    const handles = [
        { x: x + w/2, y: y - handleSize, type: 'move' },
        { x: x, y: y, type: 'nw' },
        { x: x + w, y: y, type: 'ne' },
        { x: x, y: y + h, type: 'sw' },
        { x: x + w, y: y + h, type: 'se' },
        { x: x + w/2, y: y, type: 'n' },
        { x: x + w, y: y + h/2, type: 'e' },
        { x: x + w/2, y: y + h, type: 's' },
        { x: x, y: y + h/2, type: 'w' }
    ];
    
    handles.forEach(handle => {
        if (handle.type === 'move') {
            ctx.beginPath();
            ctx.moveTo(handle.x - handleSize, handle.y);
            ctx.lineTo(handle.x, handle.y - handleSize);
            ctx.lineTo(handle.x + handleSize, handle.y);
            ctx.lineTo(handle.x, handle.y + handleSize);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.arc(handle.x, handle.y, handleSize/2, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
    });
}

function drawZoomInfo() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(10, 10, 120, 25);
    
    ctx.fillStyle = 'white';
    ctx.font = '14px Arial';
    ctx.fillText(`Zoom: ${Math.round(state.zoom * 100)}%`, 20, 28);
}

function getZoneAt(x, y, zoneType = null) {
    const imageName = state.images[state.currentImageIndex].name;
    const zones = state.zones[imageName];
    
    const typesToCheck = zoneType ? [zoneType] : Object.keys(zones).filter(z => z !== 'layer');
    
    for (const type of typesToCheck) {
        if (type === 'layer') continue;
        
        for (let i = 0; i < zones[type].length; i++) {
            const zone = zones[type][i];
            const zoneX = zone.x;
            const zoneY = zone.y;
            const zoneW = zone.w;
            const zoneH = zone.h;
            
            if (x >= zoneX && x <= zoneX + zoneW && y >= zoneY && y <= zoneY + zoneH) {
                return { zoneType: type, index: i };
            }
        }
    }
    
    return null;
}

function getHandleAt(x, y) {
    if (!state.selectedZone || state.selectedZone.zoneType !== state.currentZone) return null;
    
    const imageName = state.images[state.currentImageIndex].name;
    const zone = state.zones[imageName][state.selectedZone.zoneType][state.selectedZone.index];
    const scale = state.scale * state.zoom;
    
    const zoneX = zone.x;
    const zoneY = zone.y;
    const zoneW = zone.w;
    const zoneH = zone.h;
    
    const handleSize = 0.02;
    
    const handles = [
        { x: zoneX + zoneW/2, y: zoneY - handleSize, type: 'move', zone: state.selectedZone },
        { x: zoneX, y: zoneY, type: 'nw', zone: state.selectedZone },
        { x: zoneX + zoneW, y: zoneY, type: 'ne', zone: state.selectedZone },
        { x: zoneX, y: zoneY + zoneH, type: 'sw', zone: state.selectedZone },
        { x: zoneX + zoneW, y: zoneY + zoneH, type: 'se', zone: state.selectedZone },
        { x: zoneX + zoneW/2, y: zoneY, type: 'n', zone: state.selectedZone },
        { x: zoneX + zoneW, y: zoneY + zoneH/2, type: 'e', zone: state.selectedZone },
        { x: zoneX + zoneW/2, y: zoneY + zoneH, type: 's', zone: state.selectedZone },
        { x: zoneX, y: zoneY + zoneH/2, type: 'w', zone: state.selectedZone }
    ];
    
    for (const handle of handles) {
        const distance = Math.sqrt(Math.pow(x - handle.x, 2) + Math.pow(y - handle.y, 2));
        if (distance <= handleSize) {
            return handle;
        }
    }
    
    return null;
}

function handleWheel(e) {
    e.preventDefault();
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const zoomIntensity = 0.1;
    const wheel = e.deltaY < 0 ? 1 : -1;
    const zoomFactor = Math.exp(wheel * zoomIntensity);
    
    const newZoom = Math.max(0.1, Math.min(5, state.zoom * zoomFactor));
    
    const scale = state.scale;
    const mouseImgX = (mouseX - state.panX) / (scale * state.zoom);
    const mouseImgY = (mouseY - state.panY) / (scale * state.zoom);
    
    state.panX = mouseX - mouseImgX * scale * newZoom;
    state.panY = mouseY - mouseImgY * scale * newZoom;
    state.zoom = newZoom;
    
    redrawCanvas();
}

function updateImageList() {
    imageList.innerHTML = '';
    state.images.forEach((image, index) => {
        const li = document.createElement('li');
        const zoneCount = getZoneCount(image.name);
        li.textContent = `${image.name} (${zoneCount})`;
        if (index === state.currentImageIndex) {
            li.classList.add('active');
        }
        li.addEventListener('click', () => {
            loadImage(index);
        });
        imageList.appendChild(li);
    });
}

function getZoneCount(imageName) {
    if (!state.zones[imageName]) return 0;
    let count = 0;
    for (const zoneType in state.zones[imageName]) {
        if (zoneType !== 'layer') {
            count += state.zones[imageName][zoneType].length;
        }
    }
    return count;
}

function updateZonesList() {
    zonesList.innerHTML = '';
    
    const imageName = state.images[state.currentImageIndex].name;
    const zones = state.zones[imageName];
    
    if (zones[state.currentZone]) {
        zones[state.currentZone].forEach((zone, index) => {
            const zoneItem = document.createElement('div');
            zoneItem.className = 'zone-item';
            if (state.selectedZone && 
                state.selectedZone.zoneType === state.currentZone && 
                state.selectedZone.index === index) {
                zoneItem.classList.add('selected');
            }
            
            zoneItem.innerHTML = `
                <div class="zone-header">
                    <strong>${state.currentZone} ${index + 1}</strong>
                    <button class="delete-zone" data-zone-type="${state.currentZone}" data-index="${index}">×</button>
                </div>
                <div class="zone-coords">
                    x: ${zone.x.toFixed(3)}, y: ${zone.y.toFixed(3)}<br>
                    w: ${zone.w.toFixed(3)}, h: ${zone.h.toFixed(3)}
                </div>
            `;
            
            zoneItem.addEventListener('click', (e) => {
                if (!e.target.classList.contains('delete-zone')) {
                    state.selectedZone = { zoneType: state.currentZone, index };
                    redrawCanvas();
                    updateZonesList();
                }
            });
            
            const deleteBtn = zoneItem.querySelector('.delete-zone');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteZone(state.currentZone, index);
            });
            
            zonesList.appendChild(zoneItem);
        });
    }
}

function deleteZone(zoneType, index) {
    const imageName = state.images[state.currentImageIndex].name;
    state.zones[imageName][zoneType].splice(index, 1);
    
    if (state.selectedZone && 
        state.selectedZone.zoneType === zoneType && 
        state.selectedZone.index === index) {
        state.selectedZone = null;
    }
    
    redrawCanvas();
    updateZonesList();
}

function updateLayer() {
    const imageName = state.images[state.currentImageIndex].name;
    state.zones[imageName].layer = layerSelect.value;
}

function prevImage() {
    if (state.currentImageIndex > 0) {
        loadImage(state.currentImageIndex - 1);
    }
}

function nextImage() {
    if (state.currentImageIndex < state.images.length - 1) {
        loadImage(state.currentImageIndex + 1);
    }
}

function handleKeydown(e) {
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveData();
    }
    
    if (e.key === 'ArrowLeft') {
        prevImage();
    } else if (e.key === 'ArrowRight') {
        nextImage();
    }
    
    if (e.ctrlKey && e.key === '0') {
        e.preventDefault();
        state.zoom = 1;
        const container = canvas.parentElement;
        state.panX = (container.clientWidth - canvas.width * state.scale) / 2;
        state.panY = (container.clientHeight - canvas.height * state.scale) / 2;
        redrawCanvas();
    }
    
    if (e.ctrlKey && e.key === '=') {
        e.preventDefault();
        state.zoom = Math.min(5, state.zoom * 1.2);
        redrawCanvas();
    }
    
    if (e.ctrlKey && e.key === '-') {
        e.preventDefault();
        state.zoom = Math.max(0.1, state.zoom / 1.2);
        redrawCanvas();
    }
}

async function saveData() {
    const data = [];
    
    for (const image of state.images) {
        if (state.zones[image.name]) {
            const imageData = {
                file_name: image.name,
                layer: state.zones[image.name].layer
            };
            
            for (const zoneType in state.zones[image.name]) {
                if (zoneType !== 'layer') {
                    imageData[zoneType] = state.zones[image.name][zoneType].map(zone => ({
                        x: zone.x,
                        y: zone.y,
                        w: zone.w,
                        h: zone.h
                    }));
                }
            }
            
            data.push(imageData);
        }
    }
    
    const result = await window.electronAPI.saveData(data);
    if (result.success) {
        alert('Datos guardados correctamente en trainData.jsonl');
    } else {
        alert('Error al guardar: ' + result.error);
    }
}
