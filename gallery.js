const GALLERY_CONFIG = Object.freeze({
    manifestUrl: 'data/gallery-manifest.json',
    batchSize: 20,
    cacheKeyManifest: 'gallery_manifest_cache_v1',
    cacheKeySeen: 'gallery_seen_urls_v1',
    cacheDurationMs: 24 * 60 * 60 * 1000,
});

const galleryState = {
    manifestItems: [],
    currentBatch: [],
    viewerItems: [],
    featuredItems: [],
    currentIndex: 0,
    commentsPanelOpen: false,
    seenUrls: new Set(),
    touchStartX: 0,
    touchDeltaX: 0,
    commentsRequestId: 0,
};

const FEATURED_PEDAL_COPY = Object.freeze({
    week: {
        cardClass: 'week',
        badgeIcon: 'wb_sunny',
        badgeText: 'Седмицата',
        title: '☀️ П.Е.Д.А.Л. на Седмицата',
        subtitle: 'Избрана изцепка за седмицата',
    },
    month: {
        cardClass: 'month',
        badgeIcon: 'emoji_events',
        badgeText: 'Месеца',
        title: '🏆 П.Е.Д.А.Л. на Месеца',
        subtitle: 'Шампионът на нахалството',
    },
});

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

function getItemTimestamp(item) {
    return item?.timestamp || item?.lastModified || '';
}

function getLocationLabel(item) {
    return item.locationLabel || item.location || 'Локацията не е налична';
}

function hasLocationData(item) {
    const label = item?.locationLabel || item?.location;
    return Boolean(label) || (
        Number.isFinite(item?.latitude) && Number.isFinite(item?.longitude)
    );
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
        summaryEl.textContent = `Локален fallback cache: ${itemCount} файла, последно обновяване ${generatedAt}.`;
        return;
    }

    summaryEl.textContent = `Публичен manifest: ${itemCount} файла, обновен ${generatedAt}.`;
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
    date.textContent = formatDate(getItemTimestamp(item));

    const location = document.createElement('a');
    location.className = 'gallery-location';
    location.href = getMapsUrl(item);
    location.target = '_blank';
    location.rel = 'noopener noreferrer';
    location.textContent = getLocationLabel(item);
    location.addEventListener('click', event => event.stopPropagation());

    const footer = document.createElement('div');
    footer.className = 'gallery-card-footer';

    const openLabel = document.createElement('button');
    openLabel.className = 'gallery-open';
    openLabel.type = 'button';
    openLabel.textContent = 'Отвори';
    openLabel.addEventListener('click', event => {
        event.stopPropagation();
        openViewer(index);
    });

    footer.appendChild(openLabel);

    body.appendChild(date);
    body.appendChild(location);
    body.appendChild(footer);

    card.appendChild(media);
    card.appendChild(body);

    return card;
}

function normalizeFeaturedItem(kind, item) {
    if (!item?.url) {
        return null;
    }

    const copy = FEATURED_PEDAL_COPY[kind];
    if (!copy) {
        return null;
    }

    return {
        ...item,
        featuredKind: kind,
        featuredTitle: copy.title,
        featuredSubtitle: copy.subtitle,
        featuredBadgeText: copy.badgeText,
        featuredBadgeIcon: copy.badgeIcon,
        featuredCardClass: copy.cardClass,
    };
}

function buildFeaturedCard(item, index) {
    const card = document.createElement('article');
    card.className = `featured-pedal-card ${item.featuredCardClass}`;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.addEventListener('click', () => openViewer(index, galleryState.featuredItems));
    card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openViewer(index, galleryState.featuredItems);
        }
    });

    const media = document.createElement('div');
    media.className = 'featured-pedal-media';
    media.appendChild(createMediaPreview(item));

    const overlay = document.createElement('div');
    overlay.className = 'featured-pedal-overlay';

    const badge = document.createElement('div');
    badge.className = `featured-pedal-badge ${item.featuredCardClass}`;
    badge.innerHTML = `
        <span class="material-icons-round">${item.featuredBadgeIcon}</span>
        <span>${item.featuredBadgeText}</span>
    `;

    const content = document.createElement('div');
    content.className = 'featured-pedal-content';

    const date = document.createElement('div');
    date.className = 'featured-pedal-date';
    date.textContent = formatDate(getItemTimestamp(item));

    const title = document.createElement('div');
    title.className = 'featured-pedal-title';
    title.textContent = item.featuredTitle;

    const subtitle = document.createElement('div');
    subtitle.className = 'featured-pedal-subtitle';
    subtitle.textContent = item.featuredSubtitle;

    const open = document.createElement('div');
    open.className = 'featured-pedal-open';
    open.innerHTML = `
        <span class="material-icons-round">open_in_full</span>
        <span>Отвори</span>
    `;

    content.appendChild(date);
    content.appendChild(title);
    content.appendChild(subtitle);
    content.appendChild(open);

    overlay.appendChild(badge);
    overlay.appendChild(content);

    card.appendChild(media);
    card.appendChild(overlay);

    return card;
}

