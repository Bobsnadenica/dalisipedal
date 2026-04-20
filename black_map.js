const SNAPSHOT_URL = 'data/black-map-snapshot.json';
const OUTLINE_URL = 'background/bulgaria-outline.json';
const VIEWBOX = Object.freeze({
  width: 1000,
  height: 660,
  paddingX: 96,
  paddingY: 82,
});

const MONTH_LABELS = ['Яну', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'];
const HOUR_LABELS = Array.from({ length: 24 }, (_, index) => `${String(index).padStart(2, '0')}:00`);

const state = {
  snapshot: null,
  outline: null,
  selectedYear: 'all',
};

const elements = {
  updated: document.getElementById('black-map-updated'),
  yearFilters: document.getElementById('year-filters'),
  stats: document.getElementById('black-map-stats'),
  map: document.getElementById('black-map-stage'),
  monthChart: document.getElementById('black-map-months'),
  hourChart: document.getElementById('black-map-hours'),
  roadClasses: document.getElementById('black-map-road-classes'),
  hotspots: document.getElementById('black-map-hotspots'),
  summaryLead: document.getElementById('black-map-summary'),
  error: document.getElementById('black-map-error'),
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
  return `${points.map(([lat, lng], index) => {
    const point = project(lat, lng);
    return `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }).join(' ')} Z`;
}

function getCurrentKey() {
  return state.selectedYear || 'all';
}

function getCurrentSummary() {
  return state.snapshot.summaryByYear[getCurrentKey()] || state.snapshot.summaryByYear.all;
}

function getCurrentMonthly() {
  return state.snapshot.monthlyByYear[getCurrentKey()] || state.snapshot.monthlyByYear.all;
}

function getCurrentHourly() {
  return state.snapshot.hourlyByYear[getCurrentKey()] || state.snapshot.hourlyByYear.all;
}

function getCurrentRoadClasses() {
  return state.snapshot.roadClassesByYear[getCurrentKey()] || state.snapshot.roadClassesByYear.all;
}

function getCurrentHeatmap() {
  return state.snapshot.heatmapByYear[getCurrentKey()] || state.snapshot.heatmapByYear.all;
}

function getCurrentHotspots() {
  return state.snapshot.hotspotsByYear[getCurrentKey()] || state.snapshot.hotspotsByYear.all;
}

function renderYearFilters() {
  const options = ['all', ...state.snapshot.meta.years.map(String)];
  elements.yearFilters.innerHTML = options.map((key) => {
    const active = key === getCurrentKey();
    const label = key === 'all' ? 'Общо' : key;
    return `
      <button class="year-pill${active ? ' active' : ''}" type="button" data-year="${key}">
        ${label}
      </button>
    `;
  }).join('');

  elements.yearFilters.querySelectorAll('[data-year]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedYear = button.dataset.year || 'all';
      renderAll();
    });
  });
}

function renderStats() {
  const summary = getCurrentSummary();
  const cards = [
    {
      label: 'Инциденти',
      value: formatNumber(summary.total),
      tone: 'neutral',
      copy: state.selectedYear === 'all' ? 'за всички налични години' : `за ${state.selectedYear}`,
    },
    {
      label: 'Тежки ПТП',
      value: formatNumber(summary.major),
      tone: 'danger',
      copy: `${summary.majorRate}% от всички записи`,
    },
    {
      label: 'Загинали',
      value: formatNumber(summary.died),
      tone: 'fatal',
      copy: 'по наличните публични записи',
    },
    {
      label: 'Ранени',
      value: formatNumber(summary.injured),
      tone: 'warn',
      copy: 'регистрирани пострадали',
    },
  ];

  elements.stats.innerHTML = cards.map((card) => `
    <article class="black-stat-card ${card.tone}">
      <div class="black-stat-label">${card.label}</div>
      <div class="black-stat-value">${card.value}</div>
      <div class="black-stat-copy">${card.copy}</div>
    </article>
  `).join('');

  elements.summaryLead.textContent = state.selectedYear === 'all'
    ? 'Поглед върху общата картина по официалните публични данни за ПТП в България.'
    : `Фокус върху ${state.selectedYear} с карта, сезонност и най-рискови участъци.`;
}

function renderMap() {
  const heatmap = getCurrentHeatmap();
  const bounds = state.snapshot.meta.grid.bounds;
  const project = createProjection(state.outline);
  const outlinePath = buildOutlinePath(state.outline, project);
  const latRange = bounds.maxLat - bounds.minLat;
  const lngRange = bounds.maxLng - bounds.minLng;
  const maxWeight = Math.max(heatmap.maxWeight || 1, 1);

  const cells = [...heatmap.cells]
    .sort((left, right) => left[6] - right[6])
    .map(([x, y, total, major, died, injured, weight]) => {
      const lat = bounds.maxLat - (((y + 0.5) / state.snapshot.meta.grid.rows) * latRange);
      const lng = bounds.minLng + (((x + 0.5) / state.snapshot.meta.grid.cols) * lngRange);
      const projected = project(lat, lng);
      const intensity = Math.max(weight / maxWeight, 0.04);
      const radius = 5 + (intensity * 30);
      const coreRadius = Math.max(2.5, radius * 0.42);
      const warmOpacity = Math.min(0.72, 0.16 + (intensity * 0.5));
      const coreOpacity = Math.min(0.92, 0.22 + (intensity * 0.6));
      const majorRatio = total ? (major / total) : 0;

      return `
        <g class="heat-node" aria-hidden="true">
          <title>${total} инцидента | тежки: ${major} | загинали: ${died} | ранени: ${injured}</title>
          <circle cx="${projected.x.toFixed(2)}" cy="${projected.y.toFixed(2)}" r="${radius.toFixed(2)}" fill="rgba(255, 59, 48, ${warmOpacity.toFixed(3)})" filter="url(#blackHeatBlur)"></circle>
          <circle cx="${projected.x.toFixed(2)}" cy="${projected.y.toFixed(2)}" r="${coreRadius.toFixed(2)}" fill="${majorRatio > 0.35 ? `rgba(255, 183, 3, ${coreOpacity.toFixed(3)})` : `rgba(255, 221, 87, ${Math.max(0.22, coreOpacity - 0.18).toFixed(3)})`}" filter="url(#blackHeatGlow)"></circle>
        </g>
      `;
    }).join('');

  const cityLabels = [
    { name: 'София', lat: 42.6977, lng: 23.3219, dx: -20, dy: -10 },
    { name: 'Пловдив', lat: 42.1354, lng: 24.7453, dx: -24, dy: 18 },
    { name: 'Варна', lat: 43.2141, lng: 27.9147, dx: -12, dy: -12 },
    { name: 'Бургас', lat: 42.5048, lng: 27.4626, dx: -8, dy: 18 },
    { name: 'Русе', lat: 43.8356, lng: 25.9657, dx: -8, dy: -12 },
  ].map((city) => {
    const projected = project(city.lat, city.lng);
    return `<text class="black-map-city" x="${(projected.x + city.dx).toFixed(2)}" y="${(projected.y + city.dy).toFixed(2)}">${city.name}</text>`;
  }).join('');

  elements.map.innerHTML = `
    <svg viewBox="0 0 ${VIEWBOX.width} ${VIEWBOX.height}" role="img" aria-label="Черна карта на пътни инциденти в България">
      <defs>
        <filter id="blackHeatBlur" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="16"></feGaussianBlur>
        </filter>
        <filter id="blackHeatGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="7"></feGaussianBlur>
        </filter>
        <clipPath id="blackMapClip">
          <path d="${outlinePath}"></path>
        </clipPath>
        <linearGradient id="mapNight" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="rgba(22, 36, 54, 0.95)"></stop>
          <stop offset="100%" stop-color="rgba(9, 11, 15, 0.92)"></stop>
        </linearGradient>
      </defs>
      <g clip-path="url(#blackMapClip)">
        <rect x="0" y="0" width="${VIEWBOX.width}" height="${VIEWBOX.height}" fill="url(#mapNight)" opacity="0.25"></rect>
        ${cells}
      </g>
      <path class="black-map-outline-glow" d="${outlinePath}"></path>
      <path class="black-map-outline" d="${outlinePath}"></path>
      <text class="black-map-label" x="108" y="102">ЧЕРНА КАРТА</text>
      ${cityLabels}
    </svg>
  `;
}

function renderBars(target, values, labels, mode) {
  const max = Math.max(...values, 1);
  target.innerHTML = values.map((value, index) => {
    const ratio = value / max;
    const height = 18 + (ratio * 100);
    const tone = mode === 'hours'
      ? `rgba(255, ${Math.round(168 + (ratio * 60))}, ${Math.round(64 - (ratio * 32))}, 0.95)`
      : `rgba(${Math.round(115 + (ratio * 120))}, ${Math.round(70 + (ratio * 90))}, ${Math.round(60 - (ratio * 18))}, 0.95)`;

    return `
      <div class="metric-bar-wrap">
        <div class="metric-bar-value">${formatNumber(value)}</div>
        <div class="metric-bar" style="height:${height.toFixed(1)}px;background:${tone};"></div>
        <div class="metric-bar-label">${labels[index]}</div>
      </div>
    `;
  }).join('');
}

function renderRoadClasses() {
  const roadClasses = getCurrentRoadClasses();
  if (!roadClasses.length) {
    elements.roadClasses.innerHTML = '<p class="empty-copy">Няма налични данни за тип път в този срез.</p>';
    return;
  }

  const max = Math.max(...roadClasses.map((item) => item.count), 1);
  elements.roadClasses.innerHTML = roadClasses.map((item) => `
    <div class="road-class-row">
      <div class="road-class-head">
        <span>${item.label}</span>
        <strong>${formatNumber(item.count)}</strong>
      </div>
      <div class="road-class-track">
        <span class="road-class-fill" style="width:${((item.count / max) * 100).toFixed(1)}%"></span>
      </div>
    </div>
  `).join('');
}

function renderHotspots() {
  const hotspots = getCurrentHotspots();
  if (!hotspots.length) {
    elements.hotspots.innerHTML = '<p class="empty-copy">Няма достатъчно географски записи за карта в този срез.</p>';
    return;
  }

  elements.hotspots.innerHTML = hotspots.map((spot, index) => `
    <article class="hotspot-card">
      <div class="hotspot-rank">#${index + 1}</div>
      <div class="hotspot-body">
        <div class="hotspot-name">${spot.label}</div>
        <div class="hotspot-meta">${formatNumber(spot.total)} инцидента • ${spot.major} тежки • ${spot.died} загинали</div>
        <div class="hotspot-coords">${spot.lat.toFixed(3)}, ${spot.lng.toFixed(3)}</div>
      </div>
    </article>
  `).join('');
}

function renderAll() {
  renderYearFilters();
  renderStats();
  renderMap();
  renderBars(elements.monthChart, getCurrentMonthly(), MONTH_LABELS, 'months');
  renderBars(elements.hourChart, getCurrentHourly(), HOUR_LABELS, 'hours');
  renderRoadClasses();
  renderHotspots();
}

async function boot() {
  try {
    const [snapshot, outline] = await Promise.all([
      fetchJson(SNAPSHOT_URL),
      fetchJson(OUTLINE_URL),
    ]);

    state.snapshot = snapshot;
    state.outline = outline;

    if (elements.updated) {
      elements.updated.textContent = `Обновено: ${formatDate(snapshot.meta.sourceGeneratedAt)} • web snapshot: ${formatDate(snapshot.meta.snapshotGeneratedAt)}`;
    }

    renderAll();
  } catch (error) {
    console.error('Black map failed to load:', error);
    if (elements.error) {
      elements.error.hidden = false;
      elements.error.textContent = 'Не успяхме да заредим Черна Карта в момента.';
    }
  }
}

boot();
