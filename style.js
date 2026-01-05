/* P.E.D.A.L. Interactive Demo Logic v2.4 */

const DB = [
    { id: 1, img: "car1.jpeg", plate: "CB 4816 TM", status: "approved", date: "02.01.2026" },
    { id: 2, img: "car2.JPG", plate: "CO 3708 CX", status: "pending", date: "05.01.2026" },
    { id: 3, img: "car3.jpeg", plate: "CA 1290 HP", status: "approved", date: "28.12.2025" },
    { id: 4, img: "car4.jpeg", plate: "CB 9921 KA", status: "pending", date: "06.01.2026" },
    { id: 5, img: "car5.jpeg", plate: "TX 5502 PB", status: "approved", date: "15.12.2025" },
    { id: 6, img: "car6.JPG", plate: "PB 1188 MX", status: "pending", date: "06.01.2026" }
];

function setView(viewId) {
    document.querySelectorAll('.app-view').forEach(el => {
        el.classList.remove('active');
    });
    document.getElementById('view-' + viewId).classList.add('active');
}

function goBack(targetView) {
    setView(targetView);
}

function showLoader(callback) {
    const loader = document.getElementById('global-loader');
    loader.classList.add('active');
    setTimeout(() => {
        loader.classList.remove('active');
        callback();
    }, 800);
}

function getRandomEntry() {
    return DB[Math.floor(Math.random() * DB.length)];
}

// 1. Red Button (Shoot/Upload)
function simulateUpload() {
    showLoader(() => {
        const entry = getRandomEntry();
        document.getElementById('selected-img-preview').src = entry.img;
        document.getElementById('plate-input').value = entry.plate;
        setView('report');
    });
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
        const container = document.getElementById('map-container');
        const oldPins = container.querySelectorAll('.dynamic-pin');
        oldPins.forEach(p => p.remove());

        // Approximated map percentages for the new map SVG
        const coords = [
            {top: '45%', left: '25%'}, // Sofia
            {top: '60%', left: '80%'}, // Burgas
            {top: '30%', left: '85%'}, // Varna
            {top: '65%', left: '50%'}, // Plovdiv
            {top: '55%', left: '15%'}, // Kyustendil
            {top: '20%', left: '80%'}  // Dobrich
        ];

        DB.forEach((item, index) => {
            const pos = coords[index % coords.length];
            const pin = document.createElement('div');
            pin.className = 'map-pin dynamic-pin';
            pin.style.top = pos.top;
            pin.style.left = pos.left;
            pin.innerHTML = `<img src="${item.img}">`;
            pin.onclick = () => openViewer(item.id);
            container.appendChild(pin);
        });

        setView('map');
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

    // Sort descending
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

// Helper to open specific viewer
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