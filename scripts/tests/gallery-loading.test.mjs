import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../gallery.js', import.meta.url), 'utf8');

function loadGallery() {
    const events = new Map();
    const context = vm.createContext({
        window: { setInterval() {}, PedalAuth: { subscribe() {}, init: () => new Promise(() => {}) } },
        document: { addEventListener: (name, callback) => events.set(name, callback), getElementById: () => null },
        console,
        URL,
        AbortSignal,
    });
    vm.runInContext(source, context);
    return { context, events };
}

test('public gallery and deep links load while auth and rankings remain pending', async () => {
    const { context, events } = loadGallery();
    vm.runInContext(`
        var calls = [];
        getInitialDeepLinkState = () => null;
        restoreSeenUrls = bindViewerEvents = updateComposerCounter = syncComposerAvailability = () => {};
        loadManifest = async () => { calls.push('manifest'); return true; };
        renderRandomBatch = () => calls.push('grid');
        maybeOpenInitialDeepLink = () => calls.push('deep-link');
        loadRankings = () => { calls.push('rankings'); return new Promise(() => {}); };
    `, context);
    await Promise.race([
        events.get('DOMContentLoaded')(),
        new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Public gallery blocked')), 500); timer.unref(); }),
    ]);
    assert.deepEqual(Array.from(context.calls), ['manifest', 'grid', 'deep-link', 'rankings']);
});

test('rankings fetch has a bounded timeout', async () => {
    const { context } = loadGallery();
    let timeout;
    context.AbortSignal = { timeout(ms) { timeout = ms; return 'abort-signal'; } };
    context.fetch = async (_, options) => {
        assert.equal(options.signal, 'abort-signal');
        return { ok: true, json: async () => ({ items: [] }) };
    };
    await vm.runInContext("fetchRankingPayload('liked')", context);
    assert.equal(timeout, 8000);
});
