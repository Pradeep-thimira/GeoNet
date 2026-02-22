// --- Global Variables ---
let map;
let currentBaseLayer = null;
let analysisLayer = null; 
let currentGeoJSON = null; // Store current analysis data
let currentMaxClassId = 0; // Store the max class ID for color scaling

// UPDATE: Changed to relative path for seamless local and production usage
const API_URL = "/analyze";
const DOWNLOAD_URL = "/download";

const ramps = {
    'blue': ['#eff6ff', '#bfdbfe', '#60a5fa', '#2563eb', '#1e3a8a'],
    'red': ['#fef2f2', '#fecaca', '#f87171', '#dc2626', '#991b1b'],
    'green': ['#f0fdf4', '#bbf7d0', '#4ade80', '#16a34a', '#14532d'],
    'viridis': ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
    'magma': ['#000004', '#51127c', '#b73779', '#fc8961', '#fcfdbf'],
    'plasma': ['#0d0887', '#6a00a8', '#b12a90', '#e16462', '#f0f921'],
    'inferno': ['#000004', '#420a68', '#932667', '#dd513a', '#fcffa4'],
    'turbo': ['#30123b', '#4686fa', '#18d551', '#d2e935', '#cb3d0b']
};

const tileLayers = {
    positron: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        maxZoom: 20
    }),
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        maxZoom: 20
    }),
    terrain: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri'
    })
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
        attributionControl: true
    });
    currentBaseLayer = tileLayers.positron;
    currentBaseLayer.addTo(map);

    L.control.scale({
        position: 'bottomleft',
        maxWidth: 150,
        metric: true,
        imperial: false 
    }).addTo(map);
    map.attributionControl.setPosition('bottomright');
    map.on('mousemove', (e) => {
        document.getElementById('lat').innerText = e.latlng.lat.toFixed(4);
        document.getElementById('lon').innerText = e.latlng.lng.toFixed(4);
    });
}

// --- Logic: Run Analysis ---
async function runAnalysis() {
    const fileInput = document.querySelector('input[type="file"]');
    const analysisType = document.getElementById('analysis-type').value;
    
    let classCount = parseInt(document.getElementById('class-count').value);
    if (isNaN(classCount) || classCount < 1) classCount = 5;
    
    const metric = document.getElementById('param-metric').value;
    let radius = document.getElementById('param-radius-select').value;
    if (radius === 'custom') {
        radius = document.getElementById('param-radius-input').value;
    }

    let classifyMethod = 'Natural Breaks (Jenks)';
    const radios = document.getElementsByName('classify');
    if(radios[1].checked) classifyMethod = 'Equal Count (Quantile)';
    if(radios[2].checked) classifyMethod = 'Equal Interval';

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
        const response = await fetch(API_URL, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Analysis failed');
        }

        const geoData = await response.json();
        
        currentGeoJSON = geoData;
        
        currentMaxClassId = 0;
        if(geoData.features) {
            geoData.features.forEach(f => {
                const cid = f.properties.class_id || 0;
                if(cid > currentMaxClassId) currentMaxClassId = cid;
            });
        }
        
        console.log(`Analysis complete. Max Class ID: ${currentMaxClassId}, Requested: ${classCount}`);

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

// --- Download Shapefile Logic ---
function setDownloadButtonState(enabled) {
    const btn = document.getElementById('btn-download');
    if (!btn) return;
    if (enabled) {
        btn.disabled = false;
        // Apply smaller blue gradient classes when enabled
        btn.className = 'w-full bg-gradient-to-r from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800 text-white font-medium py-1.5 px-3 text-xs rounded shadow-md flex items-center justify-center space-x-2 transition-all cursor-pointer active:scale-95';
    } else {
        btn.disabled = true;
        // Revert to disabled grey state classes
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
            body: JSON.stringify(currentGeoJSON)
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

// --- Helper Functions ---
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
        onEachFeature: function(feature, layer) {
            const val = feature.properties.value ? feature.properties.value.toFixed(4) : 'N/A';
            layer.bindPopup(`<strong>Value:</strong> ${val}<br><strong>Class:</strong> ${feature.properties.class_id}`);
        }
    }).addTo(map);

    updateLayerStyle(); 
    map.fitBounds(analysisLayer.getBounds());
    
    document.getElementById('layer-visible-toggle').checked = true;
    const layerContent = document.getElementById('layer-content');
    if (layerContent.style.maxHeight === '0px' || layerContent.style.maxHeight === '') {
        toggleLayerPanel();
    }
}

