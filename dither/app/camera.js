let video, canvas, ctx;
let animationId;
let currentFacingMode = 'environment';
let currentLongEdge = 640;
let frameCount = 0;
let lastFpsUpdate = Date.now();

let videoDevices = [];
let currentDeviceIndex = 0;
let backLenses = [];
let currentLens = null;

let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;
let isTouching = false;
let gestureMode = null;
const GESTURE_THRESHOLD = 30;
const TAP_MAX_DURATION = 300;

let uiHidden = false;

const GALLERY_KEY = 'dither_gallery';

let currentPreviewData = null;
let currentSaveScale = 1;

let isFrozen = false;
let unfreezeTimer = null;
const FREEZE_DURATION = 500; // ms

function getCanvasDimensions() {
    const viewportAspect = window.innerWidth / window.innerHeight;
    const isPortrait = viewportAspect < 1;
    if (isPortrait) {
        const height = currentLongEdge;
        const width = Math.round(height * viewportAspect);
        return { width, height };
    } else {
        const width = currentLongEdge;
        const height = Math.round(width / viewportAspect);
        return { width, height };
    }
}

function updateCanvasSize() {
    const { width, height } = getCanvasDimensions();
    canvas.width = width;
    canvas.height = height;
    updateCanvasDisplaySize();
}

function updateCanvasDisplaySize() {
    if (!canvas) return;
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.position = 'fixed';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.transform = 'none';
}

async function enumerateCameras() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        videoDevices = devices.filter(d => d.kind === 'videoinput');
        console.log('Found cameras:', videoDevices.length);
        videoDevices.forEach((d, i) => console.log(`  [${i}] ${d.label}`));
        classifyBackLenses();
        renderLensSegmented();
    } catch (err) {
        console.error('Failed to enumerate cameras:', err);
    }
}

function classifyBackLenses() {
    backLenses = [];
    const label = d => (d.label || '').toLowerCase();
    if (videoDevices.length > 0 && videoDevices.every(d => !d.label)) {
        currentLens = null;
        return;
    }
    videoDevices.forEach(d => {
        const l = label(d);
        const isBack = l.includes('back') || l.includes('environment') || !l.includes('front');
        if (!isBack) return;
        let type = 'wide';
        let multiplier = '1×';
        if (l.includes('ultra') || l.includes('0.5')) {
            type = 'ultra';
            multiplier = '0.5×';
        } else if (l.includes('tele') || /[0-9]+x/.test(l)) {
            type = 'tele';
            const match = l.match(/([0-9]+)x/);
            multiplier = match ? match[1] + '×' : '2×';
        }
        backLenses.push({ id: type, label: d.label, deviceId: d.deviceId, type, multiplier });
    });
    const seen = new Set();
    backLenses = backLenses.filter(l => {
        if (seen.has(l.deviceId)) return false;
        seen.add(l.deviceId);
        return true;
    });
    const wideCount = backLenses.filter(l => l.type === 'wide').length;
    if (backLenses.length > 1 && wideCount > 1) {
        let teleCount = 0;
        backLenses = backLenses.map(l => {
            if (l.type === 'wide' && teleCount < backLenses.length - 1) {
                teleCount++;
                return (teleCount === 1) ? l : { ...l, id: 'tele', type: 'tele', multiplier: (teleCount + 1) + '×' };
            }
            return l;
        });
    }
    // Deduplicate by multiplier — keep first occurrence of each zoom level
    const seenMultiplier = new Set();
    backLenses = backLenses.filter(l => {
        if (seenMultiplier.has(l.multiplier)) return false;
        seenMultiplier.add(l.multiplier);
        return true;
    });
    // Only keep 0.5×, 1×, 2×
    backLenses = backLenses.filter(l => ['0.5×', '1×', '2×'].includes(l.multiplier));
    const order = { ultra: 0, wide: 1, tele: 2 };
    backLenses.sort((a, b) => {
        const typeDiff = order[a.type] - order[b.type];
        if (typeDiff !== 0) return typeDiff;
        return parseFloat(a.multiplier) - parseFloat(b.multiplier);
    });
    if (!currentLens || !backLenses.find(l => l.deviceId === currentLens.deviceId)) {
        currentLens = backLenses.find(l => l.type === 'wide') || backLenses[0] || null;
    }
    console.log('Back lenses:', backLenses.map(l => `${l.type} (${l.multiplier}) ${l.label}`));
}