function renderFeaturedSection(featured) {
    const sectionEl = document.getElementById('gallery-featured-section');
    const gridEl = document.getElementById('gallery-featured-grid');

    if (!sectionEl || !gridEl) {
        return;
    }

    const items = [
        normalizeFeaturedItem('week', featured?.week),
        normalizeFeaturedItem('month', featured?.month),
    ].filter(Boolean);

    galleryState.featuredItems = items;

    if (!items.length) {
        sectionEl.hidden = true;
        gridEl.innerHTML = '';
        return;
    }

    sectionEl.hidden = false;
    gridEl.innerHTML = '';
    items.forEach((item, index) => {
        gridEl.appendChild(buildFeaturedCard(item, index));
    });
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

    closeLoginModal();
    galleryState.commentsRequestId += 1;
    galleryState.commentsPanelOpen = false;
    setCommentsOverlayOpen(false);
    resetCommentsPanel();
}

function getAuthState() {
    return window.PedalAuth?.getAuthState?.() || {
        isReady: false,
        isLoading: false,
        isLoggedIn: false,
        requiresNewPassword: false,
        displayName: '',
        loginId: '',
        statusMessage: '',
        errorMessage: '',
    };
}

function openLoginModal() {
    const modalEl = document.getElementById('gallery-login-modal');
    if (!modalEl) {
        return;
    }

    const authState = getAuthState();
    if (authState.isLoggedIn) {
        document.getElementById('gallery-comment-input')?.focus();
        return;
    }

    modalEl.classList.add('is-open');
    modalEl.setAttribute('aria-hidden', 'false');
    syncLoginModalUi(authState);

    const usernameInput = document.getElementById('gallery-login-username');
    if (usernameInput && !authState.requiresNewPassword) {
        usernameInput.focus();
    }
}

function closeLoginModal() {
    const modalEl = document.getElementById('gallery-login-modal');
    if (!modalEl) {
        return;
    }

    modalEl.classList.remove('is-open');
    modalEl.setAttribute('aria-hidden', 'true');

    const passwordInput = document.getElementById('gallery-login-password');
    if (passwordInput) {
        passwordInput.value = '';
    }
}

function setLoginStatus(message, options = {}) {
    const statusEl = document.getElementById('gallery-login-status');
    if (!statusEl) {
        return;
    }

    statusEl.className = 'gallery-login-status';
    if (options.isError) {
        statusEl.classList.add('is-error');
    }

    statusEl.textContent = message || '';
    statusEl.hidden = !message;
}

function syncLoginModalUi(authState = getAuthState()) {
    const copyEl = document.querySelector('.gallery-login-copy');
    const usernameInput = document.getElementById('gallery-login-username');
    const passwordInput = document.getElementById('gallery-login-password');
    const passwordLabel = document.getElementById('gallery-login-password-label');
    const submitBtn = document.getElementById('gallery-login-submit');

    if (copyEl) {
        copyEl.textContent = authState.requiresNewPassword
            ? 'Сигурността изисква да зададете нова парола за този профил.'
            : 'Влезте с акаунта си от апликацията П.Е.Д.А.Л. Ако нямате такъв, изтеглете си апликацията и си направете за да коментирате.';
    }

    if (usernameInput) {
        if (authState.requiresNewPassword && authState.loginId) {
            usernameInput.value = authState.loginId;
        }
        usernameInput.disabled = authState.requiresNewPassword || authState.isLoading;
    }

    if (passwordLabel) {
        passwordLabel.textContent = authState.requiresNewPassword ? 'Нова парола' : 'Парола';
    }

    if (passwordInput) {
        passwordInput.placeholder = authState.requiresNewPassword
            ? 'Въведете новата парола'
            : 'Въведете парола';
        passwordInput.autocomplete = authState.requiresNewPassword ? 'new-password' : 'current-password';
        passwordInput.disabled = authState.isLoading;
    }

    if (submitBtn) {
        submitBtn.disabled = authState.isLoading;
        submitBtn.textContent = authState.isLoading
            ? (authState.requiresNewPassword ? 'Запазваме...' : 'Влизаме...')
            : (authState.requiresNewPassword ? 'Смени парола' : 'Вход');
    }

    if (authState.errorMessage) {
        setLoginStatus(authState.errorMessage, { isError: true });
    } else if (authState.statusMessage) {
        setLoginStatus(authState.statusMessage);
    } else {
        setLoginStatus('');
    }
}

