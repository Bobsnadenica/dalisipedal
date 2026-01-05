/* P.E.D.A.L. Interactive Demo Logic */

const DB = [
    { img: "car1.jpeg", plate: "CB 4816 TM" },
    { img: "car2.JPG", plate: "CO 3708 CX" }
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
    setView('mysignals');
}

// 3. Green Button (Map)
function openMap() {
    showLoader(() => {
        setView('map');
    });
}

// 4. Purple Button (Random)
function openRandom() {
    showLoader(() => {
        const entry = getRandomEntry();
        document.getElementById('viewer-img').src = entry.img;
        document.getElementById('viewer-plate').innerText = entry.plate;
        
        const now = new Date();
        document.getElementById('viewer-date').innerText = now.toLocaleDateString();
        
        setView('viewer');
    });
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