function renderLensSegmented() {
    const container = document.getElementById('lensSegmented');
    if (!container) return;
    container.innerHTML = '';
    if (backLenses.length > 1 && currentFacingMode === 'environment') {
        backLenses.forEach((lens, idx) => {
            const btn = document.createElement('button');
            btn.className = 'lens-segment';
            btn.textContent = lens.multiplier;
            btn.dataset.lensIdx = idx;
            if (lens.deviceId === currentLens?.deviceId) {
                btn.classList.add('active');
            }
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                switchLens(idx);
            });
            container.appendChild(btn);
        });
        container.classList.remove('hidden');
    } else {
        container.classList.add('hidden');
    }
}

let cameraInitLock = false;

function switchLens(idx) {
    if (backLenses.length < 2 || currentFacingMode !== 'environment') return;
    const lens = backLenses[idx];
    if (!lens || lens.deviceId === currentLens?.deviceId) return;
    currentLens = lens;
    console.log('Switching to lens:', currentLens.multiplier);
    stopCamera();
    initCamera();
}

async function initCamera() {
    if (cameraInitLock) return;
    cameraInitLock = true;
    try {
    video = document.getElementById('video');
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    updateCanvasSize();
    if (videoDevices.length === 0) {
        await enumerateCameras();
    }
    try {
        const constraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        };
        if (currentLens && currentLens.deviceId && currentFacingMode === 'environment') {
            constraints.video.deviceId = { exact: currentLens.deviceId };
        } else {
            constraints.video.facingMode = currentFacingMode;
        }
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        await enumerateCameras();
        renderLensSegmented();
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            video.play();
            processFrame();
        };
        if (video.readyState >= 1) {
            video.onloadedmetadata();
        }
    } catch (err) {
        console.error('Camera access denied:', err);
        alert('Camera access required. Check permissions.');
    }
    } finally {
        cameraInitLock = false;
    }
}

function processFrame() {
    if (isFrozen) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.drawImage(video, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const ditherStart = performance.now();
    applyDithering(imageData, w, h);
    const ditherEnd = performance.now();
    const ditherTime = ditherEnd - ditherStart;
    if (ditherTime > 100) {
        console.warn('Slow dither:', ditherTime.toFixed(2) + 'ms', 'Palette:', currentPalette?.length, 'colors');
    }
    ctx.putImageData(imageData, 0, 0);
    frameCount++;
    const now = Date.now();
    // FPS counter commented out
    // if (now - lastFpsUpdate >= 1000) {
    //     const fps = frameCount;
    //     document.getElementById('fps').textContent = `FPS: ${fps}`;
    //     frameCount = 0;
    //     lastFpsUpdate = now;
    // }
    animationId = requestAnimationFrame(processFrame);
}

function stopCamera() {
    isFrozen = false;
    if (unfreezeTimer) {
        clearTimeout(unfreezeTimer);
        unfreezeTimer = null;
    }
    if (animationId) {
        cancelAnimationFrame(animationId);
    }
    if (video && video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
    }
}

async function flipCamera() {
    stopCamera();
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    if (currentFacingMode === 'environment') {
        currentLens = backLenses.find(l => l.type === 'wide') || backLenses[0] || null;
    } else {
        currentLens = null;
    }
    await initCamera();
}

function changeResolution(longEdge) {
    const wasRunning = animationId !== null;
    if (wasRunning) stopCamera();
    currentLongEdge = longEdge;
    updateCanvasSize();
    if (wasRunning) initCamera();
}

// ===== GESTURE HANDLING =====

function initGestures() {
    canvas = document.getElementById('canvas');
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);
}