function updateComposerCounter() {
    const inputEl = document.getElementById('gallery-comment-input');
    const metaEl = document.getElementById('gallery-comments-compose-meta');
    if (!inputEl || !metaEl) {
        return;
    }

    metaEl.textContent = `${inputEl.value.trim().length} / 500`;
}

function setComposerBusy(isBusy) {
    const inputEl = document.getElementById('gallery-comment-input');
    const submitBtn = document.getElementById('gallery-comment-submit');
    if (inputEl) {
        inputEl.disabled = isBusy;
    }

    if (submitBtn) {
        submitBtn.disabled = isBusy;
        submitBtn.textContent = isBusy ? 'Публикуваме...' : 'Публикувай';
    }
}

function updateCommentsAuthUi(authState = getAuthState()) {
    const noteEl = document.getElementById('gallery-comments-note');
    const sessionEl = document.getElementById('gallery-comments-session');
    const formEl = document.getElementById('gallery-comments-form');
    const loginBtn = document.querySelector('.gallery-comments-login');
    const logoutBtn = document.getElementById('gallery-comments-logout');

    if (noteEl) {
        noteEl.hidden = authState.isLoggedIn;
        noteEl.textContent = 'Вход за коментар';
    }

    if (sessionEl) {
        sessionEl.hidden = !authState.isLoggedIn;
        sessionEl.textContent = authState.isLoggedIn
            ? `Влезли сте като ${authState.displayName || authState.loginId || 'PEDAL потребител'}`
            : '';
        sessionEl.title = sessionEl.textContent;
    }

    if (formEl) {
        formEl.hidden = !authState.isLoggedIn;
    }

    if (loginBtn) {
        loginBtn.hidden = authState.isLoggedIn;
    }

    if (logoutBtn) {
        logoutBtn.hidden = !authState.isLoggedIn;
    }

    updateComposerCounter();
}

function setCommentsStatus(message, options = {}) {
    const statusEl = document.getElementById('gallery-comments-status');
    if (!statusEl) {
        return;
    }

    statusEl.className = 'pedal-comments-status';
    if (options.isError) {
        statusEl.classList.add('is-error');
    }

    statusEl.textContent = message || '';
    statusEl.hidden = !message;
}

function setCommentsCount(count) {
    const value = String(Math.max(0, Number(count) || 0));
    const ids = ['gallery-comments-count', 'gallery-comments-toggle-count'];
    ids.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    });
}

function resetCommentsPanel() {
    const listEl = document.getElementById('gallery-comments-list');
    if (listEl) {
        listEl.innerHTML = '';
    }

    setCommentsCount(0);
    setCommentsStatus('');
    updateCommentsAuthUi();
    updateComposerCounter();
}

function setCommentsOverlayOpen(isOpen, options = {}) {
    const layerEl = document.getElementById('gallery-comments-layer');
    const toggleBtn = document.getElementById('gallery-comments-toggle');
    if (!layerEl || !toggleBtn) {
        return;
    }

    galleryState.commentsPanelOpen = Boolean(isOpen);
    layerEl.classList.toggle('is-open', galleryState.commentsPanelOpen);
    layerEl.setAttribute('aria-hidden', galleryState.commentsPanelOpen ? 'false' : 'true');
    toggleBtn.setAttribute('aria-expanded', galleryState.commentsPanelOpen ? 'true' : 'false');

    if (galleryState.commentsPanelOpen) {
        updateCommentsAuthUi();
        renderCommentsForCurrentItem(options);
    }
}

