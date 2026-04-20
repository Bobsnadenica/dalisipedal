const DATASETS = Object.freeze([
    {
        id: 'major_roads',
        title: 'Републикански пътища',
        subtitle: 'Основната пътна мрежа като линеен слой',
        shp: 'api_data/major_roads/RI_Road.shp',
        dbf: 'api_data/major_roads/RI_Road.dbf',
        prj: 'api_data/major_roads/RI_Road.prj',
        color: '#f8c555',
    },
    {
        id: 'municipality_roads',
        title: 'Общински пътища',
        subtitle: 'Общинска пътна мрежа като линеен слой',
        shp: 'api_data/ob6tinski_put/Municipality_roads.shp',
        dbf: 'api_data/ob6tinski_put/Municipality_roads.dbf',
        prj: 'api_data/ob6tinski_put/Municipality_roads.prj',
        color: '#68d8ff',
    },
    {
        id: 'km_points',
        title: 'Километрични точки',
        subtitle: 'Маркировки по километража като точков слой',
        shp: 'api_data/km/RI_RoadLabel.shp',
        dbf: 'api_data/km/RI_RoadLabel.dbf',
        prj: 'api_data/km/RI_RoadLabel.prj',
        color: '#b891ff',
    },
    {
        id: 'bridges',
        title: 'Мостове',
        subtitle: 'Точков слой за мостови съоръжения',
        shp: 'api_data/bridge/RI_Bridge_point.shp',
        dbf: 'api_data/bridge/RI_Bridge_point.dbf',
        prj: 'api_data/bridge/RI_Bridge_point.prj',
        color: '#7ee58c',
    },
    {
        id: 'tunnels',
        title: 'Тунели',
        subtitle: 'Точков слой за тунели',
        shp: 'api_data/tunnels/RI_Tunnel_point.shp',
        dbf: 'api_data/tunnels/RI_Tunnel_point.dbf',
        prj: 'api_data/tunnels/RI_Tunnel_point.prj',
        color: '#ff8b8b',
    },
]);

const state = {
    datasets: [],
    visibleLayers: new Set(DATASETS.map(dataset => dataset.id)),
};

const SHAPE_TYPE_NAMES = Object.freeze({
    0: 'Празна геометрия',
    1: 'Точка',
    3: 'Линия',
    11: 'Точка Z',
    13: 'Линия Z',
});

function formatNumber(value) {
    return new Intl.NumberFormat('bg-BG').format(Number(value) || 0);
}

