/**
 * localforage 的 drop-in 替换。
 *
 * Electron 下：数据以真实文件形式落到 exe 同级的 data/app 目录（见 sqc-fs.ts），
 * 方便直接查看、备份，以及把整个 SQC 文件夹拷走换机。
 * 浏览器 / 开发服务器下：继续使用原生 localforage（IndexedDB），行为完全不变。
 *
 * 业务代码只需把 `import localforage from "localforage"` 换成 `@/lib/sqc-storage`。
 */

import realLocalforage from "localforage";

import { createSqcStore, isElectronRuntime } from "@/lib/sqc-fs";

type StoreOptions = { name?: string; storeName?: string };

let defaultOptions: Required<StoreOptions> = { name: "infinite-canvas", storeName: "app_state" };
let defaultStore: ReturnType<typeof createSqcStore> | null = null;

function currentStore() {
    if (!defaultStore) defaultStore = createSqcStore(defaultOptions);
    return defaultStore;
}

const sqcLocalforage = {
    INDEXEDDB: realLocalforage.INDEXEDDB,
    WEBSQL: realLocalforage.WEBSQL,
    LOCALSTORAGE: realLocalforage.LOCALSTORAGE,
    createInstance: (options: StoreOptions = {}) =>
        isElectronRuntime()
            ? createSqcStore({ name: options.name || "infinite-canvas", storeName: options.storeName || "keyvaluepairs" })
            : realLocalforage.createInstance(options),
    config: (options: StoreOptions = {}) => {
        if (!isElectronRuntime()) return realLocalforage.config(options);
        defaultOptions = { name: options.name || defaultOptions.name, storeName: options.storeName || defaultOptions.storeName };
        defaultStore = null;
        return undefined;
    },
    ready: () => (isElectronRuntime() ? Promise.resolve() : realLocalforage.ready()),
    defineDriver: (...args: Parameters<typeof realLocalforage.defineDriver>) => realLocalforage.defineDriver(...args),
    setDriver: (...args: Parameters<typeof realLocalforage.setDriver>) => realLocalforage.setDriver(...args),
    getItem: <T>(key: string) => (isElectronRuntime() ? currentStore().getItem<T>(key) : realLocalforage.getItem<T>(key)),
    setItem: <T>(key: string, value: T) => (isElectronRuntime() ? currentStore().setItem<T>(key, value) : realLocalforage.setItem<T>(key, value)),
    removeItem: (key: string) => (isElectronRuntime() ? currentStore().removeItem(key) : realLocalforage.removeItem(key)),
    clear: () => (isElectronRuntime() ? currentStore().clear() : realLocalforage.clear()),
    length: () => (isElectronRuntime() ? currentStore().length() : realLocalforage.length()),
    key: (index: number) => (isElectronRuntime() ? currentStore().key(index) : realLocalforage.key(index)),
    keys: () => (isElectronRuntime() ? currentStore().keys() : realLocalforage.keys()),
    iterate: <T, U>(iterator: (value: T, key: string, iterationNumber: number) => U) =>
        isElectronRuntime() ? currentStore().iterate<T, U>(iterator) : realLocalforage.iterate<T, U>(iterator),
};

export default sqcLocalforage as unknown as typeof realLocalforage;
