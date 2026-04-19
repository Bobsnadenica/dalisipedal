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
    commentsPanelOpen: false,
    nextBatchStart: 0,
    touchStartX: 0,
    touchDeltaX: 0,
    commentsRequestId: 0,
    commentsCountRequestId: 0,
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

    body.appendChild(date);

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

    closeLoginModal();
    ninjaState.commentsRequestId += 1;
    ninjaState.commentsPanelOpen = false;
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
    const modalEl = document.getElementById('ninja-login-modal');
    if (!modalEl) {
        return;
    }

    const authState = getAuthState();
    if (authState.isLoggedIn) {
        document.getElementById('ninja-comment-input')?.focus();
        return;
    }

    modalEl.classList.add('is-open');
    modalEl.setAttribute('aria-hidden', 'false');
    syncLoginModalUi(authState);

    const usernameInput = document.getElementById('ninja-login-username');
    if (usernameInput && !authState.requiresNewPassword) {
        usernameInput.focus();
    }
}

function closeLoginModal() {
    const modalEl = document.getElementById('ninja-login-modal');
    if (!modalEl) {
        return;
    }

    modalEl.classList.remove('is-open');
    modalEl.setAttribute('aria-hidden', 'true');

    const passwordInput = document.getElementById('ninja-login-password');
    if (passwordInput) {
        passwordInput.value = '';
    }
}

function setLoginStatus(message, options = {}) {
    const statusEl = document.getElementById('ninja-login-status');
    if (!statusEl) {
        return;
    }

    statusEl.className = 'ninja-login-status';
    if (options.isError) {
        statusEl.classList.add('is-error');
    }

    statusEl.textContent = message || '';
    statusEl.hidden = !message;
}

function syncLoginModalUi(authState = getAuthState()) {
    const copyEl = document.querySelector('.ninja-login-copy');
    const usernameInput = document.getElementById('ninja-login-username');
    const passwordInput = document.getElementById('ninja-login-password');
    const passwordLabel = document.getElementById('ninja-login-password-label');
    const submitBtn = document.getElementById('ninja-login-submit');

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
    const inputEl = document.getElementById('ninja-comment-input');
    const metaEl = document.getElementById('ninja-comments-compose-meta');
    if (!inputEl || !metaEl) {
        return;
    }

    metaEl.textContent = `${inputEl.value.trim().length} / 500`;
}

function setComposerBusy(isBusy) {
    const inputEl = document.getElementById('ninja-comment-input');
    const submitBtn = document.getElementById('ninja-comment-submit');
    if (inputEl) {
        inputEl.disabled = isBusy;
    }

    if (submitBtn) {
        submitBtn.disabled = isBusy;
        submitBtn.textContent = isBusy ? 'Публикуваме...' : 'Публикувай';
    }
}

function updateCommentsAuthUi(authState = getAuthState()) {
    const noteEl = document.getElementById('ninja-comments-note');
    const sessionEl = document.getElementById('ninja-comments-session');
    const formEl = document.getElementById('ninja-comments-form');
    const loginBtn = document.querySelector('.ninja-comments-login');
    const logoutBtn = document.getElementById('ninja-comments-logout');

    if (noteEl) {
        noteEl.hidden = authState.isLoggedIn;
        noteEl.textContent = 'Вход за коментар';
    }

    if (sessionEl) {
        sessionEl.hidden = !authState.isLoggedIn;
        sessionEl.textContent = authState.isLoggedIn
            ? `${authState.displayName || authState.loginId || 'PEDAL профил'}`
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
    const statusEl = document.getElementById('ninja-comments-status');
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
    const value = typeof count === 'number'
        ? String(Math.max(0, Number(count) || 0))
        : String(count || '');
    const ids = ['ninja-comments-count', 'ninja-comments-toggle-count'];
    ids.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    });
}

function resetCommentsPanel() {
    const listEl = document.getElementById('ninja-comments-list');
    if (listEl) {
        listEl.innerHTML = '';
    }

    setCommentsCount(0);
    setCommentsStatus('');
    updateCommentsAuthUi();
    updateComposerCounter();
}

