/* P.E.D.A.L. Interactive Demo Logic */

let selectedPlate = "";
let selectedImg = "";

// Navigate between screens in phone
function setView(viewId) {
    // Hide all
    document.querySelectorAll('.app-view').forEach(el => {
        el.classList.remove('active');
    });
    // Show target
    document.getElementById(viewId).classList.add('active');
}

function goToGallery() {
    setView('view-gallery');
}

function goBack(targetView) {
    setView('view-' + targetView);
}

// User selects a car from gallery
function selectPhoto(imgSrc, plateNum) {
    selectedImg = imgSrc;
    selectedPlate = plateNum;

    // Populate Report View
    document.getElementById('selected-img-preview').src = imgSrc;
    document.getElementById('plate-input').value = plateNum;

    // Go to Report
    setView('view-report');
}

// Simulate API submission
function submitReport() {
    const btn = document.querySelector('.btn-submit');
    const originalText = btn.innerText;
    
    // Loading state
    btn.innerText = "ИЗПРАЩАНЕ...";
    btn.style.opacity = "0.7";

    setTimeout(() => {
        // Reset button
        btn.innerText = originalText;
        btn.style.opacity = "1";

        // Show success overlay
        const success = document.getElementById('success-screen');
        success.classList.add('show');

        // After 2s, return home
        setTimeout(() => {
            success.classList.remove('show');
            setView('view-dashboard');
        }, 2000);

    }, 1500);
}

// --- General Site Scripts ---
document.addEventListener('DOMContentLoaded', () => {
    // Clock
    setInterval(() => {
        const now = new Date();
        document.getElementById('clock').innerText = 
            now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }, 1000);

    // Fade-in Elements on scroll
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) entry.target.classList.add('visible');
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));
    
    // Year
    document.getElementById('year').textContent = new Date().getFullYear();
});