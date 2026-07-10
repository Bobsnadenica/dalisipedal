
const DEMO_MANIFEST_URL = 'data/gallery-manifest.json';
const DEMO_MANIFEST_CACHE_KEY = 'pedal_demo_manifest_v1';
const DEMO_MANIFEST_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FALLBACK_ENTRY = Object.freeze({
    id: 1,
    img: 'app_icon.png',
    plate: 'Публичен сигнал',
    status: 'approved',
    date: 'Няма дата',
    location: 'Нови снимки се зареждат скоро',
    timestamp: '',
    isFallback: true,
});

let DB = [];
const demoState = {
    entries: [],
    featuredDay: null,
    featuredMonth: null,
    loadPromise: null,
    plan: 'watch',
    isLoggedIn: true,
    username: 'dalisi.demo',
    chatMessages: [
        {
            role: 'bot',
            text: 'Здрасти. Аз съм PEDAL demo асистентът. Питай ме за upgrade, камери, сигнали или игрите.',
        },
    ],
    activeGame: 'parking',
    parkingGame: {
        order: [],
        round: 0,
        score: 0,
        selectedOption: null,
        complete: false,
    },
    radarGame: {
        active: false,
        score: 0,
        timeLeft: 20,
        targetIndex: -1,
        timerId: null,
        spawnId: null,
    },
    escapeGame: {
        active: false,
        crashed: false,
        score: 0,
        timeLeft: 18,
        playerLane: 1,
        obstacles: [],
        tickId: null,
    },
};


let map = null;
let userMarker = null;
let signalsGenerated = false;
let secretPin = "";
let camsMap = null;
let camsLayer = null;
let chatReplyTimeout = null;

function readDemoManifestCache() {
    try {
        const raw = localStorage.getItem(DEMO_MANIFEST_CACHE_KEY);
        if (!raw) {
            return null;
        }

        const payload = JSON.parse(raw);
        if (!payload || !Array.isArray(payload.items)) {
            return null;
        }

        const cachedAt = Number(payload.cachedAt || 0);
        if (!Number.isFinite(cachedAt) || (Date.now() - cachedAt) >= DEMO_MANIFEST_CACHE_TTL_MS) {
            return null;
        }

        return payload;
    } catch (_) {
        return null;
    }
}

function writeDemoManifestCache(items) {
    try {
        localStorage.setItem(DEMO_MANIFEST_CACHE_KEY, JSON.stringify({
            items,
            cachedAt: Date.now(),
        }));
    } catch (_) {
        // Ignore localStorage failures.
    }
}

const DEMO_ACHIEVEMENTS = [
    { icon: 'camera_alt', title: 'Фотограф', desc: 'Направи първата си снимка', progress: 100, unlocked: true },
    { icon: 'verified_user', title: 'Граждански Дълг', desc: '1 потвърден сигнал от КАТ', progress: 100, unlocked: true },
    { icon: 'group', title: 'Influencer', desc: 'Сподели в социалните мрежи', progress: 100, unlocked: true },
    { icon: 'photo_library', title: 'Папараци', desc: 'Качи 5 нарушения (3/5)', progress: 60, unlocked: false },
    { icon: 'security', title: 'Шериф', desc: '10 потвърдени сигнала (2/10)', progress: 20, unlocked: false },
    { icon: 'military_tech', title: 'Генерал', desc: 'Топ 1 в класацията за месеца', progress: 0, unlocked: false },
];

const DEMO_PLANS = [
    {
        id: 'starter',
        name: 'Старт',
        accent: 'default',
        requiredAchievements: 0,
        requirement: 'Отключено по подразбиране',
        copy: 'Всичко започва безплатно. Базовият demo пакет ти дава достъп до основните модули.',
        features: ['Произволни сигнали', 'Карта и камери', 'PEDAL чат помощник'],
    },
    {
        id: 'watch',
        name: 'Квартален пазител',
        accent: 'pro',
        requiredAchievements: 3,
        requirement: '3 постижения',
        copy: 'Отключва се, когато покажеш постоянство. Няма плащане, само активност и резултати.',
        features: ['Разширен dashboard flow', 'По-силен профилен статус', 'Повече civic credibility'],
    },
    {
        id: 'legend',
        name: 'PEDAL легенда',
        accent: 'ultra',
        requiredAchievements: 6,
        requirement: '6 постижения',
        copy: 'Финалното demo ниво. Показва, че си натиснал системата достатъчно дълго и смислено.',
        features: ['Всички demo unlocks', 'Максимален статус в профила', 'Легендарна значка'],
    },
];

const SPEED_CAMERAS = [
    { id: 'orlov', loc: 'Цариградско шосе (Орлов мост)', limit: 50, lat: 42.6926, lng: 23.3349, zone: 'Център' },
    { id: 'ndk', loc: 'Бул. България (НДК)', limit: 50, lat: 42.6853, lng: 23.3187, zone: 'НДК' },
    { id: 'boyana', loc: 'Околовръстен път (Бояна)', limit: 80, lat: 42.6407, lng: 23.2679, zone: 'Южен ринг' },
    { id: 'trakia', loc: 'АМ Тракия (Изход София)', limit: 140, lat: 42.6716, lng: 23.4704, zone: 'Изход София' },
];

const SURVEY_PREVIEWS = [
    { title: 'Къде паркирането е най-проблемно?', detail: 'Център, училища и големи булеварди', status: 'Очаквайте скоро' },
    { title: 'Има ли смисъл от гражданските сигнали?', detail: 'Ще събираме публични отговори и тенденции', status: 'Подготовка' },
    { title: 'Кои функции искате следващи?', detail: 'Анкети за карта, коментари и локални инициативи', status: 'Алфа модул' },
];

const PARTNER_PREVIEWS = [
    { title: 'Национална петиция за по-строг контрол', detail: 'Ще събираме подкрепа и партньорски организации в един общ модул.' },
    { title: 'Граждански организации', detail: 'Местни общности, квартални инициативи и доброволци.' },
    { title: 'Медийни и институционални партньори', detail: 'Канал за видимост, натиск и реални резултати.' },
];