function buildCommentItem(comment) {
    const itemEl = document.createElement('article');
    itemEl.className = 'pedal-comment-item';

    const headEl = document.createElement('div');
    headEl.className = 'pedal-comment-head';

    const authorEl = document.createElement('div');
    authorEl.className = 'pedal-comment-author';
    authorEl.textContent = comment.usernameSnapshot || 'Потребител';

    const metaEl = document.createElement('div');
    metaEl.className = 'pedal-comment-meta';

    const dateEl = document.createElement('div');
    dateEl.className = 'pedal-comment-date';
    dateEl.textContent = window.PedalComments?.formatCommentDate(comment.createdAt) || '';

    const bodyEl = document.createElement('div');
    bodyEl.className = 'pedal-comment-body';
    bodyEl.textContent = comment.content || '';

    metaEl.appendChild(dateEl);

    if (window.PedalComments?.canDeleteComment?.(comment)) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'pedal-comment-delete';
        deleteBtn.type = 'button';
        deleteBtn.textContent = 'Изтрий';
        deleteBtn.addEventListener('click', async event => {
            event.stopPropagation();
            const confirmed = window.confirm('Да изтрием ли този коментар?');
            if (!confirmed) {
                return;
            }

            deleteBtn.disabled = true;
            deleteBtn.textContent = '...';
            try {
                await deleteCurrentComment(comment.id);
            } finally {
                deleteBtn.disabled = false;
                deleteBtn.textContent = 'Изтрий';
            }
        });
        metaEl.appendChild(deleteBtn);
    }

    headEl.appendChild(authorEl);
    headEl.appendChild(metaEl);
    itemEl.appendChild(headEl);
    itemEl.appendChild(bodyEl);

    return itemEl;
}

function getCurrentViewerItem() {
    return galleryState.viewerItems[galleryState.currentIndex] || null;
}

function getCurrentViewerMediaKey() {
    const item = getCurrentViewerItem();
    return window.PedalComments?.normalizeMediaKey?.(item?.key || item?.url || '') || '';
}

async function renderCommentsForCurrentItem(options = {}) {
    const item = getCurrentViewerItem();
    const listEl = document.getElementById('gallery-comments-list');

    if (!item || !listEl) {
        return;
    }

    const requestId = galleryState.commentsRequestId + 1;
    galleryState.commentsRequestId = requestId;

    listEl.innerHTML = '';
    setCommentsCount(0);
    setCommentsStatus('Зареждаме коментари...');
    updateCommentsAuthUi();

    if (!window.PedalComments) {
        setCommentsStatus('Коментарите временно не са налични.', { isError: true });
        return;
    }

    try {
        const mediaKey = getCurrentViewerMediaKey();
        const comments = await window.PedalComments.listComments(mediaKey, {
            forceRefresh: Boolean(options.forceRefresh),
        });

        if (requestId !== galleryState.commentsRequestId) {
            return;
        }

        setCommentsCount(comments.length);

        if (!comments.length) {
            setCommentsStatus(getAuthState().isLoggedIn ? 'Все още няма коментари. Бъдете първи.' : 'Още няма коментари.');
            return;
        }

        setCommentsStatus('');
        comments.forEach(comment => {
            listEl.appendChild(buildCommentItem(comment));
        });
    } catch (error) {
        if (requestId !== galleryState.commentsRequestId) {
            return;
        }

        console.warn('Gallery comments failed to load:', error);
        listEl.innerHTML = '';
        setCommentsCount(0);
        setCommentsStatus('Не успяхме да заредим коментарите.', { isError: true });
    }
}

async function submitCurrentComment(event) {
    event.preventDefault();

    const authState = getAuthState();
    if (!authState.isLoggedIn) {
        openLoginModal();
        return;
    }

    const inputEl = document.getElementById('gallery-comment-input');
    if (!inputEl) {
        return;
    }

    const content = inputEl.value.trim();
    if (!content) {
        setCommentsStatus('Напишете коментар преди публикуване.', { isError: true });
        return;
    }

    const mediaKey = getCurrentViewerMediaKey();
    if (!mediaKey) {
        setCommentsStatus('Липсва валидна снимка или видео за коментара.', { isError: true });
        return;
    }

    setComposerBusy(true);
    setCommentsStatus('Публикуваме коментара...');

    try {
        await window.PedalComments.postComment(mediaKey, content);
        inputEl.value = '';
        updateComposerCounter();
        await renderCommentsForCurrentItem({ forceRefresh: true });
        inputEl.focus();
    } catch (error) {
        setCommentsStatus(error?.message || 'Не успяхме да публикуваме коментара.', { isError: true });
    } finally {
        setComposerBusy(false);
    }
}

