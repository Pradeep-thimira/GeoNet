// --- Global Variables ---
let map;
let currentBaseLayer = null;
let analysisLayer = null;
let currentGeoJSON = null;
let currentMaxClassId = 0;
// FIX: Track user's theme preference independently of basemap choice
let userPrefersDark = false;

const API_URL = "/analyze";
const DOWNLOAD_URL = "/download";

const ramps = {
    'blue':    ['#eff6ff', '#bfdbfe', '#60a5fa', '#2563eb', '#1e3a8a'],
    'red':     ['#fef2f2', '#fecaca', '#f87171', '#dc2626', '#991b1b'],
    'green':   ['#f0fdf4', '#bbf7d0', '#4ade80', '#16a34a', '#14532d'],
    'viridis': ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
    'magma':   ['#000004', '#51127c', '#b73779', '#fc8961', '#fcfdbf'],
    'plasma':  ['#0d0887', '#6a00a8', '#b12a90', '#e16462', '#f0f921'],
    'inferno': ['#000004', '#420a68', '#932667', '#dd513a', '#fcffa4'],
    'turbo':   ['#30123b', '#4686fa', '#18d551', '#d2e935', '#cb3d0b'],
};

const tileLayers = {
    positron: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 20,
    }),
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 20,
    }),
    terrain: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri',
    }),
};

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    updateRampPreview();
    handleAnalysisTypeChange();
});

function initMap() {
    map = L.map('map-container', {
        center: [6.9271, 79.8612],
        zoom: 12,
        zoomControl: false,
        attributionControl: true,
    });
    currentBaseLayer = tileLayers.positron;
    currentBaseLayer.addTo(map);

    L.control.scale({ position: 'bottomleft', maxWidth: 150, metric: true, imperial: false }).addTo(map);
    map.attributionControl.setPosition('bottomright');
    map.on('mousemove', (e) => {
        document.getElementById('lat').innerText = e.latlng.lat.toFixed(4);
        document.getElementById('lon').innerText = e.latlng.lng.toFixed(4);
    });
}

// --- Run Analysis ---
async function runAnalysis() {
    const fileInput = document.querySelector('input[type="file"]');
    const analysisType = document.getElementById('analysis-type').value;

    let classCount = parseInt(document.getElementById('class-count').value);
    if (isNaN(classCount) || classCount < 1) classCount = 5;

    const metric = document.getElementById('param-metric').value;
    let radius = document.getElementById('param-radius-select').value;
    if (radius === 'custom') {
        radius = document.getElementById('param-radius-input').value || 'n';
    }

    // FIX: Read classification method using the value attribute instead of
    // brittle positional index — each radio now has an explicit value.
    const checkedRadio = document.querySelector('input[name="classify"]:checked');
    const classifyMethod = checkedRadio ? checkedRadio.value : 'Natural Breaks (Jenks)';

    if (!fileInput.files[0]) {
        showToast("Please upload a .zip file first.", true);
        setTimeout(hideToast, 3000);
        return;
    }

    showToast(`Running Analysis (${classCount} classes)...`, false);

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('analysis_type', analysisType);
    formData.append('classification_method', classifyMethod);
    formData.append('class_count', classCount);
    formData.append('metric', metric);
    formData.append('radius', radius || 'n');

    try {
        const response = await fetch(API_URL, { method: 'POST', body: formData });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Analysis failed');
        }

        const geoData = await response.json();
        currentGeoJSON = geoData;

        currentMaxClassId = 0;
        if (geoData.features) {
            geoData.features.forEach(f => {
                const cid = f.properties.class_id || 0;
                if (cid > currentMaxClassId) currentMaxClassId = cid;
            });
        }

        renderGeoJSON();
        setDownloadButtonState(true);

        const actualClasses = currentMaxClassId + 1;
        if (actualClasses < classCount) {
            showToast(`Warning: Data only supports ${actualClasses} classes (requested ${classCount}).`, true);
            setTimeout(hideToast, 5000);
        } else {
            hideToast();
        }

    } catch (error) {
        console.error(error);
        showToast("Error: " + error.message, true);
        setTimeout(hideToast, 5000);
    }
}