function formatBounds(bounds) {
    if (!bounds) {
        return '...';
    }

    return [
        bounds.xmin.toFixed(2),
        bounds.ymin.toFixed(2),
        bounds.xmax.toFixed(2),
        bounds.ymax.toFixed(2),
    ].join(' / ');
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function extractProjectionName(prjText) {
    const match = String(prjText || '').match(/^(?:PROJCS|GEOGCS)\["([^"]+)"/);
    return match ? match[1] : 'Неизвестна проекция';
}

function parseDbfFieldType(type) {
    switch (type) {
    case 'C':
        return 'Текст';
    case 'N':
        return 'Число';
    case 'F':
        return 'Дробно число';
    case 'D':
        return 'Дата';
    case 'L':
        return 'Булево';
    default:
        return type;
    }
}

function decodeDbfValue(rawValue, field) {
    const trimmed = rawValue.trim();
    if (!trimmed) {
        return '';
    }

    if (field.type === 'N' || field.type === 'F') {
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : trimmed;
    }

    return trimmed;
}

function parseDbf(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const decoder = new TextDecoder('utf-8');

    const recordCount = view.getUint32(4, true);
    const headerLength = view.getUint16(8, true);
    const recordLength = view.getUint16(10, true);

    const fields = [];
    let offset = 32;

    while (offset < headerLength) {
        const marker = bytes[offset];
        if (marker === 0x0D) {
            offset += 1;
            break;
        }

        const nameBytes = bytes.slice(offset, offset + 11);
        const zeroIndex = nameBytes.indexOf(0);
        const rawName = decoder.decode(zeroIndex >= 0 ? nameBytes.slice(0, zeroIndex) : nameBytes);
        const type = String.fromCharCode(bytes[offset + 11]);
        const length = bytes[offset + 16];
        const decimals = bytes[offset + 17];

        fields.push({
            name: rawName,
            type,
            length,
            decimals,
        });

        offset += 32;
    }

    const samples = [];
    let recordOffset = headerLength;

    for (let recordIndex = 0; recordIndex < recordCount && samples.length < 3; recordIndex += 1) {
        const deletionFlag = bytes[recordOffset];
        if (deletionFlag === 0x2A) {
            recordOffset += recordLength;
            continue;
        }

        let fieldOffset = recordOffset + 1;
        const row = {};

        fields.forEach(field => {
            const rawBytes = bytes.slice(fieldOffset, fieldOffset + field.length);
            const value = decoder.decode(rawBytes);
            row[field.name] = decodeDbfValue(value, field);
            fieldOffset += field.length;
        });

        samples.push(row);
        recordOffset += recordLength;
    }

    return {
        recordCount,
        fields,
        samples,
    };
}

function simplifyLine(points, maxPoints = 140) {
    if (points.length <= maxPoints) {
        return points;
    }

    const simplified = [];
    const step = Math.max(1, Math.floor(points.length / maxPoints));

    for (let index = 0; index < points.length; index += step) {
        simplified.push(points[index]);
    }

    const lastPoint = points[points.length - 1];
    const finalPoint = simplified[simplified.length - 1];
    if (!finalPoint || finalPoint[0] !== lastPoint[0] || finalPoint[1] !== lastPoint[1]) {
        simplified.push(lastPoint);
    }

    return simplified;
}

function parsePointZ(view, offset) {
    return {
        type: 'point',
        coordinates: [view.getFloat64(offset + 4, true), view.getFloat64(offset + 12, true)],
    };
}

function parsePolyline(view, offset) {
    const numParts = view.getInt32(offset + 36, true);
    const numPoints = view.getInt32(offset + 40, true);

    const parts = [];
    let partsOffset = offset + 44;
    for (let index = 0; index < numParts; index += 1) {
        parts.push(view.getInt32(partsOffset + (index * 4), true));
    }

    const pointsOffset = partsOffset + (numParts * 4);
    const allPoints = [];

    for (let index = 0; index < numPoints; index += 1) {
        const pointOffset = pointsOffset + (index * 16);
        allPoints.push([
            view.getFloat64(pointOffset, true),
            view.getFloat64(pointOffset + 8, true),
        ]);
    }

    const lineParts = [];
    for (let partIndex = 0; partIndex < numParts; partIndex += 1) {
        const start = parts[partIndex];
        const end = partIndex + 1 < numParts ? parts[partIndex + 1] : allPoints.length;
        lineParts.push(simplifyLine(allPoints.slice(start, end)));
    }

    return {
        type: 'polyline',
        parts: lineParts,
    };
}

function parseShp(buffer) {
    const view = new DataView(buffer);
    const shapeType = view.getInt32(32, true);
    const bbox = {
        xmin: view.getFloat64(36, true),
        ymin: view.getFloat64(44, true),
        xmax: view.getFloat64(52, true),
        ymax: view.getFloat64(60, true),
    };

    const features = [];
    let offset = 100;

    while (offset + 8 <= view.byteLength) {
        const contentLength = view.getInt32(offset + 4, false) * 2;
        const recordOffset = offset + 8;
        if (contentLength <= 0 || recordOffset + contentLength > view.byteLength) {
            break;
        }

        const recordShapeType = view.getInt32(recordOffset, true);
        if (recordShapeType === 11 || recordShapeType === 1) {
            features.push(parsePointZ(view, recordOffset));
        } else if (recordShapeType === 3 || recordShapeType === 13) {
            features.push(parsePolyline(view, recordOffset));
        }

        offset = recordOffset + contentLength;
    }

    return {
        shapeType,
        shapeTypeLabel: SHAPE_TYPE_NAMES[shapeType] || `Shape ${shapeType}`,
        bbox,
        features,
    };
}

async function loadDataset(dataset) {
    const [shpBuffer, dbfBuffer, prjText] = await Promise.all([
        fetch(dataset.shp).then(response => {
            if (!response.ok) {
                throw new Error(`SHP HTTP ${response.status}`);
            }
            return response.arrayBuffer();
        }),
        fetch(dataset.dbf).then(response => {
            if (!response.ok) {
                throw new Error(`DBF HTTP ${response.status}`);
            }
            return response.arrayBuffer();
        }),
        fetch(dataset.prj).then(response => {
            if (!response.ok) {
                throw new Error(`PRJ HTTP ${response.status}`);
            }
            return response.text();
        }),
    ]);

    const geometry = parseShp(shpBuffer);
    const attributes = parseDbf(dbfBuffer);

    return {
        ...dataset,
        geometry,
        attributes,
        projectionName: extractProjectionName(prjText),
    };
}

function getGlobalBounds() {
    const bounds = {
        xmin: Infinity,
        ymin: Infinity,
        xmax: -Infinity,
        ymax: -Infinity,
    };

    state.datasets
        .filter(dataset => state.visibleLayers.has(dataset.id))
        .forEach(dataset => {
            bounds.xmin = Math.min(bounds.xmin, dataset.geometry.bbox.xmin);
            bounds.ymin = Math.min(bounds.ymin, dataset.geometry.bbox.ymin);
            bounds.xmax = Math.max(bounds.xmax, dataset.geometry.bbox.xmax);
            bounds.ymax = Math.max(bounds.ymax, dataset.geometry.bbox.ymax);
        });

    if (!Number.isFinite(bounds.xmin)) {
        return null;
    }

    return bounds;
}

function projectCoordinate(x, y, bounds, width, height, padding) {
    const boundsWidth = bounds.xmax - bounds.xmin || 1;
    const boundsHeight = bounds.ymax - bounds.ymin || 1;
    const scale = Math.min(
        (width - (padding * 2)) / boundsWidth,
        (height - (padding * 2)) / boundsHeight
    );

    const drawWidth = boundsWidth * scale;
    const drawHeight = boundsHeight * scale;
    const offsetX = (width - drawWidth) / 2;
    const offsetY = (height - drawHeight) / 2;

    return [
        offsetX + ((x - bounds.xmin) * scale),
        height - (offsetY + ((y - bounds.ymin) * scale)),
    ];
}

function resizeCanvasToDisplaySize(canvas) {
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, width, height };
}