function handleTouchStart(e) {
    e.preventDefault();
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchStartTime = performance.now();
    isTouching = true;
    gestureMode = null;
}

function handleTouchMove(e) {
    e.preventDefault();
    if (!isTouching || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartX;
    const deltaY = touchStartY - touch.clientY;
    if (!gestureMode) {
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);
        if (absY > GESTURE_THRESHOLD && absY > absX) {
            gestureMode = 'exposure';
            showExposureOverlay();
        } else if (absX > GESTURE_THRESHOLD && absX > absY) {
            gestureMode = 'temperature';
            showTempOverlay();
        }
    }
    if (gestureMode === 'exposure') {
        updateExposureFromGesture(deltaY);
    } else if (gestureMode === 'temperature') {
        updateTemperatureFromGesture(deltaX);
    }
}

function handleTouchEnd(e) {
    e.preventDefault();
    if (!gestureMode && (performance.now() - touchStartTime) < TAP_MAX_DURATION) {
        pickHueFromViewfinder(touchStartX, touchStartY);
    }
    isTouching = false;
    gestureMode = null;
    hideOverlays();
}

let mouseDown = false;
let mouseStartX = 0;
let mouseStartY = 0;
let mouseStartTime = 0;

function handleMouseDown(e) {
    mouseDown = true;
    mouseStartX = e.clientX;
    mouseStartY = e.clientY;
    mouseStartTime = performance.now();
    gestureMode = null;
}

function handleMouseMove(e) {
    if (!mouseDown) return;
    const deltaX = e.clientX - mouseStartX;
    const deltaY = mouseStartY - e.clientY;
    if (!gestureMode) {
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);
        if (absY > GESTURE_THRESHOLD && absY > absX) {
            gestureMode = 'exposure';
            showExposureOverlay();
        } else if (absX > GESTURE_THRESHOLD && absX > absY) {
            gestureMode = 'temperature';
            showTempOverlay();
        }
    }
    if (gestureMode === 'exposure') {
        updateExposureFromGesture(deltaY);
    } else if (gestureMode === 'temperature') {
        updateTemperatureFromGesture(deltaX);
    }
}

function handleMouseUp(e) {
    if (!gestureMode && (performance.now() - mouseStartTime) < TAP_MAX_DURATION) {
        pickHueFromViewfinder(mouseStartX, mouseStartY);
    }
    mouseDown = false;
    gestureMode = null;
    hideOverlays();
}

// ===== EXPOSURE CONTROL =====

const MAX_EXPOSURE_DELTA = 150;

function updateExposureFromGesture(deltaY) {
    const ev = (deltaY / MAX_EXPOSURE_DELTA) * 2;
    setExposureCompensation(ev);
    updateExposureUI();
}

function showExposureOverlay() {
    const overlay = document.getElementById('exposureOverlay');
    overlay.classList.remove('hidden');
    updateExposureUI();
}

function updateExposureUI() {
    const overlay = document.getElementById('exposureOverlay');
    const fill = overlay.querySelector('.exposure-fill');
    const value = overlay.querySelector('.exposure-value');
    const percentage = ((exposureCompensation + 2) / 4) * 100;
    fill.style.height = percentage + '%';
    const sign = exposureCompensation >= 0 ? '+' : '';
    value.textContent = `EV: ${sign}${exposureCompensation.toFixed(1)}`;
    if (exposureCompensation > 0) {
        fill.style.background = 'linear-gradient(to top, #ffaa00, #ffdd44)';
    } else if (exposureCompensation < 0) {
        fill.style.background = 'linear-gradient(to top, #0044aa, #4488cc)';
    } else {
        fill.style.background = '#888';
    }
}

// ===== TEMPERATURE CONTROL =====

