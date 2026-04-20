const SNAPSHOT_URL = 'data/black-map-snapshot.json';

const MONTH_LABELS = ['Яну', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'];
const MONTH_LABELS_LONG = ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни', 'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];
const WEEKDAY_LABELS = ['Пон', 'Вто', 'Сря', 'Чет', 'Пет', 'Съб', 'Нед'];
const HOUR_LABELS = Array.from({ length: 24 }, (_, index) => `${String(index).padStart(2, '0')}:00`);
const CITY_HINTS = [
  { name: 'София', lat: 42.6977, lng: 23.3219, dx: -20, dy: -10 },
  { name: 'Пловдив', lat: 42.1354, lng: 24.7453, dx: -24, dy: 18 },
  { name: 'Варна', lat: 43.2141, lng: 27.9147, dx: -12, dy: -12 },
  { name: 'Бургас', lat: 42.5048, lng: 27.4626, dx: -8, dy: 18 },
  { name: 'Русе', lat: 43.8356, lng: 25.9657, dx: -8, dy: -12 },
  { name: 'Стара Загора', lat: 42.4258, lng: 25.6345, dx: -24, dy: 18 },
];
const DEFAULT_MAP_CENTER = [42.7249, 25.4833];
const DEFAULT_MAP_ZOOM = 7;

const state = {
  snapshot: null,
  records: [],
  recordsByYear: new Map(),
  dayCapsByYearMonth: new Map(),
  selectedYear: null,
  selectedMonth: null,
  comparisonYear: null,
  filteredRecords: [],
  comparisonRecords: [],
  activeTab: 'overview',
  showMajor: true,
  showMinor: true,
  selectedRecord: null,
  map: {
    instance: null,
    layerGroup: null,
    renderer: null,
    renderedRecords: [],
    hasFitted: false,
  },
};

const elements = {
  updated: document.getElementById('black-map-updated'),
  error: document.getElementById('black-map-error'),
  heroLead: document.getElementById('black-map-lead'),
  yearFilters: document.getElementById('year-filters'),
  monthFilter: document.getElementById('month-filter'),
  comparisonFilter: document.getElementById('comparison-filter'),
  tabs: Array.from(document.querySelectorAll('[data-black-tab]')),
  views: Array.from(document.querySelectorAll('[data-black-view]')),
  stats: document.getElementById('black-map-stats'),
  comparisonCard: document.getElementById('black-map-comparison'),
  comparisonBody: document.getElementById('black-map-comparison-body'),
  comparisonHint: document.getElementById('black-map-comparison-hint'),
  trendTitle: document.getElementById('black-map-trend-title'),
  trendLegend: document.getElementById('black-map-trend-legend'),
  trendNote: document.getElementById('black-map-trend-note'),
  trendChart: document.getElementById('black-map-trend-chart'),
  hotspots: document.getElementById('black-map-hotspots'),
  mapSummary: document.getElementById('black-map-map-summary'),
  majorToggle: document.getElementById('toggle-major'),
  minorToggle: document.getElementById('toggle-minor'),
  mapLeaflet: document.getElementById('black-map-leaflet'),
  mapStage: document.getElementById('black-map-stage'),
  mapZoomIn: document.getElementById('map-zoom-in'),
  mapZoomOut: document.getElementById('map-zoom-out'),
  mapZoomFit: document.getElementById('map-zoom-fit'),
  selectedCard: document.getElementById('selected-incident'),
  selectedMeta: document.getElementById('selected-incident-meta'),
  selectedCasualties: document.getElementById('selected-incident-casualties'),
  selectedCoords: document.getElementById('selected-incident-coords'),
  selectedAction: document.getElementById('selected-incident-action'),
  selectedEmpty: document.getElementById('selected-incident-empty'),
  severityDonut: document.getElementById('severity-donut'),
  severityLegend: document.getElementById('severity-legend'),
  casualtyBars: document.getElementById('casualty-bars'),
  monthlyBars: document.getElementById('details-monthly-bars'),
  weekdayBars: document.getElementById('details-weekday-bars'),
  hourlyBars: document.getElementById('details-hourly-bars'),
  roadClassList: document.getElementById('details-road-classes'),
};

function fetchJson(url) {
  return fetch(url, { cache: 'default' }).then((response) => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  });
}

function formatNumber(value) {
  return new Intl.NumberFormat('bg-BG').format(value || 0);
}

