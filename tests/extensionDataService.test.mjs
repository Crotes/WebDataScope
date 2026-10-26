import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createExtensionDataService } from '../src/background/services/extensionDataService.js';

const require = createRequire(import.meta.url);
const pako = require('../src/vendor/js/pako.min.js');
const msgpack = require('../src/vendor/js/msgpack.min.js');

function createStore({ json = null, arrayBuffer = null, infoData = {} } = {}) {
    return {
        normalizeDataPath(path) {
            return String(path).replace(/\\/g, '/').replace(/^data\//, '');
        },
        async getJson() { return json; },
        async getFileArrayBuffer() { return arrayBuffer; },
        async getInfoData(key) { return infoData[key] || null; },
    };
}

function createBundledFetch(files) {
    const calls = [];
    const fetchImpl = async path => {
        calls.push(path);
        if (!Object.prototype.hasOwnProperty.call(files, path)) {
            return new Response(null, { status: 404 });
        }
        return new Response(files[path]);
    };
    return { calls, fetchImpl };
}

function createService({ store = createStore(), files = {} } = {}) {
    const bundled = createBundledFetch(files);
    const service = createExtensionDataService({
        store,
        fetchImpl: bundled.fetchImpl,
        getDataUrl: path => path,
    });
    return { service, calls: bundled.calls };
}

function infoFixture() {
    return {
        USA_1: {
            sub_end_time: '2026-02-19',
            isos: {
                mean: { sharpe_ratio: 0.8 },
                total_count: 2,
                dataset: { analyst14: { count: 1 }, other: { count: 1 } },
                datafield: { adv20: { count: 2 }, close: { count: 1 } },
            },
            neutralization: {
                dataset: { analyst14: { count: 1 }, other: { count: 1 } },
                datafield: { adv20: { count: 2 }, close: { count: 1 } },
            },
        },
    };
}

test('imported JSON, binary and info shards take priority over bundled data', async () => {
    const importedInfo = infoFixture().USA_1;
    importedInfo.sub_end_time = 'imported';
    const { service, calls } = createService({
        store: createStore({
            json: ['imported'],
            arrayBuffer: Uint8Array.from([1, 2, 3]).buffer,
            infoData: { USA_1: importedInfo },
        }),
    });

    assert.deepEqual(await service.getJson('dataSetList.json'), ['imported']);
    assert.equal(await service.getCompressedBase64('report.bin'), 'AQID');
    const subset = await service.getInfoDataSubset({
        region: 'USA', delay: 1, datasetIds: ['analyst14'], datafieldIds: ['adv20'],
    });
    assert.equal(subset.USA_1.sub_end_time, 'imported');
    assert.deepEqual(Object.keys(subset.USA_1.isos.dataset), ['analyst14']);
    assert.deepEqual(Object.keys(subset.USA_1.isos.datafield), ['adv20']);
    assert.equal(calls.length, 0);
});

test('missing imported files fall back to bundled JSON and binary data', async () => {
    const { service, calls } = createService({
        files: {
            'dataSetList.json': new TextEncoder().encode(JSON.stringify(['bundled'])),
            'report.bin': Uint8Array.from([4, 5, 6]),
        },
    });

    assert.deepEqual(await service.getJson('data/dataSetList.json'), ['bundled']);
    assert.equal(await service.getCompressedBase64('data/report.bin'), 'BAUG');
    assert.deepEqual(calls, ['dataSetList.json', 'report.bin']);
});

test('bundled info data is decoded once and filtered to the requested records', async () => {
    const compressedInfo = pako.deflate(msgpack.encode(infoFixture()));
    const { service, calls } = createService({
        files: { 'oth/info_data.bin': compressedInfo },
    });
    const request = {
        region: 'USA', delay: 1, datasetIds: ['analyst14'], datafieldIds: ['adv20'],
    };

    const first = await service.getInfoDataSubset(request);
    const second = await service.getInfoDataSubset(request);
    assert.deepEqual(first, second);
    assert.equal(first.USA_1.sub_end_time, '2026-02-19');
    assert.deepEqual(Object.keys(first.USA_1.isos.dataset), ['analyst14']);
    assert.deepEqual(Object.keys(first.USA_1.neutralization.dataset), ['analyst14']);
    assert.deepEqual(Object.keys(first.USA_1.isos.datafield), ['adv20']);
    assert.deepEqual(Object.keys(first.USA_1.neutralization.datafield), ['adv20']);
    assert.deepEqual(calls, ['oth/info_data.bin']);
});

test('missing files and info shards report useful errors', async () => {
    const compressedInfo = pako.deflate(msgpack.encode(infoFixture()));
    const { service } = createService({
        files: { 'oth/info_data.bin': compressedInfo },
    });

    await assert.rejects(service.getJson('missing.json'), /Bundled data file not found: missing.json/);
    await assert.rejects(
        service.getInfoDataSubset({ region: 'CHN', delay: 1 }),
        /Info data shard not found for CHN_1/,
    );
});

test('the service reads and decodes the repository data files', { timeout: 30000 }, async () => {
    const [list, report, info] = await Promise.all([
        readFile(new URL('../data/dataSetList.json', import.meta.url)),
        readFile(new URL('../data/analyst11_EUR_TOP1200_Delay1.bin', import.meta.url)),
        readFile(new URL('../data/oth/info_data.bin', import.meta.url)),
    ]);
    const { service } = createService({
        files: {
            'dataSetList.json': list,
            'analyst11_EUR_TOP1200_Delay1.bin': report,
            'oth/info_data.bin': info,
        },
    });

    const dataSetList = await service.getJson('dataSetList.json');
    assert.equal(dataSetList.length, 160);
    assert.ok(dataSetList.includes('analyst11_EUR_TOP1200_Delay1'));

    const base64 = await service.getCompressedBase64('analyst11_EUR_TOP1200_Delay1.bin');
    const decoded = msgpack.decode(pako.inflate(Buffer.from(base64, 'base64')));
    assert.ok(Array.isArray(decoded.anl11_2_1e.Coverage));

    const subset = await service.getInfoDataSubset({
        region: 'USA', delay: 1, datasetIds: ['analyst14'], datafieldIds: ['adv20'],
    });
    assert.ok(subset.USA_1.isos.dataset.analyst14);
    assert.ok(subset.USA_1.isos.datafield.adv20);
    assert.equal(subset.USA_1.sub_end_time, '2026-02-17');
});
