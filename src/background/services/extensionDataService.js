import * as bundledPako from '../../vendor/js/pako.min.js';
import * as bundledMsgpack from '../../vendor/js/msgpack.min.js';

const INFO_DATA_PATH = 'oth/info_data.bin';

function arrayBufferToBase64(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const chunkSize = 0x8000;
    let binary = '';

    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
}

function pickInfoRecords(source, ids) {
    const result = {};
    if (!source || !Array.isArray(ids)) return result;

    for (const id of ids) {
        if (Object.prototype.hasOwnProperty.call(source, id)) {
            result[id] = source[id];
        }
    }

    return result;
}

export function createExtensionDataService(options = {}) {
    const store = options.store || globalThis.WQPDataStore;
    const fetchImpl = options.fetchImpl || ((...args) => globalThis.fetch(...args));
    const getDataUrl = options.getDataUrl || (path => chrome.runtime.getURL(`data/${path}`));
    let bundledInfoDataPromise = null;

    function getStore() {
        if (!store) throw new Error('WQPDataStore is not available');
        return store;
    }

    async function readBundledArrayBuffer(path) {
        const response = await fetchImpl(getDataUrl(path));
        if (!response.ok) {
            throw new Error(`Bundled data file not found: ${path} (HTTP ${response.status})`);
        }
        return response.arrayBuffer();
    }

    async function getJson(path) {
        const normalizedPath = getStore().normalizeDataPath(path);
        const importedData = await getStore().getJson(normalizedPath);
        if (importedData !== null) return importedData;

        const arrayBuffer = await readBundledArrayBuffer(normalizedPath);
        return JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(arrayBuffer)));
    }

    async function getCompressedBase64(path) {
        const normalizedPath = getStore().normalizeDataPath(path);
        const importedData = await getStore().getFileArrayBuffer(normalizedPath);
        const arrayBuffer = importedData || await readBundledArrayBuffer(normalizedPath);
        return arrayBufferToBase64(arrayBuffer);
    }

    async function loadBundledInfoData() {
        if (!bundledInfoDataPromise) {
            bundledInfoDataPromise = (async () => {
                const arrayBuffer = await readBundledArrayBuffer(INFO_DATA_PATH);
                const pakoApi = globalThis.pako || bundledPako.default || bundledPako;
                const msgpackApi = globalThis.msgpack || bundledMsgpack.default || bundledMsgpack;
                const inflatedData = pakoApi.inflate(new Uint8Array(arrayBuffer));
                return msgpackApi.decode(new Uint8Array(inflatedData));
            })();
        }

        try {
            return await bundledInfoDataPromise;
        } catch (error) {
            bundledInfoDataPromise = null;
            throw error;
        }
    }

    async function getRegionInfoData(key) {
        const importedData = await getStore().getInfoData(key);
        if (importedData) return importedData;

        const bundledData = await loadBundledInfoData();
        if (!bundledData[key]) {
            throw new Error(`Info data shard not found for ${key} in imported or bundled data.`);
        }
        return bundledData[key];
    }

    async function getInfoDataSubset(msg) {
        const { region, delay, datasetIds = [], datafieldIds = [] } = msg;
        if (!region || !delay) {
            throw new Error('region and delay are required');
        }

        const key = `${region}_${delay}`;
        const regionData = await getRegionInfoData(key);
        const isos = regionData.isos || {};
        const neutralization = regionData.neutralization || {};

        return {
            [key]: {
                sub_end_time: regionData.sub_end_time,
                isos: {
                    mean: isos.mean,
                    total_count: isos.total_count,
                    dataset: pickInfoRecords(isos.dataset, datasetIds),
                    datafield: pickInfoRecords(isos.datafield, datafieldIds),
                },
                neutralization: {
                    dataset: pickInfoRecords(neutralization.dataset, datasetIds),
                    datafield: pickInfoRecords(neutralization.datafield, datafieldIds),
                },
            },
        };
    }

    return {
        getJson,
        getCompressedBase64,
        getInfoDataSubset,
    };
}