function formatDate(value) {
  if (!value) return 'Няма дата';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('bg-BG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function decodeRecord(row, index) {
  return {
    id: index,
    lat: row[0] / 10000,
    lng: row[1] / 10000,
    isMajor: row[2] === 1,
    year: row[3],
    month: row[4],
    day: row[5],
    hour: row[6],
    roadClassId: row[7],
    died: row[8],
    injured: row[9],
  };
}

function getRoadClassName(roadClassId) {
  const lookups = state.snapshot?.lookups?.roadClasses || {};
  return lookups[String(roadClassId)] || lookups[roadClassId] || (roadClassId === 0 ? 'Градска/неуточнена мрежа' : `Клас ${roadClassId}`);
}

function getAvailableComparisonYears() {
  if (!state.selectedYear) return [];
  return state.snapshot.meta.years.filter((year) => year < state.selectedYear).sort((left, right) => right - left);
}

function getSelectedYearMonthCap() {
  if (!state.selectedYear) return null;
  return state.snapshot.meta.latestByYear?.[state.selectedYear]?.month ?? null;
}

function getSelectedYearDayCap() {
  if (!state.selectedYear || !state.selectedMonth) return null;
  return state.dayCapsByYearMonth.get(`${state.selectedYear}-${state.selectedMonth}`) ?? null;
}

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function getRecordsForYear(year) {
  if (year == null) return [];
  return state.recordsByYear.get(String(year)) || [];
}

function filterRecordsForYear(year, { applyComparisonCutoff = false } = {}) {
  const source = getRecordsForYear(year);
  if (!source.length) return [];

  const monthCap = applyComparisonCutoff && state.selectedMonth == null
    ? getSelectedYearMonthCap()
    : null;
  const dayCap = applyComparisonCutoff && state.selectedMonth != null
    ? getSelectedYearDayCap()
    : null;

  return source.filter((record) => {
    if (state.selectedMonth != null) {
      if (record.month !== state.selectedMonth) return false;
      if (dayCap != null && record.day > dayCap) return false;
      return true;
    }

    if (monthCap != null && record.month > monthCap) return false;
    return true;
  });
}

function buildSummary(records) {
  let died = 0;
  let injured = 0;
  let major = 0;

  for (const record of records) {
    died += record.died;
    injured += record.injured;
    if (record.isMajor) major += 1;
  }

  return {
    total: records.length,
    major,
    minor: records.length - major,
    died,
    injured,
    majorRate: records.length ? Number(((major / records.length) * 100).toFixed(1)) : 0,
  };
}

function computeHotspotWeight(record) {
  return 1 + (record.isMajor ? 2.6 : 0) + (record.died * 4.2) + (record.injured * 1.4);
}

function aggregateHotspots(records, limit = 6) {
  const bounds = state.snapshot.meta.grid.bounds;
  const rows = 14;
  const cols = 24;
  const latRange = bounds.maxLat - bounds.minLat;
  const lngRange = bounds.maxLng - bounds.minLng;
  const buckets = new Map();

  for (const record of records) {
    if (
      record.lat < bounds.minLat ||
      record.lat > bounds.maxLat ||
      record.lng < bounds.minLng ||
      record.lng > bounds.maxLng
    ) {
      continue;
    }

    const x = Math.max(0, Math.min(cols - 1, Math.floor(((record.lng - bounds.minLng) / Math.max(lngRange, 0.000001)) * cols)));
    const y = Math.max(0, Math.min(rows - 1, Math.floor(((bounds.maxLat - record.lat) / Math.max(latRange, 0.000001)) * rows)));
    const key = `${x}:${y}`;
    const bucket = buckets.get(key) || { x, y, total: 0, major: 0, died: 0, injured: 0, weight: 0 };
    bucket.total += 1;
    bucket.major += record.isMajor ? 1 : 0;
    bucket.died += record.died;
    bucket.injured += record.injured;
    bucket.weight += computeHotspotWeight(record);
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .sort((left, right) => right.weight - left.weight)
    .slice(0, limit)
    .map((bucket) => {
      const lat = bounds.maxLat - (((bucket.y + 0.5) / rows) * latRange);
      const lng = bounds.minLng + (((bucket.x + 0.5) / cols) * lngRange);
      const city = findNearestCity(lat, lng);
      return {
        ...bucket,
        label: city,
        lat: Number(lat.toFixed(4)),
        lng: Number(lng.toFixed(4)),
      };
    });
}

function findNearestCity(lat, lng) {
  let nearest = CITY_HINTS[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const city of CITY_HINTS) {
    const distance = Math.hypot(city.lat - lat, city.lng - lng);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = city;
    }
  }

  if (bestDistance <= 0.45) return nearest.name;
  if (bestDistance <= 0.95) return `района на ${nearest.name}`;
  return `широк район ${nearest.name}`;
}

function buildBuckets(records, mode, maxKey) {
  const buckets = Array.from({ length: maxKey }, () => 0);
  for (const record of records) {
    const key = mode === 'days' ? record.day : record.month;
    if (key >= 1 && key <= maxKey) {
      buckets[key - 1] += 1;
    }
  }
  return buckets;
}

function getChartMaxKey() {
  const defaultMax = state.selectedMonth
    ? getDaysInMonth(state.selectedYear, state.selectedMonth)
    : 12;

  if (state.comparisonYear == null || !state.filteredRecords.length) {
    return defaultMax;
  }

  const values = state.filteredRecords.map((record) => state.selectedMonth ? record.day : record.month);
  const maxObserved = values.length ? Math.max(...values) : defaultMax;
  return Math.max(1, Math.min(defaultMax, maxObserved));
}

function updateComparisonForYear() {
  const available = getAvailableComparisonYears();
  if (!available.includes(state.comparisonYear)) {
    state.comparisonYear = available[0] ?? null;
  }
}

function applyFilters() {
  state.filteredRecords = filterRecordsForYear(state.selectedYear);
  state.comparisonRecords = state.comparisonYear == null
    ? []
    : filterRecordsForYear(state.comparisonYear, { applyComparisonCutoff: true });

  if (state.selectedRecord) {
    const stillVisible = state.filteredRecords.some((record) => record.id === state.selectedRecord.id);
    if (!stillVisible) {
      state.selectedRecord = null;
    }
  }

  renderAll();
}

function renderYearFilters() {
  elements.yearFilters.innerHTML = state.snapshot.meta.years.map((year) => `
    <button class="year-pill${year === state.selectedYear ? ' active' : ''}" type="button" data-year="${year}">
      ${year}
    </button>
  `).join('');

  elements.yearFilters.querySelectorAll('[data-year]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextYear = Number.parseInt(button.dataset.year || '', 10);
      if (!Number.isFinite(nextYear) || nextYear === state.selectedYear) return;
      state.selectedYear = nextYear;
      updateComparisonForYear();
      syncFilterInputs();
      applyFilters();
    });
  });
}

