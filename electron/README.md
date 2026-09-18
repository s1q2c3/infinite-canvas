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
升级后用户只需把旧 `data/app/` 拷进新版本文件夹，数据即全部保留。

## 注意

API Key 以明文保存在 `data/app/infinite-canvas/app_state/` 下，不要外发整个 `data/` 目录。

---

# 定制功能：导演台

把小说拆成镜头脚本、自动铺到画布上。属于本项目在 Web 侧的自定义功能（上游没有）。

## 用法

1. 画布工具栏 → 新建「导演台」节点（创建后自动弹出面板）。
2. 面板里粘贴小说全文，选拆解用的模型（**独立于全局默认模型**），可选「每章镜头数」。
3. 点「拆解到画布」：按「第X章」切分 → 逐章调用文本模型 → 按「一章一行、行内横排」铺到导演台节点下方。
4. 每个镜头是一个**可编辑的文本节点**，双击即可改字；需要生图时照常用文本节点 → 生图。
5. 章节节点上的按钮可就地折叠 / 展开该章镜头；面板里可单章重拆或删除某章。

## 关键设计

| 关注点 | 做法 | 为什么 |
| --- | --- | --- |
| 逐章拆解，不整本一次喂 | 每章单独一次模型调用 | 超长上下文会显著掉质量；且可只重拆某一章 |
| 节点接入方式 | 注册进 `node-registry`，提供 `Content` / `Panel`，走插件渲染路径 | 不改 `canvas-node` 内部渲染分派，合并上游时冲突面最小 |
| 镜头节点 | 用**内置文本节点** | 双击可改、能直接连生成配置节点，复用现成能力 |
| 章节折叠 | `metadata.hidden` 标记 + `visibleNodes` 过滤 | 真折叠，画布不被几百个镜头铺满 |
| 导演台模型 | 存在节点 `metadata.director.model` | 与全局默认分开，拆解可单独用最强模型 |

## 文件

| 路径 | 作用 |
| --- | --- |
| `web/src/lib/director/novel-split.ts` | 按章节标题切分，识别不到时按字数兜底 |
| `web/src/lib/director/prompts.ts` | 拆解提示词与镜头解析（兼容 `---` 分隔和「镜号」开头两种输出） |
| `web/src/lib/director/decompose.ts` | 逐章调用文本模型，产出章节 / 镜头结构 |
| `web/src/lib/director/layout.ts` | 章节分行、行内横排的坐标计算与建节点指令 |
| `web/src/lib/director/register.tsx` | 把导演台 / 章节节点注册进注册表 |
| `web/src/components/canvas/nodes/director-node.tsx` | 导演台节点与章节节点的外观 |
| `web/src/components/canvas/nodes/director-panel.tsx` | 导演台面板（粘贴、选模型、进度、章节列表） |
| `web/src/pages/canvas/project.tsx` | 注册调用 + `visibleNodes` 跳过 `hidden` 节点 |
| `web/tests/director*.test.*` | 拆解 / 布局 / 渲染 / 注册的单元测试 |

## 改拆解粒度或镜头格式

- 镜头字段（画面 / 台词 / 音效 / 转场）改 `prompts.ts` 里的 `buildChapterPrompt`。
- 换行距、节点尺寸、每行怎么排改 `layout.ts` 里的 `DIRECTOR_LAYOUT`。
- 上游改了本地存储结构导致老数据读不出时，在 `sqc-fs.ts` 的 `ensureSqcDataRoot()` 加迁移分支。