function drawMap() {
    const canvas = document.getElementById('data-map');
    if (!canvas) {
        return;
    }

    const { context, width, height } = resizeCanvasToDisplaySize(canvas);
    const bounds = getGlobalBounds();
    const mapStatusEl = document.getElementById('map-status');
    const mapBoundsEl = document.getElementById('map-bounds');

    context.clearRect(0, 0, width, height);

    if (!bounds) {
        if (mapStatusEl) {
            mapStatusEl.textContent = 'Няма активни слоеве за визуализация.';
        }
        if (mapBoundsEl) {
            mapBoundsEl.textContent = 'Граници: ...';
        }
        return;
    }

    context.fillStyle = 'rgba(8, 12, 16, 0.98)';
    context.fillRect(0, 0, width, height);

    const padding = Math.min(42, width * 0.06);
    const visibleDatasets = state.datasets.filter(dataset => state.visibleLayers.has(dataset.id));

    visibleDatasets.forEach(dataset => {
        context.save();
        context.strokeStyle = dataset.color;
        context.fillStyle = dataset.color;

        if (dataset.geometry.shapeType === 3 || dataset.geometry.shapeType === 13) {
            context.lineWidth = dataset.id === 'major_roads' ? 1.8 : 1.15;
            context.globalAlpha = dataset.id === 'major_roads' ? 0.95 : 0.55;

            dataset.geometry.features.forEach(feature => {
                feature.parts.forEach(part => {
                    if (!part.length) {
                        return;
                    }

                    context.beginPath();
                    part.forEach(([x, y], pointIndex) => {
                        const [px, py] = projectCoordinate(x, y, bounds, width, height, padding);
                        if (pointIndex === 0) {
                            context.moveTo(px, py);
                        } else {
                            context.lineTo(px, py);
                        }
                    });
                    context.stroke();
                });
            });
        } else {
            context.globalAlpha = 0.86;
            const radius = dataset.id === 'tunnels' ? 3.6 : 2.4;

            dataset.geometry.features.forEach(feature => {
                const [px, py] = projectCoordinate(
                    feature.coordinates[0],
                    feature.coordinates[1],
                    bounds,
                    width,
                    height,
                    padding
                );

                context.beginPath();
                context.arc(px, py, radius, 0, Math.PI * 2);
                context.fill();
            });
        }

        context.restore();
    });

    if (mapStatusEl) {
        mapStatusEl.textContent = `Активни слоеве: ${visibleDatasets.length} / ${state.datasets.length}`;
    }

    if (mapBoundsEl) {
        mapBoundsEl.textContent = `Граници: ${formatBounds(bounds)}`;
    }
}

function renderStats() {
    const totalDatasets = state.datasets.length;
    const totalRecords = state.datasets.reduce((sum, dataset) => sum + dataset.attributes.recordCount, 0);
    const geometryTypes = new Set(state.datasets.map(dataset => dataset.geometry.shapeTypeLabel));

    document.getElementById('stat-datasets').textContent = formatNumber(totalDatasets);
    document.getElementById('stat-records').textContent = formatNumber(totalRecords);
    document.getElementById('stat-geometry').textContent = formatNumber(geometryTypes.size);
}

function toggleLayer(id) {
    if (state.visibleLayers.has(id)) {
        state.visibleLayers.delete(id);
    } else {
        state.visibleLayers.add(id);
    }

    renderLayerToolbar();
    drawMap();
}