async function deleteCurrentComment(commentId) {
    const mediaKey = getCurrentViewerMediaKey();
    setCommentsStatus('Изтриваме коментара...');

    try {
        await window.PedalComments.removeComment(commentId, mediaKey);
        await renderCommentsForCurrentItem({ forceRefresh: true });
    } catch (error) {
        setCommentsStatus(error?.message || 'Не успяхме да изтрием коментара.', { isError: true });
    }
}

async function submitLogin(event) {
    event.preventDefault();

    if (!window.PedalAuth) {
        setLoginStatus('Входът временно не е наличен.', { isError: true });
        return;
    }

    const authState = getAuthState();
    const usernameInput = document.getElementById('gallery-login-username');
    const passwordInput = document.getElementById('gallery-login-password');
    const username = usernameInput?.value || '';
    const password = passwordInput?.value || '';

    try {
        if (authState.requiresNewPassword) {
            await window.PedalAuth.completeNewPassword(password);
        } else {
            await window.PedalAuth.signIn(username, password);
        }

        const nextState = getAuthState();
        syncLoginModalUi(nextState);

        if (nextState.isLoggedIn) {
            closeLoginModal();
            updateCommentsAuthUi(nextState);
            if (galleryState.commentsPanelOpen) {
                await renderCommentsForCurrentItem();
            }
            document.getElementById('gallery-comment-input')?.focus();
            return;
        }

        if (passwordInput) {
            passwordInput.value = '';
        }
    } catch (error) {
        setLoginStatus(error?.message || 'Не успяхме да ви впишем.', { isError: true });
    }
}

async function logoutCurrentUser() {
    if (!window.PedalAuth) {
        return;
    }

    await window.PedalAuth.signOut();
    updateCommentsAuthUi();
    if (galleryState.commentsPanelOpen) {
        await renderCommentsForCurrentItem();
    }
}

function handleAuthStateChange(authState = getAuthState()) {
    syncLoginModalUi(authState);
    updateCommentsAuthUi(authState);

    if (authState.isLoggedIn) {
        const modalEl = document.getElementById('gallery-login-modal');
        if (modalEl?.classList.contains('is-open') && !authState.requiresNewPassword) {
            closeLoginModal();
        }
    }
}

function renderViewerItem(options = {}) {
    const item = getCurrentViewerItem();
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

    dateEl.textContent = formatDate(getItemTimestamp(item));
    countEl.textContent = `${galleryState.currentIndex + 1} / ${galleryState.viewerItems.length}`;

    if (hasLocationData(item)) {
        locationEl.hidden = false;
        locationEl.textContent = getLocationLabel(item);
        locationEl.href = getMapsUrl(item);
    } else {
        locationEl.hidden = true;
        locationEl.textContent = '';
        locationEl.removeAttribute('href');
    }

    if (prevBtn) {
        prevBtn.disabled = galleryState.currentIndex === 0;
    }

    if (nextBtn) {
        nextBtn.disabled = galleryState.currentIndex >= galleryState.viewerItems.length - 1;
    }

    if (galleryState.commentsPanelOpen) {
        renderCommentsForCurrentItem({
            forceRefresh: Boolean(options.forceRefresh),
        });
    } else {
        resetCommentsPanel();
    }
}

function openViewer(index, items = galleryState.currentBatch) {
    galleryState.viewerItems = items;
    galleryState.currentIndex = index;
    galleryState.commentsPanelOpen = false;

    const viewerEl = document.getElementById('gallery-viewer');
    if (!viewerEl) {
        return;
    }

    viewerEl.classList.add('is-open');
    viewerEl.setAttribute('aria-hidden', 'false');
    document.body.classList.add('viewer-open');
    setCommentsOverlayOpen(false);
    renderViewerItem();
}

