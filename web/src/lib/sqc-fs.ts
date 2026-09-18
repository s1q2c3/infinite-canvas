/**
 * SQC 便携文件存储后端。
 *
 * 把 localforage 的键值语义映射到真实文件系统：每个 store 对应一个目录，每个 key 对应一个文件，
 * 方便直接查看、备份和整目录拷走。仅在 Electron 下启用；网页版继续走 IndexedDB（见 sqc-storage.ts）。
 *
 * 落盘位置：<exe 同级>/data/app/<name>/<storeName>/<key>.<ext>
 */

export type ElectronFileApi = {
    isElectron: true;
    readText: (rel: string) => Promise<string | null>;
    writeText: (rel: string, text: string) => Promise<boolean>;
    readBlob: (rel: string) => Promise<ArrayBuffer | null>;
    writeBlob: (rel: string, buffer: ArrayBuffer) => Promise<boolean>;
    remove: (rel: string) => Promise<boolean>;
    exists: (rel: string) => Promise<boolean>;
    list: (rel: string) => Promise<Array<{ name: string; isDirectory: boolean }>>;
    stat: (rel: string) => Promise<{ size: number; mtimeMs: number } | null>;
    getPaths: () => Promise<{ dataDir: string; appDataDir: string; isDev: boolean }>;
};

export function getElectronApi(): ElectronFileApi | null {
    if (typeof window === "undefined") return null;
    const api = (window as unknown as { electronAPI?: ElectronFileApi }).electronAPI;
    return api && api.isElectron ? api : null;
}

export const isElectronRuntime = () => getElectronApi() !== null;

/** 数据格式版本：上游改了本地存储结构时，在这里加迁移分支。 */
export const SQC_SCHEMA_VERSION = 1;

const BLOB_MARK = "__sqcBlob";
const DATE_MARK = "__sqcDate";
const JSON_EXT = "json";

/** 媒体扩展名 <-> MIME，写盘时保留真实扩展名，方便双击直接打开。 */
const MIME_BY_EXT: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    avif: "image/avif",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    mkv: "video/x-matroska",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    flac: "audio/flac",
};

const EXT_BY_MIME: Record<string, string> = Object.entries(MIME_BY_EXT).reduce(
    (acc, [ext, mime]) => {
        if (!acc[mime]) acc[mime] = ext;
        return acc;
    },
    {} as Record<string, string>,
);

function extForMime(mime: string) {
    const clean = (mime || "").split(";")[0].trim().toLowerCase();
    return EXT_BY_MIME[clean] || "bin";
}

function mimeForExt(ext: string) {
    return MIME_BY_EXT[ext.toLowerCase()] || "";
}

/** key 里可能有 : / \ 等非法文件名字符，用 URL 编码保证可逆且无冲突。 */
const encodeKey = (key: string) => encodeURIComponent(key);
const decodeKey = (name: string) => {
    try {
        return decodeURIComponent(name);
    } catch {
        return name;
    }
};

function blobToBase64(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || "");
            resolve(result.slice(result.indexOf(",") + 1));
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

function base64ToBlob(base64: string, mime: string) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

/** 写盘前把 Blob / Date 转成可 JSON 化的标记结构。 */
async function toPlain(value: unknown): Promise<unknown> {
    if (value instanceof Blob) return { [BLOB_MARK]: true, type: value.type || "", data: await blobToBase64(value) };
    if (value instanceof Date) return { [DATE_MARK]: true, value: value.toISOString() };
    if (Array.isArray(value)) return Promise.all(value.map((item) => toPlain(item)));
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) out[k] = await toPlain(v);
        return out;
    }
    return value;
}

/** 读盘后还原 Blob / Date。 */
function fromPlain(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => fromPlain(item));
    if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        if (obj[BLOB_MARK] === true) return base64ToBlob(String(obj.data || ""), String(obj.type || ""));
        if (obj[DATE_MARK] === true) return new Date(String(obj.value));
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj)) out[k] = fromPlain(v);
        return out;
    }
    return value;
}

/** IPC 传回的二进制在不同 Electron 版本下可能是 ArrayBuffer / Uint8Array / Buffer 形态。 */
function toUint8(buffer: ArrayBuffer | Uint8Array | { data?: number[] } | null): Uint8Array<ArrayBuffer> {
    if (buffer instanceof Uint8Array) return new Uint8Array(buffer);
    if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer);
    const legacy = buffer as { data?: number[] } | null;
    return new Uint8Array(Array.isArray(legacy?.data) ? legacy.data : []);
}