function syncFilterInputs() {
  const availableComparisonYears = getAvailableComparisonYears();
  elements.monthFilter.innerHTML = `
    <option value="">Всички месеци</option>
    ${MONTH_LABELS_LONG.map((label, index) => `<option value="${index + 1}">${label}</option>`).join('')}
  `;
  elements.monthFilter.value = state.selectedMonth == null ? '' : String(state.selectedMonth);

  elements.comparisonFilter.innerHTML = `
    <option value="">Без сравнение</option>
    ${availableComparisonYears.map((year) => `<option value="${year}">${year}</option>`).join('')}
  `;
  elements.comparisonFilter.value = state.comparisonYear == null ? '' : String(state.comparisonYear);
}

function renderStats() {
  const summary = buildSummary(state.filteredRecords);
  const cards = [
    {
      label: 'Загинали',
      value: formatNumber(summary.died),
      tone: 'fatal',
      icon: 'person_off',
    },
    {
      label: 'Ранени',
      value: formatNumber(summary.injured),
      tone: 'warn',
      icon: 'local_hospital',
    },
    {
      label: 'Тежки ПТП',
      value: formatNumber(summary.major),
      tone: 'danger',
      icon: 'warning_amber',
    },
    {
      label: 'Общо инциденти',
      value: formatNumber(summary.total),
      tone: 'neutral',
      icon: 'analytics',
    },
  ];

  elements.stats.innerHTML = cards.map((card) => `
    <article class="black-stat-card ${card.tone}">
      <div class="black-stat-top">
        <div class="black-stat-label">${card.label}</div>
        <span class="material-icons-round black-stat-icon">${card.icon}</span>
      </div>
      <div class="black-stat-value">${card.value}</div>
      <div class="black-stat-copy">${card.label === 'Тежки ПТП' ? `${summary.majorRate}% от всички записи` : selectedRangeLabel()}</div>
    </article>
  `).join('');

  elements.heroLead.textContent = state.selectedMonth == null
    ? `Година ${state.selectedYear} с бърз преглед на тенденциите, картата и по-детайлния риск по време и място.`
    : `${MONTH_LABELS_LONG[state.selectedMonth - 1]} ${state.selectedYear} с фокус върху дневната активност, картата и детайлите по риска.`;
}

function selectedRangeLabel() {
  if (state.selectedMonth == null) {
    return `за ${state.selectedYear}`;
  }
  return `${MONTH_LABELS_LONG[state.selectedMonth - 1]} ${state.selectedYear}`;
}

function renderComparison() {
  if (state.comparisonYear == null) {
    elements.comparisonCard.hidden = true;
    elements.comparisonBody.innerHTML = '';
    elements.comparisonHint.textContent = '';
    return;
  }

  const current = buildSummary(state.filteredRecords);
  const previous = buildSummary(state.comparisonRecords);
  const rows = [
    { label: 'Загинали', currentValue: current.died, previousValue: previous.died },
    { label: 'Ранени', currentValue: current.injured, previousValue: previous.injured },
    { label: 'Тежки ПТП', currentValue: current.major, previousValue: previous.major },
    { label: 'Общо инциденти', currentValue: current.total, previousValue: previous.total },
  ];

  elements.comparisonCard.hidden = false;
  elements.comparisonBody.innerHTML = rows.map((row) => {
    const difference = row.currentValue - row.previousValue;
    const deltaColor = difference < 0 ? 'good' : difference > 0 ? 'bad' : 'flat';
    const deltaIcon = difference < 0 ? 'south' : difference > 0 ? 'north' : 'remove';
    let deltaLabel = '0%';
    if (row.previousValue === 0) {
      deltaLabel = difference === 0 ? '0' : `${difference > 0 ? '+' : ''}${difference}`;
    } else {
      const percent = Math.round((difference / row.previousValue) * 100);
      deltaLabel = `${percent > 0 ? '+' : ''}${percent}%`;
    }

    return `
      <div class="comparison-row">
        <div class="comparison-copy">
          <div class="comparison-label">${row.label}</div>
          <div class="comparison-values">${state.comparisonYear}: ${formatNumber(row.previousValue)} • ${state.selectedYear}: ${formatNumber(row.currentValue)}</div>
        </div>
        <div class="comparison-pill ${deltaColor}">
          <span class="material-icons-round">${deltaIcon}</span>
          <span>${deltaLabel}</span>
        </div>
      </div>
    `;
  }).join('');

  elements.comparisonHint.textContent = state.selectedMonth == null
    ? `Показва ${state.selectedYear} спрямо ${state.comparisonYear} до последния наличен месец за избраната година.`
    : `Показва ${MONTH_LABELS_LONG[state.selectedMonth - 1]} ${state.selectedYear} спрямо ${state.comparisonYear} до последния наличен ден.`;
}