function renderLayerToolbar() {
    const toolbarEl = document.getElementById('layer-toolbar');
    if (!toolbarEl) {
        return;
    }

    toolbarEl.innerHTML = '';

    state.datasets.forEach(dataset => {
        const button = document.createElement('button');
        button.className = `layer-chip${state.visibleLayers.has(dataset.id) ? '' : ' is-off'}`;
        button.type = 'button';
        button.innerHTML = `
            <span class="layer-dot" style="background:${dataset.color}"></span>
            <span>${escapeHtml(dataset.title)}</span>
            <span class="dataset-count">${formatNumber(dataset.attributes.recordCount)}</span>
        `;
        button.addEventListener('click', () => toggleLayer(dataset.id));
        toolbarEl.appendChild(button);
    });
}

function renderSamplesTable(dataset) {
    if (!dataset.attributes.samples.length) {
        return '<div class="loading-panel">Няма примерни редове в DBF preview-а.</div>';
    }

    const fields = dataset.attributes.fields.slice(0, 4);
    const header = fields
        .map(field => `<th>${escapeHtml(field.name)}</th>`)
        .join('');
    const rows = dataset.attributes.samples
        .map(row => `
            <tr>
                ${fields.map(field => `<td>${escapeHtml(row[field.name])}</td>`).join('')}
            </tr>
        `)
        .join('');

    return `
        <table class="sample-table">
            <thead>
                <tr>${header}</tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function renderDatasetCards() {
    const stackEl = document.getElementById('dataset-stack');
    if (!stackEl) {
        return;
    }

    stackEl.innerHTML = '';

    state.datasets.forEach(dataset => {
        const card = document.createElement('article');
        card.className = 'dataset-card';
        card.innerHTML = `
            <div class="dataset-head">
                <div class="dataset-title-wrap">
                    <div class="dataset-title">
                        <span class="layer-dot" style="background:${dataset.color}"></span>
                        <span>${escapeHtml(dataset.title)}</span>
                    </div>
                    <div class="dataset-subtitle">${escapeHtml(dataset.subtitle)}</div>
                </div>
                <div class="dataset-count">${formatNumber(dataset.attributes.recordCount)} записа</div>
            </div>

            <div class="dataset-meta">
                <div class="dataset-meta-item">
                    <div class="dataset-meta-label">Геометрия</div>
                    <div class="dataset-meta-value">${escapeHtml(dataset.geometry.shapeTypeLabel)}</div>
                </div>
                <div class="dataset-meta-item">
                    <div class="dataset-meta-label">Проекция</div>
                    <div class="dataset-meta-value">${escapeHtml(dataset.projectionName)}</div>
                </div>
                <div class="dataset-meta-item">
                    <div class="dataset-meta-label">Граници</div>
                    <div class="dataset-meta-value">${escapeHtml(formatBounds(dataset.geometry.bbox))}</div>
                </div>
                <div class="dataset-meta-item">
                    <div class="dataset-meta-label">Геометрии</div>
                    <div class="dataset-meta-value">${formatNumber(dataset.geometry.features.length)} геометрии</div>
                </div>
            </div>

            <div>
                <div class="dataset-meta-label">Полета</div>
                <div class="field-list">
                    ${dataset.attributes.fields.map(field => `
                        <span class="field-pill">${escapeHtml(field.name)} · ${escapeHtml(parseDbfFieldType(field.type))}</span>
                    `).join('')}
                </div>
            </div>

            <div>
                <div class="dataset-meta-label">Примерни редове</div>
                ${renderSamplesTable(dataset)}
            </div>
        `;
        stackEl.appendChild(card);
    });
}

function setLoadingMessage(message) {
    const stackEl = document.getElementById('dataset-stack');
    const mapStatusEl = document.getElementById('map-status');

    if (stackEl) {
        stackEl.innerHTML = `<div class="loading-panel">${escapeHtml(message)}</div>`;
    }

    if (mapStatusEl) {
        mapStatusEl.textContent = message;
    }
}

function setErrorMessage(message) {
    const stackEl = document.getElementById('dataset-stack');
    const mapStatusEl = document.getElementById('map-status');

    if (stackEl) {
        stackEl.innerHTML = `<div class="error-panel">${escapeHtml(message)}</div>`;
    }

    if (mapStatusEl) {
        mapStatusEl.textContent = message;
    }
}

async function init() {
    try {
        for (let index = 0; index < DATASETS.length; index += 1) {
            const dataset = DATASETS[index];
            setLoadingMessage(`Зареждаме ${index + 1} / ${DATASETS.length}: ${dataset.title}...`);
            state.datasets.push(await loadDataset(dataset));
        }

        renderStats();
        renderLayerToolbar();
        renderDatasetCards();
        drawMap();
    } catch (error) {
        console.error('Failed to load open data layers:', error);
        setErrorMessage(`Не успяхме да заредим наличните слоеве: ${error.message || error}`);
    }
}

window.addEventListener('resize', drawMap);
document.addEventListener('DOMContentLoaded', init);