const MAX_TEMP_DELTA = 200;

function updateTemperatureFromGesture(deltaX) {
    const temp = deltaX / MAX_TEMP_DELTA;
    updatePaletteTemperature(temp);
    updateTempUI();
}

function showTempOverlay() {
    const overlay = document.getElementById('tempOverlay');
    overlay.classList.remove('hidden');
    updateTempUI();
}

function updateTempUI() {
    const overlay = document.getElementById('tempOverlay');
    const fill = overlay.querySelector('.temp-fill');
    const value = overlay.querySelector('.temp-value');
    const percentage = ((currentTemperature + 1) / 2) * 100;
    fill.style.width = percentage + '%';
    const tempPercent = Math.round(currentTemperature * 100);
    const sign = tempPercent >= 0 ? '+' : '';
    value.textContent = `TEMP: ${sign}${tempPercent}%`;
    if (currentTemperature > 0) {
        fill.style.background = 'linear-gradient(to right, #888, #ff8844)';
    } else if (currentTemperature < 0) {
        fill.style.background = 'linear-gradient(to right, #4488ff, #888)';
    } else {
        fill.style.background = '#888';
    }
}

// ===== TAP-TO-PICK HUE =====

function pickHueFromViewfinder(screenX, screenY) {
    if (currentPaletteName !== 'VGA') return;
    const videoX = (screenX / window.innerWidth) * video.videoWidth;
    const videoY = (screenY / window.innerHeight) * video.videoHeight;
    const tmp = document.createElement('canvas');
    tmp.width = 1;
    tmp.height = 1;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(video, videoX - 2, videoY - 2, 5, 5, 0, 0, 1, 1);
    const px = tctx.getImageData(0, 0, 1, 1).data;
    const hue = rgbToHue(px[0], px[1], px[2]);
    if (hue < 0) return;
    setVGABaseHue(hue);
    showTapIndicator(screenX, screenY, px[0], px[1], px[2]);
}

function showTapIndicator(x, y, r, g, b) {
    const el = document.getElementById('tapIndicator');
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.borderColor = `rgb(${r},${g},${b})`;
    el.classList.remove('hidden', 'fade-out');
    el.offsetHeight;
    el.classList.add('fade-out');
    setTimeout(() => el.classList.add('hidden'), 500);
}

function hideOverlays() {
    document.getElementById('exposureOverlay').classList.add('hidden');
    document.getElementById('tempOverlay').classList.add('hidden');
}

// ===== DROP-UP MANAGEMENT =====

function closeAllDropups() {
    document.getElementById('resolutionDropup').classList.add('hidden');
    document.getElementById('paletteDropup').classList.add('hidden');
    document.getElementById('resolutionBtn').classList.remove('active');
    document.getElementById('paletteBtn').classList.remove('active');
}

function getResolutionLabel(longEdge) {
    const viewportAspect = window.innerWidth / window.innerHeight;
    const isPortrait = viewportAspect < 1;
    if (isPortrait) {
        const width = Math.round(longEdge * viewportAspect);
        return `${width}×${longEdge}`;
    } else {
        const height = Math.round(longEdge / viewportAspect);
        return `${longEdge}×${height}`;
    }
}

function updateResolutionLabels() {
    document.querySelectorAll('.resolution-option').forEach(btn => {
        const longEdge = parseInt(btn.dataset.res);
        btn.textContent = getResolutionLabel(longEdge);
    });
    document.getElementById('resolutionBtn').textContent = getResolutionLabel(currentLongEdge);
}

function toggleDropup(dropupId, btnId) {
    const dropup = document.getElementById(dropupId);
    const btn = document.getElementById(btnId);
    const isOpen = !dropup.classList.contains('hidden');
    closeAllDropups();
    if (!isOpen) {
        if (dropupId === 'resolutionDropup') {
            updateResolutionLabels();
        }
        dropup.classList.remove('hidden');
        btn.classList.add('active');
    }
}