function buildTrendSvg(currentValues, comparisonValues, maxKey) {
  const width = 900;
  const height = 280;
  const padding = { top: 18, right: 20, bottom: 46, left: 14 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxY = Math.max(...currentValues, ...comparisonValues, 1);
  const makePoint = (value, index, totalPoints) => {
    const x = padding.left + ((totalPoints === 1 ? 0 : index / (totalPoints - 1)) * chartWidth);
    const y = padding.top + chartHeight - ((value / maxY) * chartHeight);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  };

  const currentPoints = currentValues.map((value, index) => makePoint(value, index, currentValues.length));
  const comparisonPoints = comparisonValues.length
    ? comparisonValues.map((value, index) => makePoint(value, index, comparisonValues.length))
    : [];

  const areaPath = currentPoints.length
    ? `M ${currentPoints[0]} L ${currentPoints.join(' L ')} L ${padding.left + chartWidth},${padding.top + chartHeight} L ${padding.left},${padding.top + chartHeight} Z`
    : '';

  const labels = Array.from({ length: maxKey }, (_, index) => {
    const position = padding.left + ((maxKey === 1 ? 0 : index / (maxKey - 1)) * chartWidth);
    const label = state.selectedMonth == null
      ? MONTH_LABELS[index]
      : `${index + 1}`;
    return `<text x="${position.toFixed(2)}" y="${height - 12}" class="trend-axis-label">${label}</text>`;
  }).join('');

  const gridLines = Array.from({ length: 4 }, (_, index) => {
    const y = padding.top + ((chartHeight / 3) * index);
    return `<line x1="${padding.left}" y1="${y.toFixed(2)}" x2="${width - padding.right}" y2="${y.toFixed(2)}" class="trend-grid-line"></line>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" class="trend-svg" role="img" aria-label="Тренд на инцидентите">
      ${gridLines}
      ${areaPath ? `<path d="${areaPath}" class="trend-area"></path>` : ''}
      ${comparisonPoints.length ? `<polyline points="${comparisonPoints.join(' ')}" class="trend-line compare"></polyline>` : ''}
      ${currentPoints.length ? `<polyline points="${currentPoints.join(' ')}" class="trend-line current"></polyline>` : ''}
      ${currentPoints.map((point, index) => {
        const [x, y] = point.split(',');
        return `<circle cx="${x}" cy="${y}" r="3.4" class="trend-dot current"><title>${state.selectedMonth == null ? MONTH_LABELS_LONG[index] : `Ден ${index + 1}`}: ${formatNumber(currentValues[index])}</title></circle>`;
      }).join('')}
      ${comparisonPoints.map((point, index) => {
        const [x, y] = point.split(',');
        return `<circle cx="${x}" cy="${y}" r="3" class="trend-dot compare"><title>${state.selectedMonth == null ? MONTH_LABELS_LONG[index] : `Ден ${index + 1}`}: ${formatNumber(comparisonValues[index])}</title></circle>`;
      }).join('')}
      ${labels}
    </svg>
  `;
}

function renderTrend() {
  const maxKey = getChartMaxKey();
  const mode = state.selectedMonth == null ? 'months' : 'days';
  const currentValues = buildBuckets(state.filteredRecords, mode, maxKey);
  const comparisonValues = state.comparisonYear == null ? [] : buildBuckets(state.comparisonRecords, mode, maxKey);

  elements.trendTitle.textContent = state.selectedMonth == null
    ? (state.comparisonYear == null ? 'Месечна активност' : 'Сравнение по месеци')
    : (state.comparisonYear == null ? 'Дневна активност' : 'Сравнение по дни');

  elements.trendLegend.innerHTML = `
    <span class="legend-pill"><span class="legend-line current"></span>${state.selectedYear}</span>
    ${state.comparisonYear == null ? '' : `<span class="legend-pill"><span class="legend-line compare"></span>${state.comparisonYear}</span>`}
  `;

  const defaultMax = state.selectedMonth == null
    ? 12
    : getDaysInMonth(state.selectedYear, state.selectedMonth);
  elements.trendNote.textContent = state.comparisonYear != null && maxKey < defaultMax
    ? (state.selectedMonth == null
      ? `Сравнението е до ${MONTH_LABELS_LONG[maxKey - 1]}.`
      : `Сравнението е до ден ${maxKey}.`)
    : '';

  elements.trendChart.innerHTML = buildTrendSvg(currentValues, comparisonValues, maxKey);
}

function renderHotspots() {
  const hotspots = aggregateHotspots(state.filteredRecords);
  if (!hotspots.length) {
    elements.hotspots.innerHTML = '<p class="empty-copy">Няма достатъчно данни за този срез.</p>';
    return;
  }

  elements.hotspots.innerHTML = hotspots.map((spot, index) => `
    <article class="hotspot-card">
      <div class="hotspot-rank">#${index + 1}</div>
      <div class="hotspot-body">
        <div class="hotspot-name">${escapeHtml(spot.label)}</div>
        <div class="hotspot-meta">${formatNumber(spot.total)} инцидента • ${spot.major} тежки • ${spot.died} загинали</div>
        <div class="hotspot-coords">${spot.lat.toFixed(3)}, ${spot.lng.toFixed(3)}</div>
      </div>
    </article>
  `).join('');
}

function getMapZoom() {
  return state.map.instance ? state.map.instance.getZoom() : DEFAULT_MAP_ZOOM;
}

function getMapRenderConfig() {
  const zoom = getMapZoom();
  let minorStep = 20;
  if (zoom > 9) minorStep = 10;
  if (zoom > 11) minorStep = 3;
  if (zoom > 13) minorStep = 1;

  let majorStep = 1;
  let majorRadius = 7;
  let majorOpacity = 1;
  let majorBorder = 2;

  if (zoom < 8.5) {
    majorStep = 4;
    majorRadius = 3;
    majorOpacity = 0.6;
    majorBorder = 0;
  } else if (zoom < 11) {
    majorStep = 2;
    majorRadius = 5;
    majorOpacity = 0.8;
    majorBorder = 1;
  }

  return {
    zoom,
    minorStep,
    minorRadius: zoom > 12 ? 4 : zoom > 10 ? 3.4 : 2.7,
    minorOpacity: zoom > 12 ? 0.48 : zoom > 10 ? 0.42 : 0.34,
    majorStep,
    majorRadius,
    majorOpacity,
    majorBorder,
  };
}

function collectMapSourceRecords({ sample = true, useBounds = true } = {}) {
  const map = state.map.instance;
  const config = getMapRenderConfig();
  let source = state.filteredRecords.filter((record) => {
    if (record.isMajor && !state.showMajor) return false;
    if (!record.isMajor && !state.showMinor) return false;
    return true;
  });

  if (map && useBounds && config.zoom >= 9.5) {
    const bounds = map.getBounds().pad(0.18);
    source = source.filter((record) => bounds.contains([record.lat, record.lng]));
  }

  const major = [];
  const minor = [];
  for (const record of source) {
    if (record.isMajor) major.push(record);
    else minor.push(record);
  }

  if (major.length < 200) {
    config.majorStep = 1;
  }

  if (!sample) {
    return { records: source, config };
  }

  const records = [];
  for (let index = 0; index < minor.length; index += config.minorStep) {
    records.push(minor[index]);
  }
  for (let index = 0; index < major.length; index += config.majorStep) {
    records.push(major[index]);
  }

  return { records, config };
}

function selectRecord(record, { pan = false } = {}) {
  state.selectedRecord = record || null;
  renderSelectedIncident();
  renderLeafletMarkers();
  if (pan && record && state.map.instance) {
    state.map.instance.panTo([record.lat, record.lng], { animate: true, duration: 0.35 });
  }
}

function getSelectionThresholdPx() {
  const zoom = getMapZoom();
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches;
  let threshold = coarsePointer ? 42 : 30;

  if (zoom < 8) threshold += 28;
  else if (zoom < 10) threshold += 16;
  else if (zoom < 12) threshold += 8;

  return threshold;
}

function findNearestRecordInSet(records, clickPoint, map, thresholdPx) {
  let nearest = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const record of records) {
    const point = map.latLngToContainerPoint([record.lat, record.lng]);
    const distance = point.distanceTo(clickPoint);
    const weightedDistance = record.isMajor ? distance * 0.82 : distance;
    if (distance <= thresholdPx && weightedDistance < bestDistance) {
      bestDistance = weightedDistance;
      nearest = record;
    }
  }

  return nearest;
}

function findNearestRecordFromLatLng(latlng) {
  const map = state.map.instance;
  if (!map) return null;

  const clickPoint = map.latLngToContainerPoint(latlng);
  const thresholdPx = getSelectionThresholdPx();
  const looseThresholdPx = thresholdPx + 42;
  const searchSets = [
    state.map.renderedRecords,
    collectMapSourceRecords({ sample: false, useBounds: true }).records,
    collectMapSourceRecords({ sample: false, useBounds: false }).records,
  ];

  for (const records of searchSets) {
    const nearest = findNearestRecordInSet(records, clickPoint, map, thresholdPx);
    if (nearest) {
      return nearest;
    }
  }

  for (const records of searchSets) {
    const nearest = findNearestRecordInSet(records, clickPoint, map, looseThresholdPx);
    if (nearest) {
      return nearest;
    }
  }

  return null;
}

function fitMapToVisibleRecords() {
  const map = state.map.instance;
  if (!map) return;

  const records = collectMapSourceRecords({ sample: false, useBounds: false }).records;
  if (!records.length) {
    map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, { animate: false });
    return;
  }

  if (records.length === 1) {
    map.setView([records[0].lat, records[0].lng], 13, { animate: false });
    return;
  }

  const bounds = window.L.latLngBounds(records.map((record) => [record.lat, record.lng]));
  map.fitBounds(bounds.pad(0.18), { animate: false, padding: [18, 18], maxZoom: 13 });
}

function buildMarkerPopup(record) {
  const typeLabel = record.isMajor ? 'Тежко ПТП' : 'Леко ПТП';
  const casualties = [];
  if (record.died) casualties.push(`${formatNumber(record.died)} загинали`);
  if (record.injured) casualties.push(`${formatNumber(record.injured)} ранени`);
  return `
    <strong>${typeLabel}</strong><br>
    ${String(record.day).padStart(2, '0')}.${String(record.month).padStart(2, '0')}.${record.year} • ${String(record.hour).padStart(2, '0')}:00ч<br>
    ${escapeHtml(getRoadClassName(record.roadClassId))}<br>
    ${casualties.length ? escapeHtml(casualties.join(' • ')) : 'Без отчетени пострадали'}
  `;
}

function renderLeafletMarkers() {
  const map = state.map.instance;
  const layerGroup = state.map.layerGroup;
  if (!map || !layerGroup) return;

  layerGroup.clearLayers();
  const { records, config } = collectMapSourceRecords({ sample: true, useBounds: true });
  state.map.renderedRecords = records;

  for (const record of records) {
    const marker = window.L.circleMarker([record.lat, record.lng], {
      renderer: state.map.renderer,
      radius: record.isMajor ? config.majorRadius : config.minorRadius,
      color: record.isMajor ? '#ffffff' : 'rgba(255,255,255,0)',
      opacity: record.isMajor ? 0.86 : 0,
      weight: record.isMajor ? config.majorBorder : 0,
      fillColor: record.isMajor ? '#ff5252' : '#ffc107',
      fillOpacity: record.isMajor ? config.majorOpacity : config.minorOpacity,
      interactive: true,
      bubblingMouseEvents: false,
    });
    marker.on('click', () => {
      selectRecord(record, { pan: true });
      marker.openPopup();
    });
    marker.bindPopup(buildMarkerPopup(record), {
      closeButton: false,
      autoPan: false,
      offset: [0, -4],
    });
    marker.addTo(layerGroup);
  }

  if (state.selectedRecord) {
    window.L.circleMarker([state.selectedRecord.lat, state.selectedRecord.lng], {
      renderer: state.map.renderer,
      radius: (state.selectedRecord.isMajor ? config.majorRadius : config.minorRadius) + 4,
      color: '#ffffff',
      opacity: 1,
      weight: 2.6,
      fillColor: state.selectedRecord.isMajor ? '#ff5252' : '#ffd54f',
      fillOpacity: 0.18,
      interactive: false,
    }).addTo(layerGroup);
  }
}

function initializeLeafletMap() {
  if (state.map.instance || !elements.mapLeaflet || !window.L) return;

  const map = window.L.map(elements.mapLeaflet, {
    zoomControl: false,
    attributionControl: false,
    preferCanvas: true,
    minZoom: 6,
    maxZoom: 18,
  });

  map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);

  window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    detectRetina: true,
    crossOrigin: true,
  }).addTo(map);

  state.map.instance = map;
  state.map.renderer = window.L.canvas({ padding: 0.5 });
  state.map.layerGroup = window.L.layerGroup().addTo(map);

  map.on('zoomend moveend', () => {
    renderLeafletMarkers();
  });

  map.on('click', (event) => {
    const nearest = findNearestRecordFromLatLng(event.latlng);
    if (nearest) {
      selectRecord(nearest, { pan: true });
    }
  });
}