function updateLayerStyle() {
    if (!analysisLayer) return;

    const rampName = document.getElementById('ramp-select').value;
    const isInverted = document.getElementById('invert-ramp').checked;
    const opacityVal = document.getElementById('opacity-slider').value / 100;
    const widthVal = document.getElementById('width-slider').value;

    let steps = currentMaxClassId + 1;
    let colors = getInterpolatedColors(rampName, steps);
    
    if (isInverted) colors = colors.reverse();

    analysisLayer.setStyle(feature => {
        const classId = feature.properties.class_id || 0;
        const color = colors[Math.min(classId, colors.length - 1)] || '#333';
        return {
            color: color,
            weight: parseFloat(widthVal),
            opacity: parseFloat(opacityVal)
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
    
    let colors = ramps[select.value];
    if (invert) colors = [...colors].reverse();
    
    const gradient = `linear-gradient(to right, ${colors.join(', ')})`;
    if(preview) preview.style.backgroundImage = gradient;
    if(outputPreview) outputPreview.style.backgroundImage = gradient;
}

function resetMap() {
    if (analysisLayer) {
        map.removeLayer(analysisLayer);
        analysisLayer = null;
    }
    currentGeoJSON = null;
    currentMaxClassId = 0;
    
    // Disable download button
    setDownloadButtonState(false);

    // Hide layer panel
    const layerContent = document.getElementById('layer-content');
    if (layerContent.style.maxHeight !== '0px') {
        toggleLayerPanel();
    }

    // --- Reset file input UI so it looks like it did on fresh reload ---
    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput) fileInput.value = ''; // clears out the selected file
    document.getElementById('upload-placeholder').classList.remove('hidden');
    document.getElementById('upload-success').classList.add('hidden');
    document.getElementById('filename-display').innerText = '';

    showToast("Map layers and data cleared", false);
    setTimeout(hideToast, 2000);
}

function getInterpolatedColors(rampKey, steps) {
    const baseColors = ramps[rampKey];
    if (steps < 2) return [baseColors[0]];
    
    let result = [];
    for (let i = 0; i < steps; i++) {
        const t = i / (Math.max(steps, 2) - 1);
        const index = Math.round(t * (baseColors.length - 1));
        result.push(baseColors[index]);
    }
    return result; 
}

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    const content = document.getElementById('toast-content');
    const icon = document.getElementById('toast-icon');
    const msg = document.getElementById('toast-message');

    if (isError) {
        content.classList.remove('bg-blue-600');
        content.classList.add('bg-red-600');
        icon.className = 'fas fa-exclamation-circle'; 
    } else {
        content.classList.remove('bg-red-600');
        content.classList.add('bg-blue-600');
        icon.className = 'fas fa-sync fa-spin'; 
        if (message.includes('cleared') || message.includes('completed')) icon.className = 'fas fa-check';
    }
    msg.innerText = message;
    toast.classList.remove('opacity-0', 'translate-y-[20px]');
}

function hideToast() {
    document.getElementById('toast').classList.add('opacity-0', 'translate-y-[20px]');
}

// UI Toggles & Animations
const themeBtn = document.getElementById('theme-toggle');
const html = document.documentElement;

themeBtn.addEventListener('click', (e) => {
    const isDark = html.classList.contains('dark');
    const overlay = document.getElementById('theme-reveal-overlay');
    
    // Get button center coordinates
    const rect = themeBtn.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const maxDim = Math.max(window.innerWidth, window.innerHeight);
    const scaleAmount = (maxDim * 2.5) / 10; 
    
    overlay.style.left = `${x}px`;
    overlay.style.top = `${y}px`;

    if (!isDark) {
        // Light to Dark (Expand)
        overlay.style.backgroundColor = '#0f172a'; // slate-900
        overlay.style.transition = 'none';
        overlay.style.transform = 'translate(-50%, -50%) scale(0)';
        overlay.style.opacity = '1';

        html.classList.add('dark');
        changeBaseMap('dark', true);

        void overlay.offsetWidth; // Force reflow

        overlay.style.transition = 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease-out 0.3s';
        overlay.style.transform = `translate(-50%, -50%) scale(${scaleAmount})`;
        overlay.style.opacity = '0';

        setTimeout(() => {
            overlay.style.transition = 'none';
            overlay.style.transform = 'translate(-50%, -50%) scale(0)';
        }, 800);
    } else {
        // Dark to Light (Reverse Circulation / Shrink)
        overlay.style.backgroundColor = '#0f172a'; // Start full dark
        overlay.style.transition = 'none';
        overlay.style.transform = `translate(-50%, -50%) scale(${scaleAmount})`;
        overlay.style.opacity = '1';

        html.classList.remove('dark');
        changeBaseMap('positron', true);

        void overlay.offsetWidth; // Force reflow

        overlay.style.transition = 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
        overlay.style.transform = 'translate(-50%, -50%) scale(0)';
    }
});

function changeBaseMap(type, instant = false) {
    const buttons = {
        'terrain': document.getElementById('btn-terrain'),
        'positron': document.getElementById('btn-positron'),
        'dark': document.getElementById('btn-dark')
    };

    // Update Button Highlight State
    Object.values(buttons).forEach(btn => {
        btn.classList.remove('bg-blue-100', 'dark:bg-blue-900/50', 'text-blue-600');
        btn.querySelector('i').classList.remove('text-blue-600', 'dark:text-blue-400');
        btn.querySelector('i').classList.add('text-slate-600', 'dark:text-slate-300');
    });
    
    const activeBtn = buttons[type];
    if(activeBtn) {
        activeBtn.classList.add('bg-blue-100', 'dark:bg-blue-900/50');
        const icon = activeBtn.querySelector('i');
        icon.classList.remove('text-slate-600', 'dark:text-slate-300');
        icon.classList.add('text-blue-600', 'dark:text-blue-400');
    }
    
    // --- Cool Transition Animation for Map ---
    const mapContainer = document.getElementById('map-container');
    
    const applyChanges = () => {
        if (currentBaseLayer) map.removeLayer(currentBaseLayer);
        currentBaseLayer = tileLayers[type];
        currentBaseLayer.addTo(map);

        // Ensure Analysis layer stays on top when background layer swaps
        if (analysisLayer) {
            analysisLayer.bringToFront();
        }

        // Apply dark/light globally to the HTML document correctly
        if (type === 'dark') {
            html.classList.add('dark');
        } else {
            html.classList.remove('dark');
        }

        // Fade Map back in
        mapContainer.style.opacity = '1';
        mapContainer.style.filter = 'blur(0px)';
    };

    if (instant) {
        // Bypass map fading duration if doing full-screen circular reveal
        applyChanges();
    } else {
        // Standard Map swapping blur/fade
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
    if (content.style.maxHeight === '0px' || content.style.maxHeight === '') {
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