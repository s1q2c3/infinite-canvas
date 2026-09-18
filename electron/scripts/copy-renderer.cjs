// 把 web 的构建产物复制到 electron/renderer，作为随包携带的界面文件。
const fs = require("node:fs");
const path = require("node:path");

const from = path.join(__dirname, "..", "..", "web", "dist");
const to = path.join(__dirname, "..", "renderer");

fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log(`[renderer] ${from} -> ${to}`);
