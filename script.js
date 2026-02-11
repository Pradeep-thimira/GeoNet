// --- Global Variables ---
let map;
let currentBaseLayer = null;
let analysisLayer = null; 
let currentGeoJSON = null; // Store current analysis data
let currentMaxClassId = 0; // Store the max class ID for color scaling

// Configuration: Change this if deploying to a remote server
const API_URL = "http://localhost:8000/analyze";

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
    
    // CRITICAL FIX: Get value by ID, parse as Int. 
    // Defaults to 5 if empty/invalid to prevent backend errors.
    let classCount = parseInt(document.getElementById('class-count').value);
    if (isNaN(classCount) || classCount < 1) classCount = 5;
    
    // Params
    const metric = document.getElementById('param-metric').value;
    let radius = document.getElementById('param-radius-select').value;
    if (radius === 'custom') {
        radius = document.getElementById('param-radius-input').value;
    }

    // Classification
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
    // Append new params
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
        
        // Save state
        currentGeoJSON = geoData;
        
        // Calculate max class ID present in data for accurate coloring
        currentMaxClassId = 0;
        if(geoData.features) {
            geoData.features.forEach(f => {
                const cid = f.properties.class_id || 0;
                if(cid > currentMaxClassId) currentMaxClassId = cid;
            });
        }
        
        // Debug log
        console.log(`Analysis complete. Max Class ID: ${currentMaxClassId}, Requested: ${classCount}`);

        renderGeoJSON();

        // Check if the actual number of classes matches the requested amount
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

    // Create layer (style will be set dynamically)
    analysisLayer = L.geoJSON(currentGeoJSON, {
        onEachFeature: function(feature, layer) {
            const val = feature.properties.value ? feature.properties.value.toFixed(4) : 'N/A';
            layer.bindPopup(`<strong>Value:</strong> ${val}<br><strong>Class:</strong> ${feature.properties.class_id}`);
        }
    }).addTo(map);

    updateLayerStyle(); // Apply initial style
    map.fitBounds(analysisLayer.getBounds());
    
    // UI Updates
    document.getElementById('layer-visible-toggle').checked = true;
    const layerContent = document.getElementById('layer-content');
    if (layerContent.style.maxHeight === '0px' || layerContent.style.maxHeight === '') {
        toggleLayerPanel();
    }
}

/**
 * Updates the style of the existing layer based on current UI settings.
 * Does NOT require re-running the analysis.
 */
function updateLayerStyle() {
    if (!analysisLayer) return;

    const rampName = document.getElementById('ramp-select').value;
    const isInverted = document.getElementById('invert-ramp').checked;
    const opacityVal = document.getElementById('opacity-slider').value / 100;
    const widthVal = document.getElementById('width-slider').value;

    // Use currentMaxClassId + 1 as step count so colors span the full range
    // If the backend returns 10 classes (ids 0-9), currentMaxClassId is 9. steps = 10.
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

    // Update UI labels
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
    updateLayerStyle(); // Live update the map
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

    // Hide layer panel
    const layerContent = document.getElementById('layer-content');
    if (layerContent.style.maxHeight !== '0px') {
        toggleLayerPanel();
    }

    // Reset inputs if desired, or just clear the visualization
    showToast("Map layers cleared", false);
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
        // Remove spin if it's just a notification (like cleared)
        if (message.includes('cleared')) icon.className = 'fas fa-check';
    }
    msg.innerText = message;
    toast.classList.remove('opacity-0', 'translate-y-[20px]');
}

function hideToast() {
    document.getElementById('toast').classList.add('opacity-0', 'translate-y-[20px]');
}

// UI Toggles
const themeBtn = document.getElementById('theme-toggle');
const html = document.documentElement;
themeBtn.addEventListener('click', () => {
    html.classList.toggle('dark');
    if (html.classList.contains('dark')) changeBaseMap('dark');
    else changeBaseMap('positron');
});

function changeBaseMap(type) {
    const buttons = {
        'terrain': document.getElementById('btn-terrain'),
        'positron': document.getElementById('btn-positron'),
        'dark': document.getElementById('btn-dark')
    };
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
    if (currentBaseLayer) map.removeLayer(currentBaseLayer);
    currentBaseLayer = tileLayers[type];
    currentBaseLayer.addTo(map);
    if (type === 'dark' && !html.classList.contains('dark')) html.classList.add('dark');
    else if (type === 'positron' && html.classList.contains('dark')) html.classList.remove('dark');
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