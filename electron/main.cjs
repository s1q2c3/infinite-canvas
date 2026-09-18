const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");

const isDev = !app.isPackaged;

// 便携数据目录：打包后 = exe 同级 data/；开发时 = 项目 dev-data/
const dataDir = isDev ? path.join(__dirname, "..", "dev-data") : path.join(path.dirname(process.execPath), "data");
// 应用可读数据根（JSON / 媒体文件都放这里，渲染层只能操作这个子树）
const appDataDir = path.join(dataDir, "app");

// 必须在 ready 前设置，让 Chromium 自带的运行时缓存也落进便携目录（.runtime 为隐藏缓存，非业务数据）
app.setPath("userData", path.join(dataDir, ".runtime"));

// 渲染层传相对路径，解析并做沙箱校验，防止 .. 穿越
function abs(relPath) {
    if (typeof relPath !== "string" || relPath.includes("\0")) throw new Error("invalid path");
    const p = path.resolve(appDataDir, relPath);
    if (p !== appDataDir && !p.startsWith(appDataDir + path.sep)) throw new Error("path outside data root: " + relPath);
    return p;
}

async function safe(fn, fallback) {
    try {
        return await fn();
    } catch {
        return fallback;
    }
}

ipcMain.handle("sqc:readText", (_e, rel) => safe(() => fs.readFile(abs(rel), "utf8"), null));
ipcMain.handle("sqc:writeText", (_e, rel, text) =>
    safe(async () => {
        const p = abs(rel);
        await fs.mkdir(path.dirname(p), { recursive: true });
        const tmp = p + ".tmp";
        await fs.writeFile(tmp, String(text), "utf8");
        await fs.rename(tmp, p); // 原子写，防止写到一半断电损坏
        return true;
    }, false),
);
ipcMain.handle("sqc:readBlob", (_e, rel) =>
    safe(async () => {
        const b = await fs.readFile(abs(rel));
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); // 返回 ArrayBuffer
    }, null),
);
ipcMain.handle("sqc:writeBlob", (_e, rel, buffer) =>
    safe(async () => {
        const p = abs(rel);
        await fs.mkdir(path.dirname(p), { recursive: true });
        const tmp = p + ".tmp";
        await fs.writeFile(tmp, Buffer.from(buffer));
        await fs.rename(tmp, p);
        return true;
    }, false),
);
ipcMain.handle("sqc:remove", (_e, rel) => safe(() => fs.rm(abs(rel), { recursive: true, force: true }), true));
ipcMain.handle("sqc:exists", (_e, rel) =>
    safe(async () => {
        await fs.access(abs(rel));
        return true;
    }, false),
);
ipcMain.handle("sqc:list", (_e, rel) =>
    safe(async () => {
        const entries = await fs.readdir(abs(rel), { withFileTypes: true });
        return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
    }, []),
);
ipcMain.handle("sqc:stat", (_e, rel) =>
    safe(async () => {
        const s = await fs.stat(abs(rel));
        return { size: s.size, mtimeMs: s.mtimeMs };
    }, null),
);
ipcMain.handle("sqc:getPaths", () => ({ dataDir, appDataDir, isDev }));

let win = null;

async function createWindow() {
    win = new BrowserWindow({
        width: 1280,
        height: 832,
        minWidth: 900,
        minHeight: 600,
        show: false,
        backgroundColor: "#0f0f0f",
        title: "SQC 无限画布",
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            spellcheck: false,
        },
    });

    win.once("ready-to-show", () => win.show());

    // 开发时读 web/dist；打包后读随包携带的 renderer/ 目录
    const htmlPath = isDev ? path.join(__dirname, "..", "web", "dist", "index.html") : path.join(__dirname, "renderer", "index.html");
    win.loadFile(htmlPath);

    // 外部链接（http/https）用系统浏览器打开，不在应用内新开窗口
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) {
            shell.openExternal(url);
            return { action: "deny" };
        }
        return { action: "allow" };
    });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
