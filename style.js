/* --- P.E.D.A.L. Interactive Demo Script --- */

// --- Phone Navigation Logic ---
let autoRotateInterval;
let isAutoRotating = true;

function setScreen(screenId, btnElement) {
    // 1. Stop auto-rotation if user interacts
    if (isAutoRotating && btnElement) {
        clearInterval(autoRotateInterval);
        isAutoRotating = false;
        
        // Hide hint
        const hint = document.querySelector('.phone-hint');
        if (hint) hint.style.opacity = '0';
    }

    // 2. Hide all screens
    document.querySelectorAll('.app-view').forEach(view => {
        view.classList.remove('active');
    });

    // 3. Show target screen
    const target = document.getElementById('view-' + screenId);
    if (target) target.classList.add('active');

    // 4. Update Nav Buttons
    document.querySelectorAll('.nav-item').forEach(nav => {
        nav.classList.remove('active');
        // Handle FAB separately color change
        if (nav.classList.contains('fab-wrapper')) {
            nav.querySelector('.fab-btn').style.background = (screenId === 'upload') ? '#fff' : '#FFC107';
        }
    });

    // 5. Highlight active button
    if (btnElement) {
        btnElement.classList.add('active');
    } else {
        // Find button by onclick attribute if simulated (auto-rotate)
        const btns = document.querySelectorAll(`.nav-item[onclick*="'${screenId}'"]`);
        if (btns.length > 0) btns[0].classList.add('active');
    }

    // 6. Special Camera Shutter Animation
    if (screenId === 'upload') {
        setTimeout(() => {
            const shutter = document.querySelector('.shutter-button-inner');
            if (shutter) {
                shutter.style.transform = "scale(0.8)";
                setTimeout(() => shutter.style.transform = "scale(1)", 150);
            }
        }, 800);
    }
}

// --- Auto Rotate Screens Demo ---
function startAutoRotate() {
    const screens = ['home', 'upload', 'rank'];
    let currentIdx = 0;

    autoRotateInterval = setInterval(() => {
        currentIdx = (currentIdx + 1) % screens.length;
        setScreen(screens[currentIdx], null);
        
        // Show Toast on Upload screen simulation
        if (screens[currentIdx] === 'upload') {
            setTimeout(showToast, 1500);
        }
    }, 4500); // Switch every 4.5 seconds
}

function showToast() {
    const toast = document.querySelector('.toast-notification');
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2000);
}


// --- Main Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    
    // 1. Dynamic Year
    const yearSpan = document.getElementById('year');
    if (yearSpan) yearSpan.textContent = new Date().getFullYear();

    // 2. Mobile Menu Logic
    const menuBtn = document.querySelector('.mobile-menu-btn');
    const menuOverlay = document.querySelector('.mobile-menu-overlay');
    
    if (menuBtn) {
        menuBtn.addEventListener('click', () => {
            menuBtn.classList.toggle('active');
            menuOverlay.classList.toggle('active');
            // Prevent scrolling when menu is open
            document.body.style.overflow = menuOverlay.classList.contains('active') ? 'hidden' : 'auto';
        });
    }

    // Close menu on link click
    document.querySelectorAll('.mm-link').forEach(link => {
        link.addEventListener('click', () => {
            menuBtn.classList.remove('active');
            menuOverlay.classList.remove('active');
            document.body.style.overflow = 'auto';
        });
    });

    // 3. Scroll Animations (Intersection Observer)
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));

    // 4. Update Clock
    const updateClock = () => {
        const now = new Date();
        const clock = document.getElementById('clock');
        if (clock) {
            clock.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
    };
    setInterval(updateClock, 1000);
    updateClock();

    // 5. Start Demo
    startAutoRotate();
    
    // Camera Shutter Interaction
    const shutterBtn = document.querySelector('.shutter-button-outer');
    if (shutterBtn) {
        shutterBtn.addEventListener('click', () => {
             // Stop auto rotate if user manually takes photo
             clearInterval(autoRotateInterval);
             isAutoRotating = false;
             showToast();
             
             // Visual feedback
             const inner = document.querySelector('.shutter-button-inner');
             inner.style.transform = "scale(0.8)";
             setTimeout(() => inner.style.transform = "scale(1)", 100);
        });
    }
});