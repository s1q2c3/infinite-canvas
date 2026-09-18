const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const { spawn } = require("node:child_process");


// Chromium 计算字体/着色器缓存目录时会读 SystemDrive 环境变量；进程环境里没有这个变量时，
// 它会退化成字面量 "%SystemDrive%"，再当成相对路径在当前工作目录下生成垃圾目录。
// 这里补上默认值，保证便携文件夹始终干净。
if (!process.env.SystemDrive) process.env.SystemDrive = path.parse(process.execPath).root.replace(/[\\/]+$/, "") || "C:";
if (!process.env.SystemRoot) process.env.SystemRoot = `${process.env.SystemDrive}\\Windows`;

const isDev = !app.isPackaged;

// 便携数据目录：打包后 = exe 同级 data/；开发时 = 项目 dev-data/
const dataDir = isDev ? path.join(__dirname, "..", "dev-data") : path.join(path.dirname(process.execPath), "data");
// 应用可读数据根（JSON / 媒体文件都放这里，渲染层只能操作这个子树）
const appDataDir = path.join(dataDir, "app");
// Chromium 的运行时缓存（非业务数据，可删）
const runtimeDir = path.join(dataDir, ".runtime");

// 必须在 ready 前设置，让 Chromium 自带的运行时缓存也落进便携目录
app.setPath("userData", runtimeDir);

// 再把工作目录也切到运行时缓存目录。
// 部分 Chromium 子进程（GPU 着色器缓存、字体缓存）会按「当前工作目录」写盘，
// 不切的话会在便携文件夹里生成 NVIDIA Corporation 之类的垃圾目录。
try {
    fsSync.mkdirSync(runtimeDir, { recursive: true });
    process.chdir(runtimeDir);
} catch {
    // 切不过去不影响主流程，只是可能多出缓存目录
}

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

// ── 导演台：把已生成的分镜视频拼成一条成片 ──
// ffmpeg 随包分发：打包后放 exe 同级的 bin/ 下；开发时用 electron/bin/。
const ffmpegBin = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
const ffmpegPath = isDev ? path.join(__dirname, "bin", ffmpegBin) : path.join(path.dirname(process.execPath), "bin", ffmpegBin);

/** 跑一次 ffmpeg，收下 stderr 便于报错。 */
function runFfmpeg(bin, args) {
    return new Promise((resolve) => {
        const child = spawn(bin, args, { windowsHide: true });
        let stderr = "";
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", (error) => resolve({ code: -1, stderr: String(error) }));
        child.on("close", (code) => resolve({ code, stderr }));
    });
}

ipcMain.handle("sqc:concatVideos", (_e, payload) =>
    safe(async () => {
        const clips = Array.isArray(payload) ? payload : [];
        if (!clips.length) return { ok: false, error: "没有可拼接的片段" };
        if (!fsSync.existsSync(ffmpegPath)) return { ok: false, error: "没有找到 ffmpeg，请把 ffmpeg.exe 放到程序目录的 bin/ 下。" };

        const tmpDir = path.join(runtimeDir, "concat", String(Date.now()));
        await fs.mkdir(tmpDir, { recursive: true });
        const files = [];
        for (let index = 0; index < clips.length; index += 1) {
            const file = path.join(tmpDir, `clip-${String(index).padStart(4, "0")}.mp4`);
            await fs.writeFile(file, Buffer.from(clips[index].data));
            files.push(file);
        }
        const listFile = path.join(tmpDir, "list.txt");
        await fs.writeFile(listFile, files.map((file) => `file '${file.replace(/\\/g, "/")}'`).join("\n"), "utf8");

        const outDir = path.join(dataDir, "成片");
        await fs.mkdir(outDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const outFile = path.join(outDir, `成片-${stamp}.mp4`);

        // 先试无损拼接（同源片段最快）；编码不一致时会失败，退回统一重编码
        const first = await runFfmpeg(ffmpegPath, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outFile]);
        if (first.code !== 0) {
            const second = await runFfmpeg(ffmpegPath, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", outFile]);
            if (second.code !== 0) return { ok: false, error: (second.stderr || first.stderr || "").slice(-500) || "拼接失败" };
        }

        await fs.rm(tmpDir, { recursive: true, force: true });
        return { ok: true, path: outFile };
    }, { ok: false, error: "拼接失败" }),
);

ipcMain.handle("sqc:openPath", (_e, target) => {
    if (typeof target === "string" && target) shell.showItemInFolder(target);
    return true;
});


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