document.getElementById('resolutionBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropup('resolutionDropup', 'resolutionBtn');
});

document.getElementById('paletteBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropup('paletteDropup', 'paletteBtn');
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropup') && !e.target.closest('.toolbar-btn')) {
        closeAllDropups();
    }
});

// ===== PALETTE SELECTION =====

document.querySelectorAll('.palette-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const paletteName = btn.dataset.palette;
        const newPalette = PALETTES[paletteName];
        if (!newPalette) {
            console.error('Palette not found:', paletteName);
            return;
        }
        document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('paletteBtn').textContent = btn.textContent;
        currentPaletteName = paletteName;
        updatePaletteTemperature(currentTemperature);
        closeAllDropups();
    });
});

// ===== RESOLUTION SELECTION =====

document.querySelectorAll('.resolution-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const longEdge = parseInt(btn.dataset.res);
        changeResolution(longEdge);
        document.getElementById('resolutionBtn').textContent = getResolutionLabel(longEdge);
        document.querySelectorAll('.resolution-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        closeAllDropups();
    });
});

document.querySelector('.resolution-option[data-res="640"]').classList.add('active');
document.querySelector('.palette-btn[data-palette="VGA"]').classList.add('active');

// Lens segmented control is rendered dynamically in renderLensSegmented()

document.getElementById('shutterBtn').addEventListener('click', () => {
    try {
        if (!canvas) {
            alert('Canvas not initialized. Start camera first.');
            return;
        }

        // Freeze the display — canvas already holds the last dithered frame
        isFrozen = true;
        if (unfreezeTimer) clearTimeout(unfreezeTimer);
        unfreezeTimer = setTimeout(() => {
            isFrozen = false;
            unfreezeTimer = null;
            animationId = requestAnimationFrame(processFrame);
        }, FREEZE_DURATION);

        const dataUrl = canvas.toDataURL('image/png');
        const timestamp = Date.now();
        saveToGallery(dataUrl, timestamp);
        const btn = document.getElementById('shutterBtn');
        btn.style.opacity = '0.5';
        setTimeout(() => btn.style.opacity = '1', 100);
    } catch (err) {
        console.error('Snapshot failed:', err);
        alert('Snapshot failed: ' + err.message);
    }
});

// ===== GALLERY =====

function getGallery() {
    try {
        return JSON.parse(localStorage.getItem(GALLERY_KEY)) || [];
    } catch {
        return [];
    }
}

function saveToGallery(dataUrl, timestamp) {
    const gallery = getGallery();
    gallery.unshift({ id: timestamp, dataUrl });
    if (gallery.length > 50) gallery.pop();
    try {
        localStorage.setItem(GALLERY_KEY, JSON.stringify(gallery));
    } catch (e) {
        console.warn('Gallery storage full, removing oldest');
        gallery.pop();
        localStorage.setItem(GALLERY_KEY, JSON.stringify(gallery));
    }
}

function deleteFromGallery(id) {
    const gallery = getGallery().filter(item => item.id !== id);
    localStorage.setItem(GALLERY_KEY, JSON.stringify(gallery));
    renderGallery();
}

function renderGallery() {
    const gallery = getGallery();
    const grid = document.getElementById('galleryGrid');
    const empty = document.getElementById('galleryEmpty');
    grid.innerHTML = '';
    if (gallery.length === 0) {
        empty.style.display = 'block';
        grid.style.display = 'none';
        return;
    }
    empty.style.display = 'none';
    grid.style.display = 'grid';
    gallery.forEach(item => {
        const thumb = document.createElement('div');
        thumb.className = 'gallery-thumb';
        thumb.innerHTML = `<img src="${item.dataUrl}" alt="snapshot">`;
        thumb.addEventListener('click', () => {
            openPreview(item.dataUrl, item.id);
        });
        let pressTimer;
        thumb.addEventListener('touchstart', (e) => {
            pressTimer = setTimeout(() => {
                if (confirm('Delete this snapshot?')) {
                    deleteFromGallery(item.id);
                }
            }, 500);
        });
        thumb.addEventListener('touchend', () => clearTimeout(pressTimer));
        thumb.addEventListener('touchmove', () => clearTimeout(pressTimer));
        grid.appendChild(thumb);
    });
}