function renderSelectedIncident() {
  if (!state.selectedRecord) {
    elements.selectedCard.hidden = true;
    elements.selectedEmpty.hidden = false;
    return;
  }

  const record = state.selectedRecord;
  const typeLabel = record.isMajor ? 'Тежко ПТП' : 'Леко ПТП';
  const roadClassLabel = getRoadClassName(record.roadClassId);
  const time = `${String(record.day).padStart(2, '0')}.${String(record.month).padStart(2, '0')}.${record.year} • ${String(record.hour).padStart(2, '0')}:00ч`;

  elements.selectedEmpty.hidden = true;
  elements.selectedCard.hidden = false;
  elements.selectedMeta.innerHTML = `
    <div class="incident-headline ${record.isMajor ? 'major' : 'minor'}">
      <span class="material-icons-round">${record.isMajor ? 'warning_amber' : 'info'}</span>
      <div>
        <div class="incident-type">${typeLabel}</div>
        <div class="incident-time">${time}</div>
      </div>
    </div>
    <div class="incident-road">${escapeHtml(roadClassLabel)}</div>
  `;
  elements.selectedCasualties.innerHTML = `
    <div class="incident-metric">
      <span class="incident-metric-label">Загинали</span>
      <strong>${formatNumber(record.died)}</strong>
    </div>
    <div class="incident-metric">
      <span class="incident-metric-label">Ранени</span>
      <strong>${formatNumber(record.injured)}</strong>
    </div>
  `;
  elements.selectedCoords.textContent = `${record.lat.toFixed(5)}, ${record.lng.toFixed(5)}`;
  elements.selectedAction.href = `https://www.google.com/maps?q=${record.lat},${record.lng}`;
}

