const SNAPSHOT_URL = 'data/black-map-snapshot.json';
const OUTLINE_URL = 'background/bulgaria-outline.json';
const VIEWBOX = Object.freeze({
  width: 1000,
  height: 660,
  paddingX: 96,
  paddingY: 82,
});

const MONTH_LABELS = ['Яну', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'];
const MONTH_LABELS_LONG = ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни', 'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];
const WEEKDAY_LABELS = ['Пон', 'Вто', 'Сря', 'Чет', 'Пет', 'Съб', 'Нед'];
const CITY_HINTS = [
  { name: 'София', lat: 42.6977, lng: 23.3219, dx: -20, dy: -10 },
  { name: 'Пловдив', lat: 42.1354, lng: 24.7453, dx: -24, dy: 18 },
  { name: 'Варна', lat: 43.2141, lng: 27.9147, dx: -12, dy: -12 },
  { name: 'Бургас', lat: 42.5048, lng: 27.4626, dx: -8, dy: 18 },
  { name: 'Русе', lat: 43.8356, lng: 25.9657, dx: -8, dy: -12 },
  { name: 'Стара Загора', lat: 42.4258, lng: 25.6345, dx: -24, dy: 18 },
];

const state = {
  snapshot: null,
  outline: null,
  project: null,
  outlinePath: '',
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
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    dragActive: false,
    startClientX: 0,
    startClientY: 0,
    lastClientX: 0,
    lastClientY: 0,
    pointerId: null,
    raf: null,
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
  mapSvg: document.getElementById('black-map-svg'),
  mapSvgLayer: document.getElementById('black-map-svg-layer'),
  mapCanvas: document.getElementById('black-map-canvas'),
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

function createProjection(points) {
  const bounds = points.reduce((accumulator, [lat, lng]) => ({
    minLat: Math.min(accumulator.minLat, lat),
    maxLat: Math.max(accumulator.maxLat, lat),
    minLng: Math.min(accumulator.minLng, lng),
    maxLng: Math.max(accumulator.maxLng, lng),
  }), {
    minLat: Number.POSITIVE_INFINITY,
    maxLat: Number.NEGATIVE_INFINITY,
    minLng: Number.POSITIVE_INFINITY,
    maxLng: Number.NEGATIVE_INFINITY,
  });

  const latRange = Math.max(bounds.maxLat - bounds.minLat, 0.000001);
  const lngRange = Math.max(bounds.maxLng - bounds.minLng, 0.000001);
  const usableWidth = VIEWBOX.width - (VIEWBOX.paddingX * 2);
  const usableHeight = VIEWBOX.height - (VIEWBOX.paddingY * 2);
  const scale = Math.min(usableWidth / lngRange, usableHeight / latRange);
  const projectedWidth = lngRange * scale;
  const projectedHeight = latRange * scale;
  const offsetX = (VIEWBOX.width - projectedWidth) / 2;
  const offsetY = (VIEWBOX.height - projectedHeight) / 2;

  return function project(lat, lng) {
    return {
      x: offsetX + ((lng - bounds.minLng) * scale),
      y: offsetY + ((bounds.maxLat - lat) * scale),
    };
  };
}

function buildOutlinePath(points, project) {
  if (!points.length) return '';
  return `${points.map(([lat, lng], index) => {
    const point = project(lat, lng);
    return `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }).join(' ')} Z`;
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

function buildMapBase() {
  const cityLabels = CITY_HINTS.map((city) => {
    const projected = state.project(city.lat, city.lng);
    return `<text class="black-map-city" x="${(projected.x + city.dx).toFixed(2)}" y="${(projected.y + city.dy).toFixed(2)}">${city.name}</text>`;
  }).join('');

  elements.mapSvg.innerHTML = `
    <defs>
      <clipPath id="blackMapClip">
        <path d="${state.outlinePath}"></path>
      </clipPath>
    </defs>
    <g id="black-map-svg-layer">
      <g clip-path="url(#blackMapClip)">
        <rect x="0" y="0" width="${VIEWBOX.width}" height="${VIEWBOX.height}" class="black-map-surface"></rect>
      </g>
      <path class="black-map-outline-glow" d="${state.outlinePath}"></path>
      <path class="black-map-outline" d="${state.outlinePath}"></path>
      <text class="black-map-label" x="112" y="102">ЧЕРНА КАРТА</text>
      ${cityLabels}
    </g>
  `;

  elements.mapSvgLayer = document.getElementById('black-map-svg-layer');
  updateMapTransformLayer();
}

function updateMapTransformLayer() {
  const { scale, offsetX, offsetY } = state.map;
  if (elements.mapSvgLayer) {
    elements.mapSvgLayer.setAttribute('transform', `matrix(${scale} 0 0 ${scale} ${offsetX} ${offsetY})`);
  }
}

function getVisibleMapRecords() {
  const visible = [];
  const major = [];
  const minor = [];
  for (const record of state.filteredRecords) {
    if (record.isMajor) {
      major.push(record);
    } else {
      minor.push(record);
    }
  }

  const scale = state.map.scale;
  let minorStep = 20;
  if (scale > 1.3) minorStep = 10;
  if (scale > 2.1) minorStep = 4;
  if (scale > 3.2) minorStep = 1;

  let majorStep = 1;
  if (scale < 1.15) majorStep = 4;
  else if (scale < 1.8) majorStep = 2;

  if (state.showMinor) {
    for (let index = 0; index < minor.length; index += minorStep) {
      visible.push(minor[index]);
    }
  }

  if (state.showMajor) {
    for (let index = 0; index < major.length; index += majorStep) {
      visible.push(major[index]);
    }
  }

  return visible;
}

function drawMap() {
  const ctx = elements.mapCanvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = elements.mapStage.clientWidth;
  const cssHeight = elements.mapStage.clientHeight;
  elements.mapCanvas.width = Math.round(cssWidth * dpr);
  elements.mapCanvas.height = Math.round(cssHeight * dpr);
  elements.mapCanvas.style.width = `${cssWidth}px`;
  elements.mapCanvas.style.height = `${cssHeight}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const scaleToCssX = cssWidth / VIEWBOX.width;
  const scaleToCssY = cssHeight / VIEWBOX.height;
  ctx.save();
  ctx.scale(scaleToCssX, scaleToCssY);
  ctx.translate(state.map.offsetX, state.map.offsetY);
  ctx.scale(state.map.scale, state.map.scale);

  const visibleRecords = getVisibleMapRecords();
  for (const record of visibleRecords) {
    const projected = state.project(record.lat, record.lng);
    const radius = record.isMajor ? 5.6 : 3.2;
    ctx.beginPath();
    ctx.fillStyle = record.isMajor ? 'rgba(255, 82, 82, 0.85)' : 'rgba(255, 193, 7, 0.38)';
    ctx.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
    ctx.fill();

    if (record.isMajor && state.map.scale > 1.2) {
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(255,255,255,0.68)';
      ctx.stroke();
    }
  }

  if (state.selectedRecord) {
    const projected = state.project(state.selectedRecord.lat, state.selectedRecord.lng);
    ctx.beginPath();
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = state.selectedRecord.isMajor ? 'rgba(255, 82, 82, 1)' : 'rgba(255, 193, 7, 0.95)';
    ctx.arc(projected.x, projected.y, state.selectedRecord.isMajor ? 8.6 : 7.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
  updateMapTransformLayer();
}

function scheduleMapDraw() {
  if (state.map.raf) return;
  state.map.raf = window.requestAnimationFrame(() => {
    state.map.raf = null;
    drawMap();
  });
}

function zoomMap(factor, centerX = VIEWBOX.width / 2, centerY = VIEWBOX.height / 2) {
  const nextScale = Math.max(1, Math.min(5.6, state.map.scale * factor));
  const actualFactor = nextScale / state.map.scale;
  state.map.offsetX = centerX - ((centerX - state.map.offsetX) * actualFactor);
  state.map.offsetY = centerY - ((centerY - state.map.offsetY) * actualFactor);
  state.map.scale = nextScale;
  scheduleMapDraw();
}

function resetMapView() {
  state.map.scale = 1;
  state.map.offsetX = 0;
  state.map.offsetY = 0;
  scheduleMapDraw();
}

function getViewboxPointFromEvent(event) {
  const rect = elements.mapStage.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * VIEWBOX.width,
    y: ((event.clientY - rect.top) / rect.height) * VIEWBOX.height,
    rect,
  };
}

