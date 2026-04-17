
const DEMO_MANIFEST_URL = 'data/gallery-manifest.json';
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
};


let map = null;
let userMarker = null;
let signalsGenerated = false;
let secretPin = "";

function setView(viewId) {
    document.querySelectorAll('.app-view').forEach(el => {
        el.classList.remove('active');
    });
    document.getElementById('view-' + viewId).classList.add('active');
}

function goBack(targetView) {
    setView(targetView);
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
    alert(`[Демо] Функция "${name}" ще бъде налична в пълната версия.`);
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
        try {
            const response = await fetch(DEMO_MANIFEST_URL, { cache: 'no-store' });
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


function simulateUpload() {
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
    showLoader(async () => {
        await loadDemoEntries();
        const entry = getRandomEntry();
        renderViewer(entry);
        setView('viewer');
    });
}

function openPodMonth() {
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
    const list = document.getElementById('ach-list');
    list.innerHTML = '';
    
    const achievements = [
        { icon: 'camera_alt', title: 'Фотограф', desc: 'Направи първата си снимка', progress: 100, unlocked: true },
        { icon: 'verified_user', title: 'Граждански Дълг', desc: '1 потвърден сигнал от КАТ', progress: 100, unlocked: true },
        { icon: 'group', title: 'Influencer', desc: 'Сподели в социалните мрежи', progress: 100, unlocked: true },
        { icon: 'photo_library', title: 'Папараци', desc: 'Качи 5 нарушения (3/5)', progress: 60, unlocked: false },
        { icon: 'security', title: 'Шериф', desc: '10 потвърдени сигнала (2/10)', progress: 20, unlocked: false },
        { icon: 'military_tech', title: 'Генерал', desc: 'Топ 1 в класацията за месеца', progress: 0, unlocked: false }
    ];

    achievements.forEach(ach => {
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
    secretPin = "";
    updatePinDots();
    setView('secret');
}


function openSpeedCams() {
    const container = document.getElementById('cams-content');
    container.innerHTML = '';
    
    const cams = [
        { loc: 'Цариградско шосе (Орлов мост)', limit: 50 },
        { loc: 'Бул. България (НДК)', limit: 50 },
        { loc: 'Околовръстен път (Бояна)', limit: 80 },
        { loc: 'АМ Тракия (Изход София)', limit: 140 }
    ];

    cams.forEach(cam => {
        container.innerHTML += `
            <div class="lb-card">
                <div class="ach-icon-box" style="color:#5E5CE6; background:rgba(94, 92, 230, 0.1);">
                    <span class="material-icons-round">speed</span>
                </div>
                <div class="lb-info">
                    <div class="lb-name">${cam.loc}</div>
                    <div class="lb-region">Камера за скорост</div>
                </div>
                <div class="lb-score" style="color:white">${cam.limit}</div>
            </div>
        `;
    });
    
    setView('speedcams');
}


function openGames() {
    const container = document.getElementById('games-content');
    container.innerHTML = `
        <div class="ach-card" style="margin-bottom:10px;">
            <div class="ach-icon-box" style="color:#FF2D55; background:rgba(255, 45, 85, 0.1);">
                <span class="material-icons-round">directions_car</span>
            </div>
            <div class="ach-text">
                <h4>Паркирай Правилно</h4>
                <p>Симулатор за паркиране. Научи се как се прави!</p>
            </div>
            <button class="btn-submit" style="width:auto; padding:5px 15px; font-size:0.8rem; margin:0;" onclick="alert('Стартиране на играта...')">ИГРАЙ</button>
        </div>
        
        <div class="ach-card">
            <div class="ach-icon-box" style="color:#FF2D55; background:rgba(255, 45, 85, 0.1);">
                <span class="material-icons-round">quiz</span>
            </div>
            <div class="ach-text">
                <h4>Листовки 2026</h4>
                <p>Тест за познаване на ЗДвП. Провери знанията си.</p>
            </div>
            <button class="btn-submit" style="width:auto; padding:5px 15px; font-size:0.8rem; margin:0;" onclick="alert('Зареждане на въпроси...')">ИГРАЙ</button>
        </div>
    `;
    setView('games');
}


function openAir() {

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
    const btn = document.querySelector('.btn-submit');
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

document.addEventListener('DOMContentLoaded', () => {
    loadDemoEntries();

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