function renderMapSummary() {
  const visibleSummary = buildSummary(state.filteredRecords);
  if (
    state.selectedRecord &&
    ((state.selectedRecord.isMajor && !state.showMajor) ||
      (!state.selectedRecord.isMajor && !state.showMinor))
  ) {
    state.selectedRecord = null;
  }
  elements.mapSummary.textContent = `${selectedRangeLabel()} • ${formatNumber(visibleSummary.total)} инцидента • ${visibleSummary.major} тежки`;
  elements.majorToggle.classList.toggle('active', state.showMajor);
  elements.minorToggle.classList.toggle('active', state.showMinor);
  renderSelectedIncident();
  renderLeafletMarkers();
}

function renderSeverity() {
  const summary = buildSummary(state.filteredRecords);
  const total = Math.max(summary.total, 1);
  const majorPercent = (summary.major / total) * 100;
  elements.severityDonut.style.setProperty('--major-percent', `${majorPercent}%`);
  elements.severityDonut.innerHTML = `
    <div class="severity-center">
      <strong>${formatNumber(summary.total)}</strong>
      <span>инцидента</span>
    </div>
  `;
  elements.severityLegend.innerHTML = `
    <div class="severity-legend-item">
      <span class="severity-dot major"></span>
      <span>Тежки • ${formatNumber(summary.major)}</span>
    </div>
    <div class="severity-legend-item">
      <span class="severity-dot minor"></span>
      <span>Леки • ${formatNumber(summary.minor)}</span>
    </div>
  `;
}