// --- Download Shapefile ---
function setDownloadButtonState(enabled) {
    const btn = document.getElementById('btn-download');
    if (!btn) return;
    if (enabled) {
        btn.disabled = false;
        btn.className = 'w-full bg-gradient-to-r from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800 text-white font-medium py-1.5 px-3 text-xs rounded shadow-md flex items-center justify-center space-x-2 transition-all cursor-pointer active:scale-95';
    } else {
        btn.disabled = true;
        btn.className = 'w-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500 font-medium py-1.5 px-3 text-xs rounded flex items-center justify-center space-x-2 transition-all cursor-not-allowed';
    }
}

async function downloadShapefile() {
    if (!currentGeoJSON) return;
    const btn = document.getElementById('btn-download');
    const originalHtml = btn.innerHTML;

    try {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin text-xs"></i><span>Preparing...</span>';
        btn.classList.add('opacity-80', 'cursor-wait');

        const response = await fetch(DOWNLOAD_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentGeoJSON),
        });

        if (!response.ok) throw new Error("Download failed");

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = 'geonet_output.zip';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        showToast("Download completed!", false);
        setTimeout(hideToast, 2000);
    } catch (e) {
        console.error(e);
        showToast("Error preparing download", true);
        setTimeout(hideToast, 3000);
    } finally {
        btn.innerHTML = originalHtml;
        btn.classList.remove('opacity-80', 'cursor-wait');
    }
}

// --- Helpers ---
function toggleCustomRadius() {
    const select = document.getElementById('param-radius-select');
    const input = document.getElementById('param-radius-input');
    if (select.value === 'custom') {
        input.classList.remove('hidden');
        input.focus();
    } else {
        input.classList.add('hidden');
    }
}

function handleAnalysisTypeChange() {
    const type = document.getElementById('analysis-type').value;
    const params = document.getElementById('centrality-params');
    if (type === 'connectivity') params.classList.add('hidden');
    else params.classList.remove('hidden');
}

function renderGeoJSON() {
    if (analysisLayer) map.removeLayer(analysisLayer);
    if (!currentGeoJSON) return;

    analysisLayer = L.geoJSON(currentGeoJSON, {
        onEachFeature: function (feature, layer) {
            const val = feature.properties.value != null
                ? feature.properties.value.toFixed(4)
                : 'N/A';
            layer.bindPopup(`<strong>Value:</strong> ${val}<br><strong>Class:</strong> ${feature.properties.class_id}`);
        },
    }).addTo(map);

    updateLayerStyle();
    map.fitBounds(analysisLayer.getBounds());

    document.getElementById('layer-visible-toggle').checked = true;
    const layerContent = document.getElementById('layer-content');
    if (parseInt(layerContent.style.maxHeight || '0') === 0) {
        toggleLayerPanel();
    }
}

function updateLayerStyle() {
    if (!analysisLayer) return;

    const rampName = document.getElementById('ramp-select').value;
    const isInverted = document.getElementById('invert-ramp').checked;
    const opacityVal = document.getElementById('opacity-slider').value / 100;
    const widthVal = document.getElementById('width-slider').value;

    const steps = currentMaxClassId + 1;
    let colors = getInterpolatedColors(rampName, steps);
    if (isInverted) colors = colors.reverse();

    analysisLayer.setStyle(feature => {
        const classId = feature.properties.class_id || 0;
        const color = colors[Math.min(classId, colors.length - 1)] || '#333';
        return {
            color: color,
            weight: parseFloat(widthVal),
            opacity: parseFloat(opacityVal),
        };
    });

    document.getElementById('opacity-value').innerText = Math.round(opacityVal * 100) + '%';
    document.getElementById('width-value').innerText = widthVal + 'px';
}

function toggleLayerVisibility() {
    const isVisible = document.getElementById('layer-visible-toggle').checked;
    if (analysisLayer) {
        if (isVisible) analysisLayer.addTo(map);
        else map.removeLayer(analysisLayer);
    }
}

function updateRamp() {
    updateRampPreview();
    updateLayerStyle();
}

