import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../style.js', import.meta.url), 'utf8');
function loadDemo() {
    const assets = [];
    const context = vm.createContext({
        document: {
            addEventListener() {},
            createElement: tag => ({ tag, remove() { this.removed = true; } }),
            head: { append: (...items) => assets.push(...items) },
        },
        setTimeout: () => 1,
        clearTimeout() {},
    });
    vm.runInContext(source, context);
    return { context, assets };
}

test('map resources load once on demand and wait for both CSS and JavaScript', async () => {
    const { context, assets } = loadDemo();
    assert.equal(assets.length, 0);
    const first = vm.runInContext('loadDemoMap()', context);
    assert.equal(vm.runInContext('loadDemoMap()', context), first);
    assert.equal(assets.length, 2);
    let done = false;
    first.then(() => { done = true; });
    assets[1].onload();
    await Promise.resolve();
    assert.equal(done, false);
    assets[0].onload();
    await first;
    assert.equal(done, true);
});

test('failed CSS after JavaScript loads can retry without leaving broken assets', async () => {
    const { context, assets } = loadDemo();
    const first = vm.runInContext('loadDemoMap()', context);
    context.L = {}; // Script can succeed before its stylesheet fails.
    assets[1].onload();
    assets[0].onerror();
    await assert.rejects(first, /Картата не се зареди/);
    assert.ok(assets.every(asset => asset.removed));
    const retry = vm.runInContext('loadDemoMap()', context);
    assert.equal(assets.length, 4);
    assets[2].onload();
    assets[3].onload();
    await retry;
});
