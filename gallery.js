const GALLERY_CONFIG = Object.freeze({
    manifestUrl: 'data/gallery-manifest.json',
    batchSize: 10,
    cacheKeyManifest: 'gallery_manifest_cache_v1',
    cacheKeySeen: 'gallery_seen_urls_v1',
    cacheDurationMs: 24 * 60 * 60 * 1000,
});

const galleryState = {
    manifestItems: [],
    currentBatch: [],
    currentIndex: 0,
    seenUrls: new Set(),
    touchStartX: 0,
    touchDeltaX: 0,
};

function isVideoFile(item) {
    return Boolean(item?.isVideo);
}

function shuffle(items) {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }
    return copy;
}

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

function getLocationLabel(item) {
    return item.locationLabel || item.location || 'Локацията не е налична';
}

function getMapsQuery(item) {
    const label = getLocationLabel(item);
    if (label && !/^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/.test(label)) {
        return label;
    }

    if (Number.isFinite(item.latitude) && Number.isFinite(item.longitude)) {
        return `${item.latitude}, ${item.longitude}`;
    }

    return label;
}

function getMapsUrl(item) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(getMapsQuery(item))}`;
}

function getCachedManifest() {
    try {
        const raw = localStorage.getItem(GALLERY_CONFIG.cacheKeyManifest);
        if (!raw) {
            return null;
        }

        const payload = JSON.parse(raw);
        if (!Array.isArray(payload.items)) {
            return null;
        }

        return payload;
    } catch (_) {
        return null;
    }
}

function saveManifestToCache(payload) {
    try {
        localStorage.setItem(GALLERY_CONFIG.cacheKeyManifest, JSON.stringify(payload));
    } catch (_) {
        // Ignore localStorage failures.
    }
}

function restoreSeenUrls() {
    try {
        const raw = localStorage.getItem(GALLERY_CONFIG.cacheKeySeen);
        const values = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(values)) {
            return;
        }

        galleryState.seenUrls = new Set(values);
    } catch (_) {
        galleryState.seenUrls = new Set();
    }
}

function persistSeenUrls() {
    try {
        localStorage.setItem(
            GALLERY_CONFIG.cacheKeySeen,
            JSON.stringify([...galleryState.seenUrls])
        );
    } catch (_) {
        // Ignore localStorage failures.
    }
}

async function fetchManifest() {
    const response = await fetch(GALLERY_CONFIG.manifestUrl, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload.items)) {
        throw new Error('Невалиден gallery manifest.');
    }

    return payload;
}

function updateSummary(payload, source) {
    const summaryEl = document.getElementById('gallery-summary');
    if (!summaryEl) {
        return;
    }

    const generatedAt = formatDate(payload.generatedAt);
    const itemCount = payload.itemCount || payload.items.length;

    if (source === 'cache') {
        summaryEl.textContent = `Локален fallback cache: ${itemCount} файла, последно обновяване ${generatedAt}. Медията се зарежда през CloudFront.`;
        return;
    }

    summaryEl.textContent = `Публичен manifest: ${itemCount} файла, обновен ${generatedAt}. Медията се зарежда през CloudFront, без live AWS заявки от браузъра.`;
}

function renderEmptyState(message) {
    const gridEl = document.getElementById('gallery-grid');
    if (!gridEl) {
        return;
    }

    gridEl.innerHTML = `
        <div class="gallery-empty">
            <strong>Галерията е празна.</strong><br>
            ${message}
        </div>
    `;
}

function pickBatch() {
    if (!galleryState.manifestItems.length) {
        return [];
    }

    let candidates = galleryState.manifestItems.filter(
        item => !galleryState.seenUrls.has(item.url)
    );

    if (candidates.length < GALLERY_CONFIG.batchSize) {
        galleryState.seenUrls.clear();
        candidates = [...galleryState.manifestItems];
    }

    const batch = shuffle(candidates).slice(0, GALLERY_CONFIG.batchSize);
    batch.forEach(item => galleryState.seenUrls.add(item.url));
    persistSeenUrls();
    return batch;
}

function createMediaPreview(item) {
    if (isVideoFile(item)) {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.src = item.url;
        return video;
    }

    const image = document.createElement('img');
    image.loading = 'lazy';
    image.decoding = 'async';
    image.src = item.url;
    image.alt = getLocationLabel(item);
    return image;
}

function buildCard(item, index) {
    const card = document.createElement('article');
    card.className = 'gallery-card';
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
    media.className = 'gallery-media';
    media.appendChild(createMediaPreview(item));

    const badge = document.createElement('div');
    badge.className = 'media-badge';
    badge.innerHTML = isVideoFile(item)
        ? '<span class="material-icons-round">play_circle</span><span>Видео</span>'
        : '<span class="material-icons-round">image</span><span>Снимка</span>';
    media.appendChild(badge);

    const body = document.createElement('div');
    body.className = 'gallery-body';

    const date = document.createElement('div');
    date.className = 'gallery-date';
    date.textContent = formatDate(item.timestamp);

    const location = document.createElement('a');
    location.className = 'gallery-location';
    location.href = getMapsUrl(item);
    location.target = '_blank';
    location.rel = 'noopener noreferrer';
    location.textContent = getLocationLabel(item);
    location.addEventListener('click', event => event.stopPropagation());

    const footer = document.createElement('div');
    footer.className = 'gallery-card-footer';

    const footerLabel = document.createElement('div');
    footerLabel.className = 'gallery-pill';
    footerLabel.innerHTML = isVideoFile(item)
        ? '<span class="material-icons-round">movie</span><span>Плъзни за още</span>'
        : '<span class="material-icons-round">swipe</span><span>Плъзни за още</span>';

    const openLabel = document.createElement('button');
    openLabel.className = 'gallery-open';
    openLabel.type = 'button';
    openLabel.textContent = 'Отвори';
    openLabel.addEventListener('click', event => {
        event.stopPropagation();
        openViewer(index);
    });

    footer.appendChild(footerLabel);
    footer.appendChild(openLabel);

    body.appendChild(date);
    body.appendChild(location);
    body.appendChild(footer);

    card.appendChild(media);
    card.appendChild(body);

    return card;
}

function renderGallery(items) {
    const gridEl = document.getElementById('gallery-grid');
    if (!gridEl) {
        return;
    }

    if (!items.length) {
        renderEmptyState('В момента няма публични файлове за показване.');
        return;
    }

    galleryState.currentBatch = items;
    gridEl.innerHTML = '';
    items.forEach((item, index) => {
        gridEl.appendChild(buildCard(item, index));
    });
}

function closeViewer() {
    const viewerEl = document.getElementById('gallery-viewer');
    if (!viewerEl) {
        return;
    }

    viewerEl.classList.remove('is-open');
    viewerEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('viewer-open');

    const stageEl = document.getElementById('gallery-viewer-stage');
    if (stageEl) {
        stageEl.innerHTML = '';
    }
}

function renderViewerItem() {
    const item = galleryState.currentBatch[galleryState.currentIndex];
    const stageEl = document.getElementById('gallery-viewer-stage');
    const dateEl = document.getElementById('gallery-viewer-date');
    const locationEl = document.getElementById('gallery-viewer-location');
    const countEl = document.getElementById('gallery-viewer-count');
    const prevBtn = document.getElementById('gallery-viewer-prev');
    const nextBtn = document.getElementById('gallery-viewer-next');

    if (!item || !stageEl || !dateEl || !locationEl || !countEl) {
        return;
    }

    stageEl.innerHTML = '';

    if (isVideoFile(item)) {
        const video = document.createElement('video');
        video.className = 'gallery-viewer-media';
        video.src = item.url;
        video.controls = true;
        video.preload = 'metadata';
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        stageEl.appendChild(video);
    } else {
        const image = document.createElement('img');
        image.className = 'gallery-viewer-media';
        image.src = item.url;
        image.alt = getLocationLabel(item);
        stageEl.appendChild(image);
    }

    dateEl.textContent = formatDate(item.timestamp);
    locationEl.textContent = getLocationLabel(item);
    locationEl.href = getMapsUrl(item);
    countEl.textContent = `${galleryState.currentIndex + 1} / ${galleryState.currentBatch.length}`;

    if (prevBtn) {
        prevBtn.disabled = galleryState.currentIndex === 0;
    }

    if (nextBtn) {
        nextBtn.disabled =
            galleryState.currentIndex >= galleryState.currentBatch.length - 1;
    }
}

function openViewer(index) {
    galleryState.currentIndex = index;

    const viewerEl = document.getElementById('gallery-viewer');
    if (!viewerEl) {
        return;
    }

    viewerEl.classList.add('is-open');
    viewerEl.setAttribute('aria-hidden', 'false');
    document.body.classList.add('viewer-open');
    renderViewerItem();
}

function moveViewer(step) {
    const nextIndex = galleryState.currentIndex + step;
    if (nextIndex < 0 || nextIndex >= galleryState.currentBatch.length) {
        return;
    }

    galleryState.currentIndex = nextIndex;
    renderViewerItem();
}

async function loadManifest() {
    try {
        const payload = await fetchManifest();
        galleryState.manifestItems = payload.items;
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
            (Date.now() - (cached.cachedAt || 0)) < GALLERY_CONFIG.cacheDurationMs;

        if (cacheIsFresh) {
            galleryState.manifestItems = cached.items;
            updateSummary(cached, 'cache');
            return true;
        }

        renderEmptyState('Не успяхме да заредим публичния manifest. Опитай пак след малко.');
        const summaryEl = document.getElementById('gallery-summary');
        if (summaryEl) {
            summaryEl.textContent = `Грешка при зареждане: ${error.message}`;
        }
        return false;
    }
}

async function renderRandomBatch() {
    if (!galleryState.manifestItems.length) {
        const ready = await loadManifest();
        if (!ready) {
            return;
        }
    }

    const batch = pickBatch();
    if (!batch.length) {
        renderEmptyState('В момента няма публични файлове за показване.');
        return;
    }

    renderGallery(batch);
}

function bindViewerEvents() {
    const viewerEl = document.getElementById('gallery-viewer');
    const closeBtn = document.getElementById('gallery-viewer-close');
    const prevBtn = document.getElementById('gallery-viewer-prev');
    const nextBtn = document.getElementById('gallery-viewer-next');

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
        galleryState.touchStartX = event.changedTouches[0].clientX;
        galleryState.touchDeltaX = 0;
    });

    viewerEl.addEventListener('touchmove', event => {
        galleryState.touchDeltaX =
            event.changedTouches[0].clientX - galleryState.touchStartX;
    });

    viewerEl.addEventListener('touchend', () => {
        if (galleryState.touchDeltaX <= -40) {
            moveViewer(1);
        } else if (galleryState.touchDeltaX >= 40) {
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
    restoreSeenUrls();
    bindViewerEvents();

    const refreshBtn = document.getElementById('refresh-gallery-btn');
    refreshBtn?.addEventListener('click', () => {
        renderRandomBatch();
    });

    await loadManifest();
    renderRandomBatch();
});
