/* P.E.D.A.L. Interactive Demo Logic v2.8 */

const DB = [
    { id: 1, img: "car1.jpeg", plate: "CB 4816 TM", status: "approved", date: "02.01.2026" },
    { id: 2, img: "car2.JPG", plate: "CO 3708 CX", status: "pending", date: "05.01.2026" },
    { id: 3, img: "car3.jpeg", plate: "CA 1290 HP", status: "approved", date: "28.12.2025" },
    { id: 4, img: "car4.jpeg", plate: "CB 9921 KA", status: "pending", date: "06.01.2026" },
    { id: 5, img: "car5.jpeg", plate: "TX 5502 PB", status: "approved", date: "15.12.2025" },
    { id: 6, img: "car6.JPG", plate: "PB 1188 MX", status: "pending", date: "06.01.2026" }
];

// Global State
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
    // Clear secret pin if leaving secret view
    if (targetView === 'dashboard') {
        secretPin = "";
        updatePinDots();
    }
}

function showLoader(callback) {
    const loader = document.getElementById('global-loader');
    loader.classList.add('active');
    setTimeout(() => {
        loader.classList.remove('active');
        callback();
    }, 600);
}

function triggerFlash() {
    const flash = document.getElementById('cam-flash');
    flash.classList.add('flash-active');
    setTimeout(() => {
        flash.classList.remove('flash-active');
    }, 100);
}

function getRandomEntry() {
    return DB[Math.floor(Math.random() * DB.length)];
}

// 1. Red Button (Shoot/Upload)
function simulateUpload() {
    triggerFlash();
    setTimeout(() => {
        showLoader(() => {
            const entry = getRandomEntry();
            document.getElementById('selected-img-preview').src = entry.img;
            document.getElementById('plate-input').value = entry.plate;
            setView('report');
        });
    }, 200);
}

// 2. Yellow Button (My Signals)
function openMySignals() {
    const container = document.getElementById('signal-list-container');
    container.innerHTML = ''; 

    DB.forEach(item => {
        const statusClass = item.status === 'approved' ? 'approved' : 'pending';
        const statusText = item.status === 'approved' ? 'Одобрен' : 'Обработка';
        
        const html = `
            <div class="signal-item" onclick="openViewer(${item.id})">
                <img src="${item.img}" alt="signal">
                <div class="signal-info">
                    <div class="signal-top">
                        <span class="plate-badge">${item.plate}</span>
                        <span class="status-text ${statusClass}">${statusText}</span>
                    </div>
                    <div class="signal-date">${item.date}</div>
                </div>
            </div>
        `;
        container.innerHTML += html;
    });

    setView('mysignals');
}

// 3. Green Button (Map)
function openMap() {
    showLoader(() => {
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

// 4. Purple Button (Random)
function openRandom() {
    showLoader(() => {
        const entry = getRandomEntry();
        renderViewer(entry);
        setView('viewer');
    });
}

function openPodMonth() {
    showLoader(() => {
        // Specifically car5 for month
        const entry = DB.find(x => x.img.includes('car5'));
        if(entry) {
            renderViewer(entry);
            document.getElementById('viewer-meta').innerHTML += '<br><span style="color:#AF52DE; font-weight:700">🏆 П.Е.Д.А.Л. на Месеца</span>';
        }
        setView('viewer');
    });
}

// 5. Blue Button (Achievements)
function openAchievements() {
    const list = document.getElementById('ach-list');
    list.innerHTML = '';
    
    const achievements = [
        { icon: 'camera', title: 'Първи кадър', unlocked: true },
        { icon: 'star', title: '5 Звезди', unlocked: true },
        { icon: 'verified', title: 'Верифициран', unlocked: true },
        { icon: 'public', title: 'Активист', unlocked: false },
        { icon: 'bolt', title: 'Светкавица', unlocked: false },
        { icon: 'military_tech', title: 'Генерал', unlocked: false }
    ];

    achievements.forEach(ach => {
        list.innerHTML += `
            <div class="ach-item ${ach.unlocked ? 'unlocked' : ''}">
                <div class="ach-icon">
                    <span class="material-icons-round">${ach.icon}</span>
                </div>
                <div class="ach-title">${ach.title}</div>
            </div>
        `;
    });
    
    setView('achievements');
}

// 6. Orange Button (Leaderboard)
function openLeaderboard() {
    const list = document.getElementById('lb-list');
    list.innerHTML = '';

    const users = [
        { name: "Ти", score: 1450, rank: 4 },
        { name: "Pesho_Golfa", score: 2890, rank: 1 },
        { name: "Mariya88", score: 2100, rank: 2 },
        { name: "Ivan_Taxi", score: 1850, rank: 3 },
        { name: "Vanko1", score: 1200, rank: 5 },
        { name: "Gosho", score: 950, rank: 6 }
    ];

    users.sort((a,b) => b.score - a.score);

    users.forEach((u, index) => {
        const isTop = index < 3 ? 'top' : '';
        const rank = index + 1;
        const html = `
            <div class="lb-item ${isTop}">
                <div class="lb-rank">${rank}</div>
                <div class="lb-avatar">${u.name.charAt(0)}</div>
                <div class="lb-name">${u.name} ${u.name === 'Ти' ? '(Ти)' : ''}</div>
                <div class="lb-score">${u.score}</div>
            </div>
        `;
        list.innerHTML += html;
    });

    setView('leaderboard');
}

// 7. Cyan Button (Stats)
function openStats() {
    const container = document.getElementById('stats-content');
    
    // Generate slight random variations
    const weekly = 120 + Math.floor(Math.random() * 20);
    const processed = 90 + Math.floor(Math.random() * 10);
    
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
    `;
    
    setView('stats');
}

// 8. Dark Button (Secret)
function openSecret() {
    secretPin = "";
    updatePinDots();
    setView('secret');
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