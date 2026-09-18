# SQC 无限画布 · 桌面便携版

把上游的 Web 版（`../web`）套一层 Electron 壳，做成**绿色便携**的 Windows 桌面应用：
双击 exe 即用，数据以可读文件形式存在 exe 同级的 `data/` 里，整个文件夹拷走换机即可。

## 目录结构（发布后）

```
SQC/
├── SQC无限画布.exe
└── data/
    ├── app/infinite-canvas/      ← 业务数据，全是可直接打开的文件
    │   ├── _meta.json            数据版本标记（schemaVersion）
    │   ├── app_state/            画布项目、我的资产（.json）
    │   ├── image_files/          图片原文件
    │   ├── media_files/          视频 / 音频原文件
    │   └── prompt_cache/         提示词库缓存
    └── .runtime/                 Chromium 运行时缓存，非业务数据，可删
```

## 打包

```bash
cd electron
npm install          # 首次
npm run dist         # 构建 web + 复制 renderer + electron-builder --dir
```

产物在 `electron/release/win-unpacked/`，把它整个复制成桌面 `SQC/` 即可。

国内网络需先设置镜像，否则会卡在从 GitHub 下载 Electron：

```bash
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
```

## 开发调试

```bash
cd ../web && bun run dev      # 纯网页版，数据走浏览器 IndexedDB
cd ../electron && npm start   # Electron 壳 + web/dist，数据走 dev-data/
```

## 关键实现说明

| 文件 | 作用 |
| --- | --- |
| `main.cjs` | 主进程。数据目录 = exe 同级 `data/`；IPC 提供沙箱化的文件读写（防 `..` 穿越） |
| `preload.cjs` | 通过 `window.electronAPI` 暴露文件能力给渲染层 |
| `../web/src/lib/sqc-fs.ts` | 文件系统后端：key → 文件，store → 目录 |
| `../web/src/lib/sqc-storage.ts` | localforage 的 drop-in 替换，浏览器环境自动回落到原生 IndexedDB |
| `scripts/copy-renderer.cjs` | 把 `web/dist` 复制进 `renderer/` 供打包 |

- 落盘规则：`data/app/<name>/<storeName>/<encodeURIComponent(key)>.json`；
  顶层 `Blob` 存为原始二进制（按 MIME 取扩展名），对象里嵌套的 `Blob` 以 `__sqcBlob` 标记内嵌 base64。
- **路由必须用 HashRouter**，vite 构建 `base` 必须是 `./`（`--mode electron`），否则 `file://` 下白屏。
- 上游改了本地存储格式时，在 `sqc-fs.ts` 的 `ensureSqcDataRoot()` 里按 `schemaVersion` 加迁移分支。

## 合并上游更新

```bash
git fetch upstream
git merge upstream/main        # 冲突一般集中在存储层和路由，改动面刻意做小了
cd web && bun run typecheck    # 上游基线本就有一个 model-script-editor.tsx 的类型错误，可忽略
cd ../electron && npm run dist
```

升级后用户只需把旧 `data/app/` 拷进新版本文件夹，数据即全部保留。

## 注意

API Key 以明文保存在 `data/app/infinite-canvas/app_state/` 下，不要外发整个 `data/` 目录。