function renderCasualties() {
  const summary = buildSummary(state.filteredRecords);
  const maxValue = Math.max(summary.died, summary.injured, 1);
  const items = [
    { label: 'Загинали', value: summary.died, tone: 'fatal' },
    { label: 'Ранени', value: summary.injured, tone: 'warn' },
  ];

  elements.casualtyBars.innerHTML = items.map((item) => `
    <div class="inline-metric-row">
      <div class="inline-metric-label">${item.label}</div>
      <div class="inline-metric-track">
        <span class="inline-metric-fill ${item.tone}" style="width:${((item.value / maxValue) * 100).toFixed(1)}%"></span>
      </div>
      <div class="inline-metric-value">${formatNumber(item.value)}</div>
    </div>
  `).join('');
}

function renderVerticalBars(target, values, labels, { weekend = false, maxLabelsEvery = 1, compact = false } = {}) {
  const max = Math.max(...values, 1);
  target.innerHTML = values.map((value, index) => {
    const ratio = value / max;
    const weekendTone = weekend && index >= 5;
    return `
      <div class="mini-bar-wrap${compact ? ' compact' : ''}">
        <div class="mini-bar-value">${formatNumber(value)}</div>
        <div class="mini-bar ${weekendTone ? 'weekend' : ''}" style="height:${(18 + (ratio * 118)).toFixed(1)}px"></div>
        <div class="mini-bar-label">${labels[index]}</div>
      </div>
    `;
  }).join('');
}