function updateRampPreview() {
    const select = document.getElementById('ramp-select');
    const invert = document.getElementById('invert-ramp').checked;
    const preview = document.getElementById('color-ramp-preview');
    const outputPreview = document.getElementById('layer-output-ramp-preview');

    let colors = [...ramps[select.value]];
    if (invert) colors = colors.reverse();

    const gradient = `linear-gradient(to right, ${colors.join(', ')})`;
    if (preview) preview.style.backgroundImage = gradient;
    if (outputPreview) outputPreview.style.backgroundImage = gradient;
}

function resetMap() {
    if (analysisLayer) {
        map.removeLayer(analysisLayer);
        analysisLayer = null;
    }
    currentGeoJSON = null;
    currentMaxClassId = 0;

    setDownloadButtonState(false);

    // FIX: Use parseInt comparison instead of strict string equality so it works
    // on first load when maxHeight is '' as well as when it is '0px'.
    const layerContent = document.getElementById('layer-content');
    if (parseInt(layerContent.style.maxHeight || '0') > 0) {
        toggleLayerPanel();
    }

    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput) fileInput.value = '';
    document.getElementById('upload-placeholder').classList.remove('hidden');
    document.getElementById('upload-success').classList.add('hidden');
    document.getElementById('filename-display').innerText = '';

    showToast("Map layers and data cleared", false);
    setTimeout(hideToast, 2000);
}

// FIX: Proper linear interpolation between hex colour stops instead of
// Math.round() snapping, so 10 classes from a 5-stop ramp get smooth colours
// rather than repeated stops.
function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function getInterpolatedColors(rampKey, steps) {
    const base = ramps[rampKey];
    if (steps <= 1) return [base[0]];

    const result = [];
    for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);                        // 0 → 1
        const scaledPos = t * (base.length - 1);
        const lo = Math.floor(scaledPos);
        const hi = Math.min(lo + 1, base.length - 1);
        const frac = scaledPos - lo;

        const [r0, g0, b0] = hexToRgb(base[lo]);
        const [r1, g1, b1] = hexToRgb(base[hi]);

        result.push(rgbToHex(
            r0 + (r1 - r0) * frac,
            g0 + (g1 - g0) * frac,
            b0 + (b1 - b0) * frac,
        ));
    }
    return result;
}

function showToast(message, isError = false) {
    const toast   = document.getElementById('toast');
    const content = document.getElementById('toast-content');
    const icon    = document.getElementById('toast-icon');
    const msg     = document.getElementById('toast-message');

    // FIX: Always reset classes before setting new state so fa-spin doesn't
    // linger after the analysis completes.
    icon.className = '';

    if (isError) {
        content.classList.remove('bg-blue-600');
        content.classList.add('bg-red-600');
        icon.className = 'fas fa-exclamation-circle';
    } else {
        content.classList.remove('bg-red-600');
        content.classList.add('bg-blue-600');
        if (message.includes('cleared') || message.includes('completed')) {
            icon.className = 'fas fa-check';
        } else {
            icon.className = 'fas fa-sync fa-spin';
        }
    }

    msg.innerText = message;
    toast.classList.remove('opacity-0', 'translate-y-[20px]');
}

function hideToast() {
    // FIX: Also reset the spinner icon when the toast is hidden so the next
    // call to showToast always starts from a clean state.
    document.getElementById('toast-icon').className = '';
    document.getElementById('toast').classList.add('opacity-0', 'translate-y-[20px]');
}

// --- Theme toggle ---
const themeBtn = document.getElementById('theme-toggle');
const html = document.documentElement;

themeBtn.addEventListener('click', () => {
    // FIX: Track user preference separately so basemap changes don't override it.
    userPrefersDark = !userPrefersDark;
    applyTheme(userPrefersDark, true);
});