// ===== PREVIEW =====

function openPreview(dataUrl, id) {
    currentPreviewData = { dataUrl, id };
    document.getElementById('previewImage').src = dataUrl;
    document.getElementById('previewOverlay').classList.remove('hidden');
}

function closePreview() {
    document.getElementById('previewOverlay').classList.add('hidden');
    document.getElementById('scaleDropup').classList.add('hidden');
    currentPreviewData = null;
}

async function shareImage() {
    if (!currentPreviewData) return;
    const response = await fetch(currentPreviewData.dataUrl);
    const blob = await response.blob();
    const file = new File([blob], `dither-${currentPreviewData.id}.png`, { type: 'image/png' });
    if (navigator.share && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({
                files: [file],
                title: 'di_ther snapshot'
            });
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Share failed:', err);
            }
        }
    } else {
        alert('Sharing not supported on this device. Use Save instead.');
    }
}

function saveImage() {
    if (!currentPreviewData) return;
    const scale = currentSaveScale;
    if (scale === 1) {
        downloadDataUrl(currentPreviewData.dataUrl, currentPreviewData.id);
    } else {
        const img = new Image();
        img.onload = () => {
            const scaledCanvas = document.createElement('canvas');
            scaledCanvas.width = img.width * scale;
            scaledCanvas.height = img.height * scale;
            const sctx = scaledCanvas.getContext('2d');
            sctx.imageSmoothingEnabled = false;
            sctx.drawImage(img, 0, 0, scaledCanvas.width, scaledCanvas.height);
            const scaledUrl = scaledCanvas.toDataURL('image/png');
            downloadDataUrl(scaledUrl, currentPreviewData.id, scale);
        };
        img.src = currentPreviewData.dataUrl;
    }
}

function downloadDataUrl(dataUrl, id, scale = 1) {
    const suffix = scale > 1 ? `-${scale}x` : '';
    const link = document.createElement('a');
    link.download = `dither-${id}${suffix}.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function toggleScaleDropup() {
    document.getElementById('scaleDropup').classList.toggle('hidden');
}

function setScale(scale) {
    currentSaveScale = scale;
    document.querySelectorAll('.scale-option').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.scale) === scale);
    });
    document.getElementById('scaleDropup').classList.add('hidden');
}

document.getElementById('previewClose').addEventListener('click', closePreview);
document.getElementById('shareBtn').addEventListener('click', shareImage);
document.getElementById('saveBtn').addEventListener('click', saveImage);
document.getElementById('scaleToggle').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleScaleDropup();
});

document.querySelectorAll('.scale-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setScale(parseInt(btn.dataset.scale));
    });
});

document.getElementById('previewOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'previewOverlay' || e.target.classList.contains('preview-image-container')) {
        closePreview();
    }
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.save-combo')) {
        document.getElementById('scaleDropup').classList.add('hidden');
    }
});

function openGallery() {
    renderGallery();
    document.getElementById('galleryOverlay').classList.remove('hidden');
}

function closeGallery() {
    document.getElementById('galleryOverlay').classList.add('hidden');
}

const galleryBtn = document.getElementById('galleryBtn');
if (galleryBtn) galleryBtn.addEventListener('click', openGallery);
document.getElementById('galleryClose').addEventListener('click', closeGallery);

document.getElementById('galleryOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'galleryOverlay') closeGallery();
});

window.addEventListener('DOMContentLoaded', () => {
    initCamera();
    initGestures();
    updateResolutionLabels();
});

window.addEventListener('resize', () => {
    updateCanvasDisplaySize();
    updateResolutionLabels();
});
