// Shared keyboard focus handling for the gallery's nested viewer, comments and login.
window.PedalDialogFocus = (() => {
    const stack = [];
    const focusableSelector = 'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const visibleControls = root => [...root.querySelectorAll(focusableSelector)]
        .filter(element => element.getClientRects().length && !element.closest('[hidden], [aria-hidden="true"]'));

    document.addEventListener('keydown', event => {
        const active = stack.at(-1);
        if (!active || event.key !== 'Tab') return;
        const controls = visibleControls(active.root);
        const first = controls[0] || active.root;
        const last = controls.at(-1) || active.root;
        if (!active.root.contains(document.activeElement)
            || (event.shiftKey && document.activeElement === first)
            || (!event.shiftKey && document.activeElement === last)
            || !controls.length) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
        }
    });

    return {
        open(root, initialFocus) {
            if (!root || stack.some(entry => entry.root === root)) return;
            stack.push({ root, previous: document.activeElement });
            root.setAttribute('tabindex', '-1');
            (initialFocus || visibleControls(root)[0] || root).focus({ preventScroll: true });
        },
        close(root) {
            const index = stack.findIndex(entry => entry.root === root);
            if (index < 0) return;
            const [{ previous }] = stack.splice(index);
            if (previous?.isConnected && previous.getClientRects().length
                && !previous.closest('[aria-hidden="true"]')) {
                previous.focus({ preventScroll: true });
            }
        },
    };
})();