function moveViewer(step) {
    const nextIndex = galleryState.currentIndex + step;
    if (nextIndex < 0 || nextIndex >= galleryState.viewerItems.length) {
        return;
    }

    galleryState.currentIndex = nextIndex;
    renderViewerItem();
}

async function loadManifest() {
    try {
        const payload = await fetchManifest();
        galleryState.manifestItems = payload.items;
        renderFeaturedSection(payload.featured);
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
            renderFeaturedSection(cached.featured);
            updateSummary(cached, 'cache');
            return true;
        }

        renderFeaturedSection(null);
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
    const commentsToggleBtn = document.getElementById('gallery-comments-toggle');
    const commentsLayer = document.getElementById('gallery-comments-layer');
    const commentsCloseBtn = document.getElementById('gallery-comments-close');
    const loginBtn = document.querySelector('.gallery-comments-login');
    const logoutBtn = document.getElementById('gallery-comments-logout');
    const loginModal = document.getElementById('gallery-login-modal');
    const loginCloseBtn = document.getElementById('gallery-login-close');
    const loginForm = document.querySelector('.gallery-login-form');
    const commentForm = document.getElementById('gallery-comments-form');
    const commentInput = document.getElementById('gallery-comment-input');

    if (!viewerEl) {
        return;
    }

    closeBtn?.addEventListener('click', closeViewer);
    prevBtn?.addEventListener('click', () => moveViewer(-1));
    nextBtn?.addEventListener('click', () => moveViewer(1));
    commentsToggleBtn?.addEventListener('click', event => {
        event.stopPropagation();
        setCommentsOverlayOpen(!galleryState.commentsPanelOpen);
    });
    commentsCloseBtn?.addEventListener('click', () => setCommentsOverlayOpen(false));
    loginBtn?.addEventListener('click', openLoginModal);
    logoutBtn?.addEventListener('click', logoutCurrentUser);
    loginCloseBtn?.addEventListener('click', closeLoginModal);
    loginForm?.addEventListener('submit', submitLogin);
    commentForm?.addEventListener('submit', submitCurrentComment);
    commentInput?.addEventListener('input', updateComposerCounter);

    viewerEl.addEventListener('click', event => {
        if (event.target === viewerEl) {
            closeViewer();
        }
    });

    loginModal?.addEventListener('click', event => {
        if (event.target === loginModal) {
            closeLoginModal();
        }
    });

    commentsLayer?.addEventListener('click', event => {
        if (event.target === commentsLayer) {
            setCommentsOverlayOpen(false);
        }
    });

    viewerEl.addEventListener('touchstart', event => {
        if (event.target instanceof Element
            && (event.target.closest('#gallery-viewer-comments')
                || event.target.closest('#gallery-comments-toggle'))) {
            galleryState.touchDeltaX = 0;
            return;
        }
        galleryState.touchStartX = event.changedTouches[0].clientX;
        galleryState.touchDeltaX = 0;
    });

    viewerEl.addEventListener('touchmove', event => {
        if (event.target instanceof Element
            && (event.target.closest('#gallery-viewer-comments')
                || event.target.closest('#gallery-comments-toggle'))) {
            return;
        }
        galleryState.touchDeltaX =
            event.changedTouches[0].clientX - galleryState.touchStartX;
    });

    viewerEl.addEventListener('touchend', () => {
        if (galleryState.touchDeltaX <= -40) {
            moveViewer(1);
        } else if (galleryState.touchDeltaX >= 40) {
            moveViewer(-1);
        }
        galleryState.touchDeltaX = 0;
    });

    document.addEventListener('keydown', event => {
        if (!viewerEl.classList.contains('is-open')) {
            return;
        }

        if (event.key === 'Escape') {
            if (loginModal?.classList.contains('is-open')) {
                closeLoginModal();
            } else if (galleryState.commentsPanelOpen) {
                setCommentsOverlayOpen(false);
            } else {
                closeViewer();
            }
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
    updateComposerCounter();

    if (window.PedalAuth?.subscribe) {
        window.PedalAuth.subscribe(handleAuthStateChange);
        await window.PedalAuth.init();
    } else {
        handleAuthStateChange();
    }

    const refreshBtn = document.getElementById('refresh-gallery-btn');
    refreshBtn?.addEventListener('click', () => {
        renderRandomBatch();
    });

    await loadManifest();
    renderRandomBatch();
});