const PARKING_SCENARIOS = [
    {
        title: 'Сутрешен блок',
        prompt: 'Къде паркираш, без да пречиш на всички?',
        options: [
            { label: 'Върху тротоара', correct: false, feedback: 'Тротоарът е за пешеходци, не за бърз тарикатлък.' },
            { label: 'В очертана зона', correct: true, feedback: 'Точно така. Ползваш маркираното място и никого не блокираш.' },
            { label: 'Пред гаража', correct: false, feedback: 'Пред гараж е сигурен начин да влезеш в чуждия black list.' },
        ],
    },
    {
        title: 'Пред училище',
        prompt: 'Имаш 20 секунди. Кой е правилният ход?',
        options: [
            { label: 'На пешеходната пътека', correct: false, feedback: 'Не. Това е класически кандидат за ПЕДАЛ на деня.' },
            { label: 'Встрани от входа, в разрешено място', correct: true, feedback: 'Да. Оставяш видимост и свободен достъп.' },
            { label: 'В аварийната лента', correct: false, feedback: 'Не. Аварийната лента не е VIP drop-off.' },
        ],
    },
    {
        title: 'Синя зона',
        prompt: 'Избираш място в центъра. Кое е правилното?',
        options: [
            { label: 'В зоната, без да пресичаш маркировките', correct: true, feedback: 'Перфектно. Влизаш чисто и оставяш място за другите.' },
            { label: 'На ъгъла, колкото да е близо', correct: false, feedback: 'Ъгълът не е бонус паркомясто.' },
            { label: 'Върху бус лентата', correct: false, feedback: 'Не. Това е директна покана за гняв и глоба.' },
        ],
    },
    {
        title: 'Квартален магазин',
        prompt: 'Няма много места. Какво правиш?',
        options: [
            { label: 'Спираш втори ред за минутка', correct: false, feedback: 'Тази минутка блокира цяла улица.' },
            { label: 'Обикаляш още 100 метра до свободно място', correct: true, feedback: 'Да. Малко ходене е по-добро от голяма наглост.' },
            { label: 'Качваш се в тревната площ', correct: false, feedback: 'Тревата не е паркинг режим.' },
        ],
    },
    {
        title: 'Вечерен център',
        prompt: 'Кое решение пази и трафика, и пешеходците?',
        options: [
            { label: 'Място с ясна маркировка и добра видимост', correct: true, feedback: 'Да. Това е зрелият избор.' },
            { label: 'Половината кола в кръстовището', correct: false, feedback: 'Не. Кръстовището не е half-and-half зона.' },
            { label: 'Върху велоалеята', correct: false, feedback: 'Не. Велосипедистите не са DLC съдържание.' },
        ],
    },
];

function shuffle(items) {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }
    return copy;
}

function setView(viewId) {
    if (viewId !== 'games') {
        stopRadarGame();
        stopEscapeGame();
    }

    document.querySelectorAll('.app-view').forEach(el => {
        el.classList.remove('active');
    });
    document.getElementById('view-' + viewId).classList.add('active');
}

function goBack(targetView) {
    const resolvedView = targetView === 'dashboard' && !demoState.isLoggedIn
        ? 'login'
        : targetView;
    setView(resolvedView);
    if (targetView === 'dashboard') {
        secretPin = "";
        updatePinDots();
    }
}

function showLoader(callback) {
    const loader = document.getElementById('global-loader');
    loader.classList.add('active');
    setTimeout(async () => {
        try {
            await callback();
        } finally {
            loader.classList.remove('active');
        }
    }, 600);
}

function triggerFlash() {
    const flash = document.getElementById('cam-flash');
    flash.classList.add('flash-active');
    setTimeout(() => {
        flash.classList.remove('flash-active');
    }, 100);
}

function mockAction(name) {
    if (name === 'Theme') {
        const phone = document.querySelector('.phone-screen');
        phone?.classList.toggle('theme-alt');
        return;
    }

    alert(`[Демо] Функция "${name}" ще бъде налична в пълната версия.`);
}

function ensureDemoSession() {
    if (demoState.isLoggedIn) {
        return true;
    }

    setView('login');
    return false;
}

function updateDemoHeader() {
    syncAchievementPlan();
}

function setLoginStatus(message = '', isError = false) {
    const statusEl = document.getElementById('demo-login-status');
    if (!statusEl) {
        return;
    }

    statusEl.hidden = !message;
    statusEl.textContent = message;
    statusEl.classList.toggle('is-error', Boolean(isError));
}

function getUnlockedAchievementsCount() {
    return DEMO_ACHIEVEMENTS.filter(item => item.unlocked).length;
}

function syncAchievementPlan() {
    const unlockedCount = getUnlockedAchievementsCount();
    const highestUnlocked = DEMO_PLANS
        .filter(plan => unlockedCount >= plan.requiredAchievements)
        .sort((left, right) => right.requiredAchievements - left.requiredAchievements)[0];

    if (highestUnlocked) {
        demoState.plan = highestUnlocked.id;
    }
}

function getRandomEntry() {
    if (!DB.length) {
        return FALLBACK_ENTRY;
    }

    return DB[Math.floor(Math.random() * DB.length)];
}

function formatDemoDate(timestamp) {
    if (!timestamp) {
        return 'Няма дата';
    }

    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
        return 'Няма дата';
    }

    return new Intl.DateTimeFormat('bg-BG', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).format(parsed);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function maskPlateFromKey(key) {
    const parts = (key || '').split('/');
    const region = parts[1] || 'BG';
    const serial = parts[2] || '0000XX';
    const visible = serial.slice(0, Math.min(4, serial.length));
    const masked = serial.length > 4 ? `${visible} **` : visible;
    return `${region} ${masked}`.trim();
}

function normalizeManifestItem(item, index) {
    return {
        id: index + 1,
        img: item.url,
        plate: maskPlateFromKey(item.key),
        status: 'approved',
        date: formatDemoDate(item.timestamp),
        location: item.locationLabel || 'Локацията не е налична',
        timestamp: item.timestamp || '',
    };
}

function updateWidget(idPrefix, entry) {
    const imageEl = document.getElementById(`${idPrefix}-img`);
    const locationEl = document.getElementById(`${idPrefix}-location`);

    if (imageEl) {
        imageEl.src = entry.img;
        imageEl.alt = entry.location || 'Публичен сигнал';
    }

    if (locationEl) {
        locationEl.textContent = entry.location || 'Локацията не е налична';
    }
}

function hydrateDashboardWidgets() {
    updateWidget('demo-day', demoState.featuredDay || FALLBACK_ENTRY);
    updateWidget('demo-month', demoState.featuredMonth || FALLBACK_ENTRY);
}

