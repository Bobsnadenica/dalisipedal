const NINJA_CONFIG = Object.freeze({
    manifestUrl: 'data/ninja-manifest.json',
    batchSize: 20,
    cacheKeyManifest: 'ninja_manifest_cache_v1',
    cacheDurationMs: 7 * 24 * 60 * 60 * 1000,
});

const ninjaState = {
    manifestItems: [],
    items: [],
    currentIndex: 0,
    nextBatchStart: 0,
    touchStartX: 0,
    touchDeltaX: 0,
};

function formatDate(timestamp) {
    if (!timestamp) {
        return 'Дата не е налична';
    }

    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
        return 'Дата не е налична';
    }

    return new Intl.DateTimeFormat('bg-BG', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(parsed);
}

function getCachedManifest() {
    try {
        const raw = localStorage.getItem(NINJA_CONFIG.cacheKeyManifest);
        if (!raw) {
            return null;
        }

        const payload = JSON.parse(raw);
        return Array.isArray(payload.items) ? payload : null;
    } catch (_) {
        return null;
    }
}

function saveManifestToCache(payload) {
    try {
        localStorage.setItem(NINJA_CONFIG.cacheKeyManifest, JSON.stringify(payload));
    } catch (_) {
        // Ignore cache failures.
    }
}

async function fetchManifest() {
    const response = await fetch(NINJA_CONFIG.manifestUrl, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload.items)) {
        throw new Error('Невалиден ninja manifest.');
    }

    return payload;
}

function updateSummary(payload, source) {
    const summaryEl = document.getElementById('ninja-summary');
    if (!summaryEl) {
        return;
    }

    const generatedAt = formatDate(payload.generatedAt);
    const itemCount = payload.itemCount || payload.items.length;

    if (source === 'cache') {
        summaryEl.textContent = `Локален fallback cache: ${itemCount} изображения, последно обновяване ${generatedAt}.`;
        return;
    }

    summaryEl.textContent = `Публичен manifest: ${itemCount} изображения, обновен ${generatedAt}.`;
}

function renderEmptyState(message) {
    const gridEl = document.getElementById('ninja-grid');
    if (!gridEl) {
        return;
    }

    gridEl.innerHTML = `
        <div class="ninja-empty">
            <strong>Няма намерени нинджи 🥷</strong><br>
            ${message}
        </div>
    `;
}

function buildCard(item, index) {
    const card = document.createElement('article');
    card.className = 'ninja-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.addEventListener('click', () => openViewer(index));
    card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openViewer(index);
        }
    });

    const media = document.createElement('div');
    media.className = 'ninja-media';

    const image = document.createElement('img');
    image.loading = 'lazy';
    image.decoding = 'async';
    image.src = item.url;
    image.alt = `Нинджа #${index + 1}`;

    const rank = document.createElement('div');
    rank.className = 'ninja-rank';
    rank.textContent = `#${index + 1}`;

    media.appendChild(image);
    media.appendChild(rank);

    const body = document.createElement('div');
    body.className = 'ninja-card-body';

    const date = document.createElement('div');
    date.className = 'ninja-date';
    date.textContent = formatDate(item.lastModified);

    const label = document.createElement('div');
    label.className = 'ninja-label';
    label.innerHTML = '<span class="material-icons-round">swipe</span><span>Плъзни за още</span>';

    body.appendChild(date);
    body.appendChild(label);

    card.appendChild(media);
    card.appendChild(body);

    return card;
}

function renderGrid(items) {
    const gridEl = document.getElementById('ninja-grid');
    if (!gridEl) {
        return;
    }

    if (!items.length) {
        renderEmptyState('Пробвай пак след малко.');
        return;
    }

    ninjaState.items = items;
    gridEl.innerHTML = '';
    items.forEach((item, index) => {
        gridEl.appendChild(buildCard(item, index));
    });
}

function pickNextBatch() {
    const items = ninjaState.manifestItems;
    if (!items.length) {
        return [];
    }

    if (items.length <= NINJA_CONFIG.batchSize) {
        ninjaState.nextBatchStart = 0;
        return [...items];
    }

    const batch = [];
    for (let offset = 0; offset < NINJA_CONFIG.batchSize; offset += 1) {
        const index = (ninjaState.nextBatchStart + offset) % items.length;
        batch.push(items[index]);
    }

    ninjaState.nextBatchStart =
        (ninjaState.nextBatchStart + NINJA_CONFIG.batchSize) % items.length;

    return batch;
}

function renderNextBatch() {
    const batch = pickNextBatch();
    if (!batch.length) {
        renderEmptyState('Пробвай пак след малко.');
        return;
    }

    renderGrid(batch);
}