function findNearestVisibleRecord(worldX, worldY) {
  const threshold = 18 / Math.max(state.map.scale, 1);
  const visibleRecords = getVisibleMapRecords();
  let nearest = null;
  let minDistance = Number.POSITIVE_INFINITY;

  for (const record of visibleRecords) {
    const point = state.project(record.lat, record.lng);
    const distance = Math.hypot(worldX - point.x, worldY - point.y);
    const biased = record.isMajor ? distance * 0.8 : distance;
    if (distance <= threshold && biased < minDistance) {
      minDistance = biased;
      nearest = record;
    }
  }

  return nearest;
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
  scheduleMapDraw();
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

  if (state.activeTab === 'map') {
    scheduleMapDraw();
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

  elements.mapZoomFit.addEventListener('click', resetMapView);
  elements.mapZoomIn.addEventListener('click', () => zoomMap(1.22));
  elements.mapZoomOut.addEventListener('click', () => zoomMap(1 / 1.22));

  elements.mapStage.addEventListener('wheel', (event) => {
    event.preventDefault();
    const point = getViewboxPointFromEvent(event);
    zoomMap(event.deltaY < 0 ? 1.14 : 1 / 1.14, point.x, point.y);
  }, { passive: false });

  elements.mapStage.addEventListener('pointerdown', (event) => {
    state.map.dragActive = true;
    state.map.pointerId = event.pointerId;
    state.map.startClientX = event.clientX;
    state.map.startClientY = event.clientY;
    state.map.lastClientX = event.clientX;
    state.map.lastClientY = event.clientY;
    elements.mapStage.setPointerCapture(event.pointerId);
  });

  elements.mapStage.addEventListener('pointermove', (event) => {
    if (!state.map.dragActive || state.map.pointerId !== event.pointerId) return;
    const rect = elements.mapStage.getBoundingClientRect();
    const deltaX = ((event.clientX - state.map.lastClientX) / rect.width) * VIEWBOX.width;
    const deltaY = ((event.clientY - state.map.lastClientY) / rect.height) * VIEWBOX.height;
    state.map.offsetX += deltaX;
    state.map.offsetY += deltaY;
    state.map.lastClientX = event.clientX;
    state.map.lastClientY = event.clientY;
    scheduleMapDraw();
  });

  const finishPointer = (event) => {
    if (state.map.pointerId != null && event.pointerId === state.map.pointerId && elements.mapStage.hasPointerCapture(event.pointerId)) {
      elements.mapStage.releasePointerCapture(event.pointerId);
    }
    const movedDistance = Math.hypot(event.clientX - state.map.startClientX, event.clientY - state.map.startClientY);
    state.map.dragActive = false;
    state.map.pointerId = null;

    if (movedDistance > 8) {
      return;
    }

    const point = getViewboxPointFromEvent(event);
    const worldX = (point.x - state.map.offsetX) / state.map.scale;
    const worldY = (point.y - state.map.offsetY) / state.map.scale;
    const nearest = findNearestVisibleRecord(worldX, worldY);
    if (nearest) {
      state.selectedRecord = nearest;
      renderSelectedIncident();
      scheduleMapDraw();
    }
  };

  elements.mapStage.addEventListener('pointerup', finishPointer);
  elements.mapStage.addEventListener('pointercancel', () => {
    state.map.dragActive = false;
    state.map.pointerId = null;
  });

  window.addEventListener('resize', scheduleMapDraw);
}

async function boot() {
  try {
    const [snapshot, outline] = await Promise.all([
      fetchJson(SNAPSHOT_URL),
      fetchJson(OUTLINE_URL),
    ]);

    state.snapshot = snapshot;
    state.outline = outline;
    state.project = createProjection(outline);
    state.outlinePath = buildOutlinePath(outline, state.project);
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

    buildMapBase();
    registerStaticListeners();
    applyFilters();
  } catch (error) {
    console.error('Black map failed to load:', error);
    if (elements.error) {
      elements.error.hidden = false;
      elements.error.textContent = 'Не успяхме да заредим Черна Карта в момента.';
    }
  }
}

boot();