function setCommentsOverlayOpen(isOpen, options = {}) {
    const layerEl = document.getElementById('ninja-comments-layer');
    const toggleBtn = document.getElementById('ninja-comments-toggle');
    if (!layerEl || !toggleBtn) {
        return;
    }

    ninjaState.commentsPanelOpen = Boolean(isOpen);
    layerEl.classList.toggle('is-open', ninjaState.commentsPanelOpen);
    layerEl.setAttribute('aria-hidden', ninjaState.commentsPanelOpen ? 'false' : 'true');
    toggleBtn.setAttribute('aria-expanded', ninjaState.commentsPanelOpen ? 'true' : 'false');

    if (ninjaState.commentsPanelOpen) {
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
    return ninjaState.items[ninjaState.currentIndex] || null;
}

function getCurrentViewerMediaKey() {
    const item = getCurrentViewerItem();
    return window.PedalComments?.normalizeMediaKey?.(item?.key || item?.url || '') || '';
}

async function prefetchCommentsCountForCurrentItem(options = {}) {
    const mediaKey = getCurrentViewerMediaKey();
    if (!mediaKey || !window.PedalComments?.listComments) {
        setCommentsCount(0);
        return;
    }

    const requestId = ninjaState.commentsCountRequestId + 1;
    ninjaState.commentsCountRequestId = requestId;

    const cachedCount = window.PedalComments.getCachedCommentCount?.(mediaKey);
    if (Number.isFinite(cachedCount) && !options.forceRefresh) {
        setCommentsCount(cachedCount);
        return;
    }

    setCommentsCount(Number.isFinite(cachedCount) ? cachedCount : '...');

    try {
        const comments = await window.PedalComments.listComments(mediaKey, {
            forceRefresh: Boolean(options.forceRefresh),
        });

        if (requestId !== ninjaState.commentsCountRequestId) {
            return;
        }

        if (mediaKey !== getCurrentViewerMediaKey()) {
            return;
        }

        setCommentsCount(comments.length);
    } catch (error) {
        if (requestId !== ninjaState.commentsCountRequestId) {
            return;
        }

        console.warn('Ninja comments count failed to preload:', error);
        setCommentsCount(0);
    }
}

async function renderCommentsForCurrentItem(options = {}) {
    const item = getCurrentViewerItem();
    const listEl = document.getElementById('ninja-comments-list');

    if (!item || !listEl) {
        return;
    }

    const requestId = ninjaState.commentsRequestId + 1;
    ninjaState.commentsRequestId = requestId;

    listEl.innerHTML = '';
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

        if (requestId !== ninjaState.commentsRequestId) {
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
        if (requestId !== ninjaState.commentsRequestId) {
            return;
        }

        console.warn('Ninja comments failed to load:', error);
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

    const inputEl = document.getElementById('ninja-comment-input');
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
        setCommentsStatus('Липсва валидна снимка за коментара.', { isError: true });
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
    const usernameInput = document.getElementById('ninja-login-username');
    const passwordInput = document.getElementById('ninja-login-password');
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
            if (ninjaState.commentsPanelOpen) {
                await renderCommentsForCurrentItem();
            }
            document.getElementById('ninja-comment-input')?.focus();
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
    if (ninjaState.commentsPanelOpen) {
        await renderCommentsForCurrentItem();
    }
}

function handleAuthStateChange(authState = getAuthState()) {
    syncLoginModalUi(authState);
    updateCommentsAuthUi(authState);

    if (authState.isLoggedIn) {
        const modalEl = document.getElementById('ninja-login-modal');
        if (modalEl?.classList.contains('is-open') && !authState.requiresNewPassword) {
            closeLoginModal();
        }
    }
}

function renderViewerItem(options = {}) {
    const item = getCurrentViewerItem();
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

    if (ninjaState.commentsPanelOpen) {
        renderCommentsForCurrentItem({
            forceRefresh: Boolean(options.forceRefresh),
        });
    } else {
        resetCommentsPanel();
        prefetchCommentsCountForCurrentItem({
            forceRefresh: Boolean(options.forceRefresh),
        });
    }
}

function openViewer(index) {
    ninjaState.currentIndex = index;
    ninjaState.commentsPanelOpen = false;
    const viewerEl = document.getElementById('ninja-viewer');
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
    const commentsToggleBtn = document.getElementById('ninja-comments-toggle');
    const commentsLayer = document.getElementById('ninja-comments-layer');
    const commentsCloseBtn = document.getElementById('ninja-comments-close');
    const loginBtn = document.querySelector('.ninja-comments-login');
    const logoutBtn = document.getElementById('ninja-comments-logout');
    const loginModal = document.getElementById('ninja-login-modal');
    const loginCloseBtn = document.getElementById('ninja-login-close');
    const loginForm = document.querySelector('.ninja-login-form');
    const commentForm = document.getElementById('ninja-comments-form');
    const commentInput = document.getElementById('ninja-comment-input');

    if (!viewerEl) {
        return;
    }

    closeBtn?.addEventListener('click', closeViewer);
    prevBtn?.addEventListener('click', () => moveViewer(-1));
    nextBtn?.addEventListener('click', () => moveViewer(1));
    commentsToggleBtn?.addEventListener('click', event => {
        event.stopPropagation();
        setCommentsOverlayOpen(!ninjaState.commentsPanelOpen);
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
            && (event.target.closest('#ninja-viewer-comments')
                || event.target.closest('#ninja-comments-toggle'))) {
            ninjaState.touchDeltaX = 0;
            return;
        }
        ninjaState.touchStartX = event.changedTouches[0].clientX;
        ninjaState.touchDeltaX = 0;
    });

    viewerEl.addEventListener('touchmove', event => {
        if (event.target instanceof Element
            && (event.target.closest('#ninja-viewer-comments')
                || event.target.closest('#ninja-comments-toggle'))) {
            return;
        }
        ninjaState.touchDeltaX =
            event.changedTouches[0].clientX - ninjaState.touchStartX;
    });

    viewerEl.addEventListener('touchend', () => {
        if (ninjaState.touchDeltaX <= -40) {
            moveViewer(1);
        } else if (ninjaState.touchDeltaX >= 40) {
            moveViewer(-1);
        }
        ninjaState.touchDeltaX = 0;
    });

    document.addEventListener('keydown', event => {
        if (!viewerEl.classList.contains('is-open')) {
            return;
        }

        if (event.key === 'Escape') {
            if (loginModal?.classList.contains('is-open')) {
                closeLoginModal();
            } else if (ninjaState.commentsPanelOpen) {
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
    bindViewerEvents();
    updateComposerCounter();

    if (window.PedalAuth?.subscribe) {
        window.PedalAuth.subscribe(handleAuthStateChange);
        await window.PedalAuth.init();
    } else {
        handleAuthStateChange();
    }

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