async function loadManifest() {
    try {
        const payload = await fetchManifest();
        ninjaState.manifestItems = payload.items;
        ninjaState.nextBatchStart = 0;
        renderNextBatch();
        updateSummary(payload, 'network');
        saveManifestToCache({
            ...payload,
            cachedAt: Date.now(),
        });
        return true;
    } catch (error) {
        const cached = getCachedManifest();
        const cacheIsFresh =
            cached &&
            Array.isArray(cached.items) &&
            (Date.now() - (cached.cachedAt || 0)) < NINJA_CONFIG.cacheDurationMs;

        if (cacheIsFresh) {
            ninjaState.manifestItems = cached.items;
            ninjaState.nextBatchStart = 0;
            renderNextBatch();
            updateSummary(cached, 'cache');
            return true;
        }

        renderEmptyState('Не успяхме да заредим публичния manifest.');
        const summaryEl = document.getElementById('ninja-summary');
        if (summaryEl) {
            summaryEl.textContent = `Грешка при зареждане: ${error.message}`;
        }
        return false;
    }
}

function closeViewer() {
    const viewerEl = document.getElementById('ninja-viewer');
    if (!viewerEl) {
        return;
    }

    viewerEl.classList.remove('is-open');
    viewerEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('viewer-open');
}

function renderViewerItem() {
    const item = ninjaState.items[ninjaState.currentIndex];
    const stageEl = document.getElementById('ninja-viewer-stage');
    const countEl = document.getElementById('ninja-viewer-count');
    const dateEl = document.getElementById('ninja-viewer-date');
    const prevBtn = document.getElementById('ninja-viewer-prev');
    const nextBtn = document.getElementById('ninja-viewer-next');

    if (!item || !stageEl || !countEl || !dateEl) {
        return;
    }

    stageEl.innerHTML = '';

    const image = document.createElement('img');
    image.className = 'ninja-viewer-media';
    image.src = item.url;
    image.alt = `Нинджа #${ninjaState.currentIndex + 1}`;
    stageEl.appendChild(image);

    countEl.textContent = `${ninjaState.currentIndex + 1} / ${ninjaState.items.length}`;
    dateEl.textContent = formatDate(item.lastModified);

    if (prevBtn) {
        prevBtn.disabled = ninjaState.currentIndex === 0;
    }

    if (nextBtn) {
        nextBtn.disabled = ninjaState.currentIndex >= ninjaState.items.length - 1;
    }
}

function openViewer(index) {
    ninjaState.currentIndex = index;
    const viewerEl = document.getElementById('ninja-viewer');
    if (!viewerEl) {
        return;
    }

    viewerEl.classList.add('is-open');
    viewerEl.setAttribute('aria-hidden', 'false');
    document.body.classList.add('viewer-open');
    renderViewerItem();
}

function moveViewer(step) {
    const nextIndex = ninjaState.currentIndex + step;
    if (nextIndex < 0 || nextIndex >= ninjaState.items.length) {
        return;
    }

    ninjaState.currentIndex = nextIndex;
    renderViewerItem();
}

function bindViewerEvents() {
    const viewerEl = document.getElementById('ninja-viewer');
    const closeBtn = document.getElementById('ninja-viewer-close');
    const prevBtn = document.getElementById('ninja-viewer-prev');
    const nextBtn = document.getElementById('ninja-viewer-next');

    if (!viewerEl) {
        return;
    }

    closeBtn?.addEventListener('click', closeViewer);
    prevBtn?.addEventListener('click', () => moveViewer(-1));
    nextBtn?.addEventListener('click', () => moveViewer(1));

    viewerEl.addEventListener('click', event => {
        if (event.target === viewerEl) {
            closeViewer();
        }
    });

    viewerEl.addEventListener('touchstart', event => {
        ninjaState.touchStartX = event.changedTouches[0].clientX;
        ninjaState.touchDeltaX = 0;
    });

    viewerEl.addEventListener('touchmove', event => {
        ninjaState.touchDeltaX =
            event.changedTouches[0].clientX - ninjaState.touchStartX;
    });

    viewerEl.addEventListener('touchend', () => {
        if (ninjaState.touchDeltaX <= -40) {
            moveViewer(1);
        } else if (ninjaState.touchDeltaX >= 40) {
            moveViewer(-1);
        }
    });

    document.addEventListener('keydown', event => {
        if (!viewerEl.classList.contains('is-open')) {
            return;
        }

        if (event.key === 'Escape') {
            closeViewer();
        } else if (event.key === 'ArrowLeft') {
            moveViewer(-1);
        } else if (event.key === 'ArrowRight') {
            moveViewer(1);
        }
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    bindViewerEvents();

    const refreshBtn = document.getElementById('refresh-ninja-btn');
    refreshBtn?.addEventListener('click', () => {
        if (!ninjaState.manifestItems.length) {
            loadManifest();
            return;
        }

        renderNextBatch();
    });

    await loadManifest();
});
