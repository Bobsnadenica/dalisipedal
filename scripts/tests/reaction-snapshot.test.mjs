import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReactionSummariesSnapshot } from '../generate_public_manifests.mjs';

const config = { appsyncEndpoint: 'https://example.test/graphql', appsyncApiKey: 'test-key' };
const gallery = {
    items: [{ key: 'approved/a.jpg' }, { key: 'approved/b.jpg' }],
    featured: { week: { key: 'approved/a.jpg' }, month: { key: 'approved/month.jpg' } },
};
const ninja = { items: [{ key: 'approved/ninja/c.jpg' }] };
const response = (items, nextToken = null) => ({
    ok: true,
    json: async () => ({ data: { syncMediaReactionSummaries: { items, nextToken } } }),
});

test('one read preserves 652 entries, counts, ordering and public fields', async t => {
    const keys = Array.from({ length: 652 }, (_, index) => `approved/${index}.jpg`);
    const request = t.mock.method(globalThis, 'fetch', async (url, options) => {
        assert.equal(url, config.appsyncEndpoint);
        const body = JSON.parse(options.body);
        assert.equal(body.variables.limit, 1000);
        assert.equal(body.variables.nextToken, null);
        assert.ok(!body.query.includes('lastSync'));
        assert.ok(!body.query.includes('viewerReaction'));
        return response([
            { mediaKey: keys[0], likes: 7, dislikes: 2, updatedAt: '2026-09-19T00:00:00Z', _deleted: false, userId: 'must-not-leak' },
            { mediaKey: keys[1], likes: 99, dislikes: 99, _deleted: true },
            { mediaKey: 'approved/outside-selection.jpg', likes: 5, dislikes: 0 },
            null,
        ]);
    });
    const result = await buildReactionSummariesSnapshot(config, { items: keys.map(key => ({ key })) }, { items: [] });
    assert.equal(request.mock.callCount(), 1);
    assert.equal(result.version, 1);
    assert.equal(result.itemCount, 652);
    assert.ok(Number.isFinite(Date.parse(result.generatedAt)));
    assert.deepEqual(result.items.map(item => item.mediaKey), keys);
    assert.deepEqual(result.items[0], { mediaKey: keys[0], likes: 7, dislikes: 2, updatedAt: '2026-09-19T00:00:00Z' });
    assert.deepEqual(result.items[1], { mediaKey: keys[1], likes: 0, dislikes: 0, updatedAt: null });
    assert.deepEqual(result.items[651], { mediaKey: keys[651], likes: 0, dislikes: 0, updatedAt: null });
    assert.ok(result.items.every(item => Object.keys(item).join(',') === 'mediaKey,likes,dislikes,updatedAt'));
});

test('follows pagination through empty pages and deduplicates featured keys', async t => {
    const tokens = [];
    t.mock.method(globalThis, 'fetch', async (_, options) => {
        const token = JSON.parse(options.body).variables.nextToken;
        tokens.push(token);
        if (token === null) return response([], 'page-2');
        if (token === 'page-2') return response([{ mediaKey: 'approved/b.jpg', likes: 3, dislikes: 1 }], 'page-3');
        return response([{ mediaKey: 'approved/ninja/c.jpg', likes: 2, dislikes: 0 }]);
    });
    const result = await buildReactionSummariesSnapshot(config, gallery, ninja);
    assert.deepEqual(tokens, [null, 'page-2', 'page-3']);
    assert.deepEqual(result.items.map(item => item.mediaKey), ['approved/a.jpg', 'approved/b.jpg', 'approved/month.jpg', 'approved/ninja/c.jpg']);
    assert.equal(result.items[1].likes, 3);
    assert.equal(result.items[3].likes, 2);
});

test('does not fetch for an empty selection', async t => {
    const request = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected request'); });
    const result = await buildReactionSummariesSnapshot(config, { items: [] }, { items: [] });
    assert.deepEqual(result.items, []);
    assert.equal(request.mock.callCount(), 0);
});

test('fails on GraphQL errors instead of publishing zero counts', async t => {
    const request = t.mock.method(globalThis, 'fetch', async () => ({
        ok: true,
        json: async () => ({ data: null, errors: [{ message: 'Unauthorized' }] }),
    }));
    await assert.rejects(buildReactionSummariesSnapshot(config, gallery, ninja), /Unauthorized/);
    assert.equal(request.mock.callCount(), 1);
});

test('fails on malformed pages', async t => {
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ data: {} }) }));
    await assert.rejects(buildReactionSummariesSnapshot(config, gallery, ninja), /Invalid reaction summary page/);
});

test('fails if a later page errors without returning partial counts', async t => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
        calls += 1;
        return calls === 1 ? response([{ mediaKey: 'approved/a.jpg', likes: 1 }], 'page-2') : { ok: false, status: 403 };
    });
    await assert.rejects(buildReactionSummariesSnapshot(config, gallery, ninja), /HTTP 403/);
});

test('rejects a repeated pagination token', async t => {
    const request = t.mock.method(globalThis, 'fetch', async () => response([], 'same-token'));
    await assert.rejects(buildReactionSummariesSnapshot(config, gallery, ninja), /Repeated reaction summary pagination token/);
    assert.equal(request.mock.callCount(), 2);
});

test('retries throttled pages and stops after the bounded attempt count', async t => {
    t.mock.method(globalThis, 'setTimeout', callback => { queueMicrotask(callback); return 0; });
    let fail = true;
    const request = t.mock.method(globalThis, 'fetch', async () => {
        if (fail) return { ok: false, status: 429 };
        return response([]);
    });
    await assert.rejects(buildReactionSummariesSnapshot(config, gallery, ninja), /HTTP 429/);
    assert.equal(request.mock.callCount(), 6);
    fail = false;
    const result = await buildReactionSummariesSnapshot(config, gallery, ninja);
    assert.equal(result.itemCount, 4);
});