function applyTheme(dark, animate = false) {
    if (animate) {
        const overlay = document.getElementById('theme-reveal-overlay');
        const rect = themeBtn.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const scaleAmount = (Math.max(window.innerWidth, window.innerHeight) * 2.5) / 10;

        overlay.style.left = `${x}px`;
        overlay.style.top  = `${y}px`;

        if (dark) {
            overlay.style.backgroundColor = '#0f172a';
            overlay.style.transition = 'none';
            overlay.style.transform = 'translate(-50%, -50%) scale(0)';
            overlay.style.opacity = '1';
            html.classList.add('dark');
            void overlay.offsetWidth;
            overlay.style.transition = 'transform 0.6s cubic-bezier(0.4,0,0.2,1), opacity 0.4s ease-out 0.3s';
            overlay.style.transform = `translate(-50%, -50%) scale(${scaleAmount})`;
            overlay.style.opacity = '0';
            setTimeout(() => {
                overlay.style.transition = 'none';
                overlay.style.transform = 'translate(-50%, -50%) scale(0)';
            }, 800);
        } else {
            overlay.style.backgroundColor = '#0f172a';
            overlay.style.transition = 'none';
            overlay.style.transform = `translate(-50%, -50%) scale(${scaleAmount})`;
            overlay.style.opacity = '1';
            html.classList.remove('dark');
            void overlay.offsetWidth;
            overlay.style.transition = 'transform 0.6s cubic-bezier(0.4,0,0.2,1)';
            overlay.style.transform = 'translate(-50%, -50%) scale(0)';
        }
    } else {
        if (dark) html.classList.add('dark');
        else html.classList.remove('dark');
    }
}

// --- Basemap switcher ---
// FIX: changeBaseMap no longer touches html.classList (theme) — basemap and
// UI theme are now independent. Only the map tile layer is swapped.
function changeBaseMap(type, instant = false) {
    const buttons = {
        terrain:  document.getElementById('btn-terrain'),
        positron: document.getElementById('btn-positron'),
        dark:     document.getElementById('btn-dark'),
    };

    Object.values(buttons).forEach(btn => {
        btn.classList.remove('bg-blue-100', 'dark:bg-blue-900/50');
        const ico = btn.querySelector('i');
        ico.classList.remove('text-blue-600', 'dark:text-blue-400');
        ico.classList.add('text-slate-600', 'dark:text-slate-300');
    });

    const activeBtn = buttons[type];
    if (activeBtn) {
        activeBtn.classList.add('bg-blue-100', 'dark:bg-blue-900/50');
        const ico = activeBtn.querySelector('i');
        ico.classList.remove('text-slate-600', 'dark:text-slate-300');
        ico.classList.add('text-blue-600', 'dark:text-blue-400');
    }

    const mapContainer = document.getElementById('map-container');

    const applyChanges = () => {
        if (currentBaseLayer) map.removeLayer(currentBaseLayer);
        currentBaseLayer = tileLayers[type];
        currentBaseLayer.addTo(map);
        if (analysisLayer) analysisLayer.bringToFront();
        mapContainer.style.opacity = '1';
        mapContainer.style.filter = 'blur(0px)';
    };

    if (instant) {
        applyChanges();
    } else {
        mapContainer.style.opacity = '0.3';
        mapContainer.style.filter = 'blur(4px)';
        setTimeout(applyChanges, 250);
    }
}

function handleFileUpload(input) {
    if (input.files && input.files[0]) {
        document.getElementById('upload-placeholder').classList.add('hidden');
        document.getElementById('upload-success').classList.remove('hidden');
        document.getElementById('filename-display').innerText = input.files[0].name;
    }
}

function toggleLayerPanel() {
    const content = document.getElementById('layer-content');
    const chevron = document.getElementById('layer-chevron');
    // FIX: Use parseInt so the comparison works whether maxHeight is '' or '0px'
    if (parseInt(content.style.maxHeight || '0') === 0) {
        content.style.maxHeight = '500px';
        content.style.opacity = '1';
        content.style.marginTop = '0';
        chevron.style.transform = 'rotate(0deg)';
    } else {
        content.style.maxHeight = '0px';
        content.style.opacity = '0';
        content.style.marginTop = '-5px';
        chevron.style.transform = 'rotate(180deg)';
    }
}

function toggleInputPanel() {
    const panel = document.getElementById('input-panel');
    const openBtn = document.getElementById('open-input-btn');
    if (panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        openBtn.classList.add('hidden');
        setTimeout(() => {
            panel.classList.remove('opacity-0', 'scale-90', 'translate-x-[-20px]');
        }, 10);
    } else {
        panel.classList.add('opacity-0', 'scale-90', 'translate-x-[-20px]');
        setTimeout(() => {
            panel.classList.add('hidden');
            openBtn.classList.remove('hidden');
        }, 300);
    }
}