async function loadDemoEntries() {
    if (demoState.loadPromise) {
        return demoState.loadPromise;
    }

    demoState.loadPromise = (async () => {
        const cached = readDemoManifestCache();
        if (cached?.items?.length) {
            DB = cached.items;
            demoState.entries = cached.items;
            demoState.featuredDay = getRandomEntry();
            demoState.featuredMonth =
                cached.items[Math.min(14, cached.items.length - 1)] || demoState.featuredDay;

            if (demoState.featuredMonth.id === demoState.featuredDay.id && cached.items.length > 1) {
                demoState.featuredMonth = cached.items[1];
            }

            hydrateDashboardWidgets();
            return DB;
        }

        try {
            const response = await fetch(DEMO_MANIFEST_URL, { cache: 'default' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const payload = await response.json();
            const photoItems = Array.isArray(payload.items)
                ? payload.items.filter(item => item && !item.isVideo && item.url)
                : [];

            const entries = photoItems.slice(0, 60).map(normalizeManifestItem);
            if (!entries.length) {
                throw new Error('No photo entries available');
            }

            DB = entries;
            writeDemoManifestCache(entries);
            demoState.entries = entries;
            demoState.featuredDay = getRandomEntry();
            demoState.featuredMonth =
                entries[Math.min(14, entries.length - 1)] || demoState.featuredDay;

            if (demoState.featuredMonth.id === demoState.featuredDay.id && entries.length > 1) {
                demoState.featuredMonth = entries[1];
            }
        } catch (error) {
            console.warn('Demo manifest failed to load:', error);
            DB = [FALLBACK_ENTRY];
            demoState.entries = DB;
            demoState.featuredDay = FALLBACK_ENTRY;
            demoState.featuredMonth = FALLBACK_ENTRY;
        }

        hydrateDashboardWidgets();
        return DB;
    })();

    return demoState.loadPromise;
}

function handleLogout() {
    demoState.isLoggedIn = false;
    updateDemoHeader();
    secretPin = '';
    updatePinDots();
    stopRadarGame();
    setLoginStatus('');
    setView('login');
}

function submitDemoLogin(event) {
    event.preventDefault();

    const usernameEl = document.getElementById('demo-login-username');
    const passwordEl = document.getElementById('demo-login-password');
    const username = usernameEl?.value.trim() || '';
    const password = passwordEl?.value.trim() || '';

    if (!username || !password) {
        setLoginStatus('Попълнете потребител и парола за демото.', true);
        return;
    }

    setLoginStatus('Влизаме...');

    showLoader(async () => {
        demoState.isLoggedIn = true;
        demoState.username = username;
        updateDemoHeader();
        setLoginStatus('');
        setView('dashboard');
    });
}

function openUpgrade() {
    if (!ensureDemoSession()) {
        return;
    }

    renderUpgradeView();
    setView('upgrade');
}

function renderUpgradeView() {
    const container = document.getElementById('upgrade-content');
    if (!container) {
        return;
    }

    syncAchievementPlan();
    const unlockedCount = getUnlockedAchievementsCount();
    const nextPlan = DEMO_PLANS.find(plan => unlockedCount < plan.requiredAchievements);

    const planCards = DEMO_PLANS.map(plan => {
        const active = plan.id === demoState.plan;
        const unlocked = unlockedCount >= plan.requiredAchievements;
        const features = plan.features.map(feature => `<li>${feature}</li>`).join('');
        const buttonLabel = active
            ? 'Активно ниво'
            : unlocked
                ? 'Вече отключено'
                : `Нужни ${plan.requiredAchievements} постижения`;
        return `
            <article class="upgrade-plan-card ${plan.accent} ${active ? 'active' : ''} ${unlocked ? 'unlocked' : 'locked'}">
                <div class="upgrade-plan-top">
                    <div>
                        <div class="upgrade-plan-name">${plan.name}</div>
                        <div class="upgrade-plan-price">${plan.requirement}</div>
                    </div>
                    <span class="upgrade-plan-badge">${active ? 'Активен' : (unlocked ? 'Отключен' : 'Locked')}</span>
                </div>
                <p class="upgrade-plan-copy">${plan.copy}</p>
                <ul class="upgrade-plan-features">${features}</ul>
                <button class="upgrade-plan-btn" type="button" onclick="openAchievements()">
                    ${buttonLabel}
                </button>
            </article>
        `;
    }).join('');

    container.innerHTML = `
        <section class="upgrade-hero">
            <div class="upgrade-eyebrow">PEDAL Unlocks</div>
            <h3>Всичко е безплатно. Upgrade-ът идва с постижения.</h3>
            <p>Няма платени планове. Колкото повече реални действия и постижения имаш, толкова по-високо ниво отключваш в демото.</p>
            <div class="upgrade-current">Отключени постижения: <strong>${unlockedCount} / ${DEMO_ACHIEVEMENTS.length}</strong></div>
            ${nextPlan ? `<div class="upgrade-next-hint">Следващ unlock: <strong>${nextPlan.name}</strong> при ${nextPlan.requiredAchievements} постижения.</div>` : '<div class="upgrade-next-hint">Всички demo нива са отключени.</div>'}
            <button class="upgrade-plan-btn" type="button" onclick="openAchievements()">Виж постиженията</button>
        </section>
        <div class="upgrade-plan-grid">${planCards}</div>
    `;
}

function openChat() {
    if (!ensureDemoSession()) {
        return;
    }

    renderChatView();
    setView('chat');
    setTimeout(() => {
        document.getElementById('chat-input')?.focus();
    }, 100);
}

function renderChatView() {
    const container = document.getElementById('chat-messages');
    if (!container) {
        return;
    }

    container.innerHTML = demoState.chatMessages.map(message => `
        <div class="chat-bubble ${message.role}">
            <div class="chat-author">${message.role === 'user' ? demoState.username : 'PEDAL Bot'}</div>
            <div class="chat-text">${escapeHtml(message.text)}</div>
        </div>
    `).join('');

    container.scrollTop = container.scrollHeight;
}

function getChatReply(text) {
    const value = text.toLowerCase();

    if (value.includes('upgrade') || value.includes('plan') || value.includes('постиж')) {
        const unlockedCount = getUnlockedAchievementsCount();
        const currentPlan = DEMO_PLANS.find(plan => plan.id === demoState.plan)?.name || 'Старт';
        return `Тук няма платени планове. В момента сте на "${currentPlan}" и имате ${unlockedCount} отключени постижения.`;
    }

    if (value.includes('кам') || value.includes('camera') || value.includes('скорост')) {
        return 'Отвори Камери и ще видиш едновременно списък и карта с demo speed camera точки.';
    }

    if (value.includes('игр') || value.includes('game')) {
        return 'В Игри вече има три реални mini browser игри: Паркирай правилно, Радар tap и Бягство от паяка.';
    }

    if (value.includes('сигнал') || value.includes('upload')) {
        return 'Натисни Снимай и demo телефонът ще подготви нов сигнал с реална снимка от manifest-а.';
    }

    return 'Разбрано. Това е demo чат, но вече пази разговора и връща контекстни отговори според темата.';
}

function submitChatMessage(event) {
    event.preventDefault();
    if (!ensureDemoSession()) {
        return;
    }

    const input = document.getElementById('chat-input');
    const value = input?.value.trim() || '';
    if (!value) {
        return;
    }

    demoState.chatMessages.push({
        role: 'user',
        text: value,
    });
    input.value = '';
    renderChatView();

    if (chatReplyTimeout) {
        clearTimeout(chatReplyTimeout);
    }

    chatReplyTimeout = setTimeout(() => {
        demoState.chatMessages.push({
            role: 'bot',
            text: getChatReply(value),
        });
        renderChatView();
    }, 650);
}

function openNinjaGallery() {
    if (!ensureDemoSession()) {
        return;
    }

    showLoader(async () => {
        window.location.href = 'ninja.html';
    });
}

function openSurveyCenter() {
    if (!ensureDemoSession()) {
        return;
    }

    const container = document.getElementById('surveys-content');
    if (container) {
        container.innerHTML = `
            <section class="info-hero">
                <div class="info-badge">Алфа модул</div>
                <h3>Социологически проучвания</h3>
                <p>Тук по-късно ще вържем backend анкети, квартални настроения и публични обобщения.</p>
            </section>
            <div class="info-stack">
                ${SURVEY_PREVIEWS.map(item => `
                    <article class="info-card">
                        <div class="info-card-top">
                            <h4>${item.title}</h4>
                            <span class="info-chip">${item.status}</span>
                        </div>
                        <p>${item.detail}</p>
                    </article>
                `).join('')}
            </div>
        `;
    }

    setView('surveys');
}

function openPartnersHub() {
    if (!ensureDemoSession()) {
        return;
    }

    const container = document.getElementById('partners-content');
    if (container) {
        container.innerHTML = `
            <section class="info-hero petition">
                <div class="info-badge">Общност</div>
                <h3>Петиция и партньори</h3>
                <p>Ще съберем петицията, партньорите и инициативите на едно място, за да има реален натиск.</p>
            </section>
            <div class="info-stack">
                ${PARTNER_PREVIEWS.map(item => `
                    <article class="info-card">
                        <div class="info-card-top">
                            <h4>${item.title}</h4>
                            <span class="info-chip muted">Скоро</span>
                        </div>
                        <p>${item.detail}</p>
                    </article>
                `).join('')}
            </div>
        `;
    }

    setView('partners');
}


function simulateUpload() {
    if (!ensureDemoSession()) {
        return;
    }

    triggerFlash();
    setTimeout(() => {
        showLoader(async () => {
            await loadDemoEntries();
            const entry = getRandomEntry();
            document.getElementById('selected-img-preview').src = entry.img;
            document.getElementById('plate-input').value = entry.plate;
            setView('report');
        });
    }, 200);
}

function openMySignals() {
    if (!ensureDemoSession()) {
        return;
    }

    showLoader(async () => {
        await loadDemoEntries();

        const container = document.getElementById('signal-list-container');
        container.innerHTML = '';

        DB.forEach(item => {
            const statusClass = item.status === 'approved' ? 'approved' : 'pending';
            const statusIcon = item.status === 'approved' ? 'cloud_done' : 'edit_note';
            const statusText = item.status === 'approved' ? 'Качен в ПЕДАЛ' : 'Чернова (локален)';
            const footerText = item.status === 'approved' ? 'Публичен сигнал' : 'Изчаква обработка';
            const safeImg = escapeHtml(item.img);
            const safePlate = escapeHtml(item.plate);
            const safeDate = escapeHtml(item.date);
            const safeLocation = escapeHtml(item.location || 'Локацията не е налична');

            const html = `
                <div class="signal-item" onclick="openViewer(${item.id})">
                    <div class="signal-thumb">
                        <img src="${safeImg}" alt="${safePlate}">
                    </div>
                    <div class="signal-info">
                        <div class="signal-top">
                            <span class="plate-badge">
                                <span class="plate-badge-bar"></span>
                                <span class="plate-badge-text">${safePlate}</span>
                            </span>
                            <span class="signal-date">${safeDate}</span>
                        </div>
                        <div class="signal-status-row">
                            <span class="material-icons-round signal-status-icon ${statusClass}">${statusIcon}</span>
                            <span class="status-text ${statusClass}">${statusText}</span>
                        </div>
                        <div class="signal-location" title="${safeLocation}">${safeLocation}</div>
                        <div class="signal-footer">
                            <span class="signal-footer-badge ${statusClass}">${footerText}</span>
                            <span class="material-icons-round signal-chevron">chevron_right</span>
                        </div>
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', html);
        });

        setView('mysignals');
    });
}


function openMap() {
    if (!ensureDemoSession()) {
        return;
    }

    showLoader(async () => {
        await loadDemoEntries();
        setView('map');
        
        setTimeout(() => {
            if (!map) {
                map = L.map('map-container', { zoomControl: false }).setView([42.6977, 23.3219], 13);
                
                L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
                }).addTo(map);
            }
            
            map.invalidateSize();

            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(position => {
                    const lat = position.coords.latitude;
                    const lng = position.coords.longitude;
                    
                    map.setView([lat, lng], 15);

                    if (userMarker) {
                        userMarker.setLatLng([lat, lng]);
                    } else {
                        userMarker = L.circleMarker([lat, lng], {
                            radius: 8,
                            fillColor: "#34C759",
                            color: "#fff",
                            weight: 2,
                            opacity: 1,
                            fillOpacity: 0.8
                        }).addTo(map).bindPopup("Ти си тук");
                    }

                    if (!signalsGenerated) {
                        DB.forEach(item => {
                            const latOffset = (Math.random() - 0.5) * 0.01;
                            const lngOffset = (Math.random() - 0.5) * 0.01;
                            
                            const icon = L.divIcon({
                                className: 'custom-pin',
                                html: `<div style="width: 32px; height: 32px; border-radius: 50%; border: 2px solid white; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.5);"><img src="${item.img}" style="width: 100%; height: 100%; object-fit: cover;"></div>`,
                                iconSize: [32, 32],
                                iconAnchor: [16, 16]
                            });

                            L.marker([lat + latOffset, lng + lngOffset], { icon: icon })
                                .addTo(map)
                                .on('click', () => openViewer(item.id));
                        });
                        signalsGenerated = true;
                    }

                }, (error) => {
                    console.warn("GPS Access Denied:", error);
                });
            }
        }, 300);
    });
}


function openRandom() {
    if (!ensureDemoSession()) {
        return;
    }

    showLoader(async () => {
        await loadDemoEntries();
        const entry = getRandomEntry();
        renderViewer(entry);
        setView('viewer');
    });
}

function openPodMonth() {
    if (!ensureDemoSession()) {
        return;
    }

    showLoader(async () => {
        await loadDemoEntries();
        const entry = demoState.featuredMonth || getRandomEntry();
        
        if(entry) {
            renderViewer(entry);

            const metaDiv = document.getElementById('viewer-meta');
            metaDiv.innerHTML = `
                <div style="margin-top:12px; padding:10px; background:linear-gradient(45deg, #AF52DE, #5E5CE6); border-radius:12px; text-align:center;">
                    <div style="font-size:32px; margin-bottom:4px;">🏆</div>
                    <div style="color:white; font-weight:800; font-size:1.1rem;">П.Е.Д.А.Л. на МЕСЕЦА</div>
                    <div style="color:rgba(255,255,255,0.8); font-size:0.8rem;">Най-нагло паркиране за Януари</div>
                </div>
            `;
        }
        setView('viewer');
    });
}


function openAchievements() {
    if (!ensureDemoSession()) {
        return;
    }

    const list = document.getElementById('ach-list');
    list.innerHTML = '';

    DEMO_ACHIEVEMENTS.forEach(ach => {
        const stateClass = ach.unlocked ? 'unlocked' : 'locked';
        const checkMark = ach.unlocked ? 'check_circle' : '';
        
        const html = `
            <div class="ach-card ${stateClass}">
                <div class="ach-icon-box">
                    <span class="material-icons-round">${ach.icon}</span>
                </div>
                <div class="ach-text">
                    <div style="display:flex; justify-content:space-between;">
                        <h4>${ach.title}</h4>
                        <span class="material-icons-round ach-check">${checkMark}</span>
                    </div>
                    <p>${ach.desc}</p>
                    <div class="ach-progress-bg">
                        <div class="ach-progress-fill" style="width: ${ach.progress}%"></div>
                    </div>
                </div>
            </div>
        `;
        list.innerHTML += html;
    });
    
    setView('achievements');
}


function openLeaderboard() {
    if (!ensureDemoSession()) {
        return;
    }

    const list = document.getElementById('lb-list');
    list.innerHTML = '';

    const users = [
        { name: "Pesho_Golfa", score: 2890, region: "София, Люлин" },
        { name: "Mariya88", score: 2100, region: "София, Младост" },
        { name: "Ivan_Taxi", score: 1850, region: "Пловдив" },
        { name: "Ти (Аз)", score: 1450, region: "София" },
        { name: "Vanko1", score: 1200, region: "Варна" },
        { name: "Gosho_BMW", score: 950, region: "Бургас" }
    ];

    users.forEach((u, index) => {
        const rank = index + 1;
        const topClass = rank <= 3 ? `top-${rank}` : '';
        
        const html = `
            <div class="lb-card ${topClass}">
                <div class="lb-rank">${rank}</div>
                <div class="lb-avatar">${u.name.charAt(0)}</div>
                <div class="lb-info">
                    <div class="lb-name">${u.name}</div>
                    <div class="lb-region">${u.region}</div>
                </div>
                <div class="lb-score">${u.score}</div>
            </div>
        `;
        list.innerHTML += html;
    });

    setView('leaderboard');
}


function openStats() {
    if (!ensureDemoSession()) {
        return;
    }

    const container = document.getElementById('stats-content');
    const weekly = 1240;
    const processed = 890;
    
    container.innerHTML = `
        <div class="stat-card">
            <div class="stat-header">Сигнали тази седмица</div>
            <div class="stat-value">${weekly}</div>
        </div>
        <div class="stat-card">
            <div class="stat-header">Обработени от КАТ</div>
            <div class="stat-value" style="color: #34C759">${processed}</div>
        </div>
        <div class="chart-container">
            <div class="chart-bar active" style="height: 40%"><span class="bar-label">Пн</span></div>
            <div class="chart-bar active" style="height: 60%"><span class="bar-label">Вт</span></div>
            <div class="chart-bar active" style="height: 30%"><span class="bar-label">Ср</span></div>
            <div class="chart-bar active" style="height: 80%"><span class="bar-label">Чт</span></div>
            <div class="chart-bar active" style="height: 50%"><span class="bar-label">Пт</span></div>
            <div class="chart-bar" style="height: 90%"><span class="bar-label">Сб</span></div>
            <div class="chart-bar" style="height: 70%"><span class="bar-label">Нд</span></div>
        </div>
        <p style="font-size:0.8rem; color:#666; margin-top:20px; text-align:center;">
            * Данните се обновяват на всеки 24 часа от сървърите на МВР.
        </p>
    `;
    
    setView('stats');
}


function openSecret() {
    if (!ensureDemoSession()) {
        return;
    }

    secretPin = "";
    updatePinDots();
    setView('secret');
}


function openSpeedCams() {
    if (!ensureDemoSession()) {
        return;
    }

    const container = document.getElementById('cams-content');
    container.innerHTML = '';

    SPEED_CAMERAS.forEach(cam => {
        container.innerHTML += `
            <div class="lb-card speedcam-card" onclick="focusSpeedCam('${cam.id}')">
                <div class="ach-icon-box" style="color:#5E5CE6; background:rgba(94, 92, 230, 0.12);">
                    <span class="material-icons-round">speed</span>
                </div>
                <div class="lb-info">
                    <div class="lb-name">${cam.loc}</div>
                    <div class="lb-region">${cam.zone}</div>
                </div>
                <div class="lb-score" style="color:white">${cam.limit}<span class="speedcam-unit">km/h</span></div>
            </div>
        `;
    });

    setView('speedcams');

    setTimeout(() => {
        const mapEl = document.getElementById('cams-map-container');
        if (!mapEl || typeof L === 'undefined') {
            return;
        }

        if (!camsMap) {
            camsMap = L.map(mapEl, { zoomControl: false }).setView([42.688, 23.334], 11);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
            }).addTo(camsMap);
        }

        camsMap.invalidateSize();

        if (camsLayer) {
            camsLayer.remove();
        }

        camsLayer = L.layerGroup(
            SPEED_CAMERAS.map(cam => L.circleMarker([cam.lat, cam.lng], {
                radius: 8,
                color: '#fff',
                weight: 2,
                fillColor: '#5E5CE6',
                fillOpacity: 0.88,
            }).bindPopup(`<strong>${cam.loc}</strong><br>Ограничение: ${cam.limit} km/h`))
        ).addTo(camsMap);

        const bounds = L.latLngBounds(SPEED_CAMERAS.map(cam => [cam.lat, cam.lng]));
        camsMap.fitBounds(bounds.pad(0.16));
    }, 260);
}

function focusSpeedCam(id) {
    if (!camsMap) {
        return;
    }

    const selected = SPEED_CAMERAS.find(cam => cam.id === id);
    if (!selected) {
        return;
    }

    camsMap.flyTo([selected.lat, selected.lng], 14, { duration: 0.7 });
}


function openGames() {
    if (!ensureDemoSession()) {
        return;
    }

    setView('games');
    renderGamesView();
}

function renderGamesView() {
    const container = document.getElementById('games-content');
    if (!container) {
        return;
    }

    container.innerHTML = `
        <div class="games-shell">
            <section class="games-hero">
                <div class="games-eyebrow">Playable demo</div>
                <h3>Играй директно в браузъра</h3>
                <p>Две малки игри, които вече са истински playable и не са само placeholder.</p>
            </section>
            <div class="game-switcher">
                <button type="button" class="game-pill ${demoState.activeGame === 'parking' ? 'active' : ''}" onclick="selectDemoGame('parking')">Паркирай правилно</button>
                <button type="button" class="game-pill ${demoState.activeGame === 'radar' ? 'active' : ''}" onclick="selectDemoGame('radar')">Радар tap</button>
                <button type="button" class="game-pill ${demoState.activeGame === 'escape' ? 'active' : ''}" onclick="selectDemoGame('escape')">Бягство от паяка</button>
            </div>
            <div id="games-stage"></div>
        </div>
    `;

    renderSelectedGame();
}

function selectDemoGame(gameId) {
    demoState.activeGame = gameId;
    if (gameId !== 'radar') {
        stopRadarGame();
    }
    if (gameId !== 'escape') {
        stopEscapeGame();
    }
    renderGamesView();
}

function resetParkingGame() {
    demoState.parkingGame = {
        order: shuffle(PARKING_SCENARIOS.map((_, index) => index)).slice(0, 5),
        round: 0,
        score: 0,
        selectedOption: null,
        complete: false,
    };
    renderSelectedGame();
}

function getCurrentParkingScenario() {
    const state = demoState.parkingGame;
    const scenarioIndex = state.order[state.round] ?? 0;
    return PARKING_SCENARIOS[scenarioIndex];
}

function chooseParkingOption(index) {
    const state = demoState.parkingGame;
    if (state.complete || state.selectedOption !== null) {
        return;
    }

    state.selectedOption = index;
    if (getCurrentParkingScenario().options[index]?.correct) {
        state.score += 1;
    }
    renderSelectedGame();
}

function nextParkingScenario() {
    const state = demoState.parkingGame;
    if (state.round >= state.order.length - 1) {
        state.complete = true;
    } else {
        state.round += 1;
        state.selectedOption = null;
    }
    renderSelectedGame();
}

function startRadarGame() {
    stopRadarGame();

    demoState.radarGame.active = true;
    demoState.radarGame.score = 0;
    demoState.radarGame.timeLeft = 20;
    demoState.radarGame.targetIndex = Math.floor(Math.random() * 9);

    demoState.radarGame.timerId = setInterval(() => {
        demoState.radarGame.timeLeft -= 1;
        if (demoState.radarGame.timeLeft <= 0) {
            stopRadarGame();
            renderSelectedGame();
            return;
        }
        renderSelectedGame();
    }, 1000);

    demoState.radarGame.spawnId = setInterval(() => {
        demoState.radarGame.targetIndex = Math.floor(Math.random() * 9);
        renderSelectedGame();
    }, 850);

    renderSelectedGame();
}

function stopRadarGame() {
    if (demoState.radarGame.timerId) {
        clearInterval(demoState.radarGame.timerId);
        demoState.radarGame.timerId = null;
    }

    if (demoState.radarGame.spawnId) {
        clearInterval(demoState.radarGame.spawnId);
        demoState.radarGame.spawnId = null;
    }

    demoState.radarGame.active = false;
}

function resetEscapeGame() {
    stopEscapeGame();

    demoState.escapeGame = {
        active: false,
        crashed: false,
        score: 0,
        timeLeft: 18,
        playerLane: 1,
        obstacles: [],
        tickId: null,
    };
}

function startEscapeGame() {
    resetEscapeGame();
    demoState.escapeGame.active = true;
    renderSelectedGame();

    demoState.escapeGame.tickId = setInterval(() => {
        tickEscapeGame();
    }, 700);
}

function stopEscapeGame() {
    if (demoState.escapeGame.tickId) {
        clearInterval(demoState.escapeGame.tickId);
        demoState.escapeGame.tickId = null;
    }

    demoState.escapeGame.active = false;
}

function moveEscapeCar(direction) {
    const state = demoState.escapeGame;
    if (!state.active) {
        return;
    }

    state.playerLane = Math.max(0, Math.min(2, state.playerLane + direction));
    renderSelectedGame();
}

function tickEscapeGame() {
    const state = demoState.escapeGame;
    if (!state.active) {
        return;
    }

    state.timeLeft = Math.max(0, state.timeLeft - 1);

    let passed = 0;
    state.obstacles = state.obstacles
        .map(car => ({ ...car, row: car.row + 1 }))
        .filter(car => {
            if (car.row > 4) {
                passed += 1;
                return false;
            }
            return true;
        });

    state.score += passed;

    if (Math.random() > 0.28) {
        const nextLane = Math.floor(Math.random() * 3);
        const laneBlocked = state.obstacles.some(car => car.row === 0 && car.lane === nextLane);
        if (!laneBlocked) {
            state.obstacles.push({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                lane: nextLane,
                row: 0,
            });
        }
    }

    const hasCollision = state.obstacles.some(car => car.row === 4 && car.lane === state.playerLane);
    if (hasCollision) {
        state.crashed = true;
        stopEscapeGame();
        renderSelectedGame();
        return;
    }

    if (state.timeLeft <= 0) {
        stopEscapeGame();
        renderSelectedGame();
        return;
    }

    renderSelectedGame();
}

function tapRadarCell(index) {
    if (!demoState.radarGame.active) {
        return;
    }

    if (index === demoState.radarGame.targetIndex) {
        demoState.radarGame.score += 1;
    } else {
        demoState.radarGame.score = Math.max(0, demoState.radarGame.score - 1);
    }

    demoState.radarGame.targetIndex = Math.floor(Math.random() * 9);
    renderSelectedGame();
}

function renderSelectedGame() {
    const stage = document.getElementById('games-stage');
    if (!stage) {
        return;
    }

    if (!demoState.parkingGame.order.length) {
        resetParkingGame();
        return;
    }

    if (demoState.activeGame === 'parking') {
        const state = demoState.parkingGame;

        if (state.complete) {
            stage.innerHTML = `
                <div class="game-panel parking-finish">
                    <div class="game-score-banner">Резултат: ${state.score} / ${state.order.length}</div>
                    <h4>Паркинг рундът приключи</h4>
                    <p>Колкото по-малко тарикатстваш, толкова по-добре изглежда градът.</p>
                    <button type="button" class="game-action-btn" onclick="resetParkingGame()">Играй пак</button>
                </div>
            `;
            return;
        }

        const scenario = getCurrentParkingScenario();
        const selectedOption = state.selectedOption;
        const selectedFeedback = selectedOption !== null
            ? scenario.options[selectedOption].feedback
            : 'Избери едно място и виж дали ще вземеш точка.';
        const footerButton = selectedOption !== null
            ? `<button type="button" class="game-action-btn" onclick="nextParkingScenario()">${state.round + 1 === state.order.length ? 'Финал' : 'Следващ рунд'}</button>`
            : `<button type="button" class="game-action-btn secondary" onclick="resetParkingGame()">Ново начало</button>`;

        stage.innerHTML = `
            <div class="game-panel">
                <div class="game-score-row">
                    <span>Рунд ${state.round + 1} / ${state.order.length}</span>
                    <strong>${state.score} точки</strong>
                </div>
                <div class="game-scene-tag">${scenario.title}</div>
                <h4>${scenario.prompt}</h4>
                <div class="parking-options">
                    ${scenario.options.map((option, index) => {
                        let className = 'parking-option';
                        if (selectedOption !== null) {
                            if (option.correct) {
                                className += ' correct';
                            }
                            if (selectedOption === index && !option.correct) {
                                className += ' wrong';
                            }
                        }
                        return `
                            <button type="button" class="${className}" onclick="chooseParkingOption(${index})" ${selectedOption !== null ? 'disabled' : ''}>
                                <span class="material-icons-round">${option.correct ? 'task_alt' : 'do_not_disturb_on'}</span>
                                <span>${option.label}</span>
                            </button>
                        `;
                    }).join('')}
                </div>
                <div class="game-feedback ${selectedOption !== null && scenario.options[selectedOption].correct ? 'ok' : ''}">${selectedFeedback}</div>
                ${footerButton}
            </div>
        `;
        return;
    }

    if (demoState.activeGame === 'radar') {
        const radar = demoState.radarGame;
        stage.innerHTML = `
            <div class="game-panel">
                <div class="game-score-row">
                    <span>Време: ${radar.timeLeft}s</span>
                    <strong>${radar.score} точки</strong>
                </div>
                <h4>Радар tap</h4>
                <p class="game-copy">Натисни само нарушителя, преди да смени позицията си.</p>
                <div class="radar-grid ${radar.active ? 'active' : ''}">
                    ${Array.from({ length: 9 }, (_, index) => `
                        <button type="button" class="radar-cell ${radar.targetIndex === index && radar.active ? 'target' : ''}" onclick="tapRadarCell(${index})">
                            <span class="material-icons-round">${radar.targetIndex === index && radar.active ? 'local_police' : 'directions_car'}</span>
                        </button>
                    `).join('')}
                </div>
                <div class="game-feedback ${radar.active ? 'ok' : ''}">
                    ${radar.active
                        ? 'Тапни мигащата клетка и не губи време.'
                        : `Финален резултат: ${radar.score}. Натисни старт за нов рунд.`}
                </div>
                <button type="button" class="game-action-btn" onclick="startRadarGame()">
                    ${radar.active ? 'Рестарт' : 'Старт'}
                </button>
            </div>
        `;
        return;
    }

    const escape = demoState.escapeGame;
    stage.innerHTML = `
        <div class="game-panel">
            <div class="game-score-row">
                <span>${escape.active ? `Остават ${escape.timeLeft}s` : (escape.crashed ? 'Ударихте се' : 'Финал')}</span>
                <strong>${escape.score} точки</strong>
            </div>
            <div class="game-scene-tag tow-tag">Градски улици</div>
            <h4>Бягство от паяка</h4>
            <p class="game-copy">Премествай колата между трите ленти и избегни наглите спирания по пътя.</p>
            <div class="escape-road ${escape.crashed ? 'crashed' : ''}">
                ${Array.from({ length: 5 }, (_, rowIndex) => `
                    <div class="escape-row">
                        ${Array.from({ length: 3 }, (_, laneIndex) => {
                            const isPlayer = rowIndex === 4 && laneIndex === escape.playerLane;
                            const obstacle = escape.obstacles.find(car => car.row === rowIndex && car.lane === laneIndex);
                            const className = [
                                'escape-cell',
                                isPlayer ? 'player' : '',
                                obstacle ? 'obstacle' : '',
                            ].filter(Boolean).join(' ');
                            let icon = 'road';
                            if (obstacle) {
                                icon = 'local_shipping';
                            }
                            if (isPlayer && obstacle) {
                                icon = 'car_crash';
                            } else if (isPlayer) {
                                icon = 'directions_car';
                            }
                            return `
                                <div class="${className}">
                                    <span class="material-icons-round">${icon}</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `).join('')}
            </div>
            <div class="escape-controls">
                <button type="button" class="game-action-btn secondary" onclick="moveEscapeCar(-1)" ${escape.active ? '' : 'disabled'}>Наляво</button>
                <button type="button" class="game-action-btn secondary" onclick="moveEscapeCar(1)" ${escape.active ? '' : 'disabled'}>Надясно</button>
            </div>
            <div class="game-feedback ${escape.active && !escape.crashed ? 'ok' : ''}">
                ${escape.active
                    ? 'Стой в движение. Всеки избегнат автомобил носи точка.'
                    : (escape.crashed
                        ? `Паякът те хвана. Събра ${escape.score} точки.`
                        : `Рундът приключи. Избяга от ${escape.score} препятствия.`)}
            </div>
            <button type="button" class="game-action-btn" onclick="startEscapeGame()">
                ${escape.active ? 'Рестарт' : 'Старт'}
            </button>
        </div>
    `;
}


function openAir() {
    if (!ensureDemoSession()) {
        return;
    }

    const aqi = Math.floor(Math.random() * (120 - 30) + 30);
    let status = "Добър";
    let color = "#34C759";
    
    if (aqi > 50) { status = "Умерен"; color = "#FFC107"; }
    if (aqi > 100) { status = "Замърсен"; color = "#FF3B30"; }

    const container = document.getElementById('air-content');
    container.innerHTML = `
        <div style="text-align:center; padding:40px 0;">
            <div style="font-size:4rem; font-weight:800; color:${color}; margin-bottom:10px;">${aqi}</div>
            <div style="font-size:1.5rem; font-weight:700; color:white;">${status}</div>
            <div style="color:#888; font-size:0.9rem; margin-top:5px;">Индекс за качество на въздуха (AQI)</div>
            <div style="margin-top:30px; background:#333; height:6px; border-radius:3px; position:relative; overflow:hidden;">
                <div style="width:${(aqi/150)*100}%; background:${color}; height:100%;"></div>
            </div>
            <p style="margin-top:20px; font-size:0.8rem; color:#666;">Данните са от измервателни станции в София.</p>
        </div>
    `;
    setView('air');
}


function openSettings() {
    if (!ensureDemoSession()) {
        return;
    }

    const container = document.getElementById('settings-content');
    

    const createToggle = (label, checked) => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:15px; background:#1C1C1E; border-radius:12px; margin-bottom:10px; border:1px solid #333;">
            <span style="font-weight:600; font-size:0.9rem;">${label}</span>
            <div style="width:40px; height:22px; background:${checked ? '#34C759' : '#333'}; border-radius:11px; position:relative; transition:0.2s;">
                <div style="width:18px; height:18px; background:white; border-radius:50%; position:absolute; top:2px; left:${checked ? '20px' : '2px'}; transition:0.2s;"></div>
            </div>
        </div>
    `;

    container.innerHTML = `
        ${createToggle('Тъмна тема', true)}
        ${createToggle('Известия', true)}
        ${createToggle('GPS Локация', true)}
        <div style="margin-top:20px; text-align:center;">
            <button class="btn-submit" style="background:#FF3B30; color:white; border:none;" onclick="alert('Акаунтът е изтрит!')">ИЗТРИВАНЕ НА АКАУНТ</button>
            <p style="font-size:0.7rem; color:#666; margin-top:10px;">Версия 2.6.4 (Build 2026)</p>
        </div>
    `;
    setView('settings');
}


function pressKey(num) {
    if (secretPin.length < 4) {
        secretPin += num;
        updatePinDots();
        
        if (secretPin.length === 4) {
            setTimeout(() => {
                const wrapper = document.querySelector('.secret-wrapper');
                if (secretPin === '4242') {
                    alert('Добре дошли в най-фалшивия админ панел. Всичко е само за майтап.');
                    secretPin = "";
                    updatePinDots();
                    return;
                }

                wrapper.classList.add('shake');
                if(navigator.vibrate) navigator.vibrate(200);
                
                setTimeout(() => {
                    wrapper.classList.remove('shake');
                    secretPin = "";
                    updatePinDots();
                    alert("Грешен код! Достъп отказан.");
                }, 500);
            }, 300);
        }
    }
}

function clearKey() {
    secretPin = secretPin.slice(0, -1);
    updatePinDots();
}

function updatePinDots() {
    const dots = document.querySelectorAll('.secret-pin-dots span');
    dots.forEach((dot, index) => {
        if (index < secretPin.length) {
            dot.classList.add('filled');
        } else {
            dot.classList.remove('filled');
        }
    });
}

function openViewer(id) {
    if (!ensureDemoSession()) {
        return;
    }

    if (!DB.length) {
        return;
    }

    const entry = DB.find(x => x.id === id);
    if(entry) {
        renderViewer(entry);
        setView('viewer');
    }
}

function renderViewer(entry) {
    document.getElementById('viewer-img').src = entry.img;
    document.getElementById('viewer-plate').innerText = entry.plate;
    document.getElementById('viewer-date').innerText = entry.date;

    const extra = document.getElementById('viewer-meta');
    if (extra) extra.innerHTML = "";
}

function submitReport() {
    if (!ensureDemoSession()) {
        return;
    }

    const btn = document.getElementById('report-submit-btn');
    const originalText = btn.innerText;
    
    btn.innerText = "ИЗПРАЩАНЕ...";
    btn.style.opacity = "0.7";

    setTimeout(() => {
        btn.innerText = originalText;
        btn.style.opacity = "1";

        const success = document.getElementById('success-screen');
        success.classList.add('show');

        setTimeout(() => {
            success.classList.remove('show');
            setView('dashboard');
        }, 2000);

    }, 1500);
}

function enhanceDemoAccessibility() {
    const demo = document.querySelector('.phone-screen');
    if (!demo) {
        return;
    }

    const getControlLabel = (control) => {
        const cardLabel = control.querySelector?.('.card-label');
        if (cardLabel?.textContent.trim()) {
            return cardLabel.textContent.trim();
        }

        const heading = control.querySelector?.('h5, h4, h3');
        if (heading?.textContent.trim()) {
            return heading.textContent.trim();
        }

        const iconName = control.textContent.trim();
        const iconLabels = {
            upgrade: 'Планове',
            chat: 'Чат',
            palette: 'Смени темата',
            logout: 'Изход',
            arrow_back: 'Назад',
            camera_alt: 'Снимай нов сигнал',
            backspace: 'Изтрий цифра',
        };

        return iconLabels[iconName] || iconName.replace(/_/g, ' ');
    };

    demo.querySelectorAll('[onclick]').forEach((control) => {
        if (!control.matches('button, a, input, select, textarea')) {
            control.setAttribute('role', 'button');
            control.setAttribute('tabindex', '0');
        }

        if (!control.hasAttribute('aria-label')) {
            const label = getControlLabel(control);
            if (label) {
                control.setAttribute('aria-label', label);
            }
        }
    });

    demo.querySelectorAll('.material-icons-round:not([role="button"])').forEach((icon) => {
        icon.setAttribute('aria-hidden', 'true');
    });

    const chatSend = demo.querySelector('.chat-send');
    if (chatSend) {
        chatSend.setAttribute('aria-label', 'Изпрати съобщение');
    }

    demo.addEventListener('keydown', (event) => {
        const control = event.target.closest('[role="button"]');
        if (!control || (event.key !== 'Enter' && event.key !== ' ')) {
            return;
        }

        event.preventDefault();
        control.click();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    enhanceDemoAccessibility();
    loadDemoEntries();
    updateDemoHeader();
    renderChatView();
    renderUpgradeView();
    resetParkingGame();
    resetEscapeGame();

    setInterval(() => {
        const now = new Date();
        document.getElementById('clock').innerText = 
            now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }, 1000);

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) entry.target.classList.add('visible');
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));
    document.getElementById('year').textContent = new Date().getFullYear();
});