type StoredEntry = { key: string; name: string; ext: string };

export type SqcStoreOptions = { name: string; storeName: string };

export function createSqcStore(options: SqcStoreOptions) {
    const dirRel = `${options.name}/${options.storeName}`;
    const apiOrNull = getElectronApi();
    if (!apiOrNull) throw new Error("SQC file store requires the Electron runtime");
    const api: ElectronFileApi = apiOrNull;

    async function listEntries(): Promise<StoredEntry[]> {
        const entries = await api.list(dirRel);
        const map = new Map<string, StoredEntry>();
        for (const entry of entries) {
            if (entry.isDirectory || entry.name.endsWith(".tmp")) continue;
            const dot = entry.name.lastIndexOf(".");
            if (dot <= 0) continue;
            const ext = entry.name.slice(dot + 1);
            const key = decodeKey(entry.name.slice(0, dot));
            const existing = map.get(key);
            // 同一 key 正常只有一个文件；万一两种格式并存，以 JSON 为准
            if (!existing || (ext === JSON_EXT && existing.ext !== JSON_EXT)) map.set(key, { key, name: entry.name, ext });
        }
        return Array.from(map.values());
    }

    async function readFileEntry(entry: StoredEntry): Promise<unknown> {
        const rel = `${dirRel}/${entry.name}`;
        if (entry.ext === JSON_EXT) {
            const text = await api.readText(rel);
            if (text === null) return null;
            try {
                return fromPlain(JSON.parse(text));
            } catch {
                return null;
            }
        }
        const buffer = await api.readBlob(rel);
        if (!buffer) return null;
        return new Blob([toUint8(buffer) as BlobPart], { type: mimeForExt(entry.ext) });
    }

    async function getItem<T>(key: string): Promise<T | null> {
        const encoded = encodeKey(key);
        const jsonName = `${encoded}.${JSON_EXT}`;
        if (await api.exists(`${dirRel}/${jsonName}`)) return (await readFileEntry({ key, name: jsonName, ext: JSON_EXT })) as T | null;
        const match = (await listEntries()).find((entry) => entry.key === key);
        return match ? ((await readFileEntry(match)) as T | null) : null;
    }

    async function setItem<T>(key: string, value: T): Promise<T> {
        const base = `${dirRel}/${encodeKey(key)}`;
        if (value instanceof Blob) {
            await api.writeBlob(`${base}.${extForMime(value.type)}`, await value.arrayBuffer());
            return value;
        }
        await api.writeText(`${base}.${JSON_EXT}`, JSON.stringify(await toPlain(value)));
        return value;
    }

    async function removeItem(key: string): Promise<void> {
        const matches = (await listEntries()).filter((entry) => entry.key === key);
        await Promise.all(matches.map((entry) => api.remove(`${dirRel}/${entry.name}`)));
    }

    async function keys(): Promise<string[]> {
        return (await listEntries()).map((entry) => entry.key);
    }

    async function clear(): Promise<void> {
        await api.remove(dirRel);
    }

    async function iterate<T, U>(iterator: (value: T, key: string, iterationNumber: number) => U): Promise<U | undefined> {
        const entries = await listEntries();
        for (let index = 0; index < entries.length; index += 1) {
            const value = (await readFileEntry(entries[index])) as T;
            const result = iterator(value, entries[index].key, index);
            if (result !== undefined) return result;
        }
        return undefined;
    }

    return {
        driver: () => "sqcFileSystem",
        ready: () => Promise.resolve(),
        getItem,
        setItem,
        removeItem,
        clear,
        keys,
        length: async () => (await keys()).length,
        key: async (index: number) => (await keys())[index] ?? null,
        iterate,
    };
}

/** 数据根版本标记：将来上游改了本地存储结构，在这里按版本逐级迁移。 */
export async function ensureSqcDataRoot(appVersion: string) {
    const api = getElectronApi();
    if (!api) return;
    const rel = "infinite-canvas/_meta.json";
    let from = 0;
    const text = await api.readText(rel);
    if (text) {
        try {
            from = Number((JSON.parse(text) as { schemaVersion?: number }).schemaVersion) || 0;
        } catch {
            from = 0;
        }
    }
    if (from === SQC_SCHEMA_VERSION) return;
    await api.writeText(
        rel,
        JSON.stringify({ app: "sqc-infinite-canvas", appVersion, schemaVersion: SQC_SCHEMA_VERSION, upgradedFrom: from, updatedAt: new Date().toISOString() }, null, 2),
    );
}