function renderDetails() {
  renderSeverity();
  renderCasualties();

  const byMonth = Array.from({ length: 12 }, () => 0);
  const byHour = Array.from({ length: 24 }, () => 0);
  const byWeekday = Array.from({ length: 7 }, () => 0);
  const roadClassCounts = new Map();

  for (const record of state.filteredRecords) {
    if (record.month >= 1 && record.month <= 12) {
      byMonth[record.month - 1] += 1;
    }
    if (record.hour >= 0 && record.hour <= 23) {
      byHour[record.hour] += 1;
    }
    try {
      const weekday = new Date(record.year, record.month - 1, record.day).getDay();
      const normalized = weekday === 0 ? 6 : weekday - 1;
      byWeekday[normalized] += 1;
    } catch (error) {
      console.warn('Weekday calculation failed:', error);
    }
    const roadClass = getRoadClassName(record.roadClassId);
    roadClassCounts.set(roadClass, (roadClassCounts.get(roadClass) || 0) + 1);
  }

  renderVerticalBars(elements.monthlyBars, byMonth, MONTH_LABELS, { maxLabelsEvery: 1 });
  renderVerticalBars(elements.weekdayBars, byWeekday, WEEKDAY_LABELS, { weekend: true });
  renderVerticalBars(
    elements.hourlyBars,
    byHour,
    HOUR_LABELS.map((label, index) => index % 6 === 0 ? label.replace(':00', 'ч') : '·'),
    { compact: true },
  );

  const sortedRoadClasses = [...roadClassCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 8);

  const roadClassMax = Math.max(...sortedRoadClasses.map((item) => item.count), 1);
  elements.roadClassList.innerHTML = sortedRoadClasses.map((item) => `
    <div class="road-class-row">
      <div class="road-class-head">
        <span>${escapeHtml(item.label)}</span>
        <strong>${formatNumber(item.count)}</strong>
      </div>
      <div class="road-class-track">
        <span class="road-class-fill" style="width:${((item.count / roadClassMax) * 100).toFixed(1)}%"></span>
      </div>
    </div>
  `).join('');
}

function renderActiveTab() {
  elements.tabs.forEach((button) => {
    const active = button.dataset.blackTab === state.activeTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });

  elements.views.forEach((view) => {
    view.hidden = view.dataset.blackView !== state.activeTab;
  });

  if (state.activeTab === 'map' && state.map.instance) {
    window.setTimeout(() => {
      state.map.instance.invalidateSize(false);
      if (!state.map.hasFitted) {
        fitMapToVisibleRecords();
        state.map.hasFitted = true;
      }
      renderLeafletMarkers();
    }, 0);
  }
}

function renderAll() {
  renderYearFilters();
  syncFilterInputs();
  renderStats();
  renderComparison();
  renderTrend();
  renderHotspots();
  renderMapSummary();
  renderDetails();
  renderActiveTab();
}

function registerStaticListeners() {
  elements.monthFilter.addEventListener('change', () => {
    const nextMonth = elements.monthFilter.value ? Number.parseInt(elements.monthFilter.value, 10) : null;
    state.selectedMonth = Number.isFinite(nextMonth) ? nextMonth : null;
    applyFilters();
  });

  elements.comparisonFilter.addEventListener('change', () => {
    const nextYear = elements.comparisonFilter.value ? Number.parseInt(elements.comparisonFilter.value, 10) : null;
    state.comparisonYear = Number.isFinite(nextYear) ? nextYear : null;
    applyFilters();
  });

  elements.tabs.forEach((button) => {
    button.addEventListener('click', () => {
      state.activeTab = button.dataset.blackTab || 'overview';
      renderActiveTab();
    });
  });

  elements.majorToggle.addEventListener('click', () => {
    state.showMajor = !state.showMajor;
    renderMapSummary();
  });

  elements.minorToggle.addEventListener('click', () => {
    state.showMinor = !state.showMinor;
    renderMapSummary();
  });

  elements.mapZoomFit.addEventListener('click', () => {
    fitMapToVisibleRecords();
  });
  elements.mapZoomIn.addEventListener('click', () => {
    if (state.map.instance) {
      state.map.instance.setZoom(getMapZoom() + 1);
    }
  });
  elements.mapZoomOut.addEventListener('click', () => {
    if (state.map.instance) {
      state.map.instance.setZoom(getMapZoom() - 1);
    }
  });

  window.addEventListener('resize', () => {
    if (state.map.instance) {
      state.map.instance.invalidateSize(false);
      renderLeafletMarkers();
    }
  });
}

async function boot() {
  try {
    const snapshot = await fetchJson(SNAPSHOT_URL);
    state.snapshot = snapshot;
    state.records = snapshot.records.map(decodeRecord);

    for (const record of state.records) {
      const key = String(record.year);
      const bucket = state.recordsByYear.get(key);
      if (bucket) {
        bucket.push(record);
      } else {
        state.recordsByYear.set(key, [record]);
      }

      const dayCapKey = `${record.year}-${record.month}`;
      const currentDayCap = state.dayCapsByYearMonth.get(dayCapKey) || 0;
      if (record.day > currentDayCap) {
        state.dayCapsByYearMonth.set(dayCapKey, record.day);
      }
    }

    state.selectedYear = snapshot.meta.years[snapshot.meta.years.length - 1];
    updateComparisonForYear();

    if (elements.updated) {
      elements.updated.textContent = `Обновено: ${formatDate(snapshot.meta.sourceGeneratedAt)} • сайт: ${formatDate(snapshot.meta.snapshotGeneratedAt)}`;
    }

    initializeLeafletMap();
    registerStaticListeners();
    applyFilters();
    elements.error.hidden = true;
  } catch (error) {
    console.error('Black map failed to load:', error);
    if (elements.error) {
      elements.error.hidden = false;
      elements.error.textContent = 'Не успяхме да заредим Черна Карта в момента.';
    }
  }
}

boot();
