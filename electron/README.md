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

把小说拆成「人物 / 场景 / 分镜」三层制作资料，直接铺到画布上并连好关系，供后续逐镜生成图片或视频。属于本项目在 Web 侧的自定义功能（上游没有）。

## 用法

1. 画布工具栏 → 新建「导演台」节点（创建后自动弹出面板）。
2. 面板里粘贴小说全文，选拆解模型（**独立于全局默认模型**），可选「每章分镜数」。
3. 点 **「① 提取人物」** → 人物节点横排铺到画布顶部。**直接在节点上改字**审核（补外貌、改关系都行）。
4. 点 **「② 拆解场景与分镜」** → 逐章调用模型，建章节 / 场景 / 分镜节点并连好线。
5. 逐镜生成：点分镜节点自带的「生图」按钮，系统会**自动**把所属场景、该场出场人物、以及它们的照片接成上游，prompt 与参考图一次到位。

## 拆出来的结构

```
[人物1][人物2][人物3] …                    ← 角色库（顶部一行）

[第1章]   [场景1]  ┌组·场景1 的分镜───────┐
          [场景2]  │ [镜1-1][镜1-2][镜1-3] │
                   └────────────────────┘
[第2章]   [场景3]  ┌组·场景3 的分镜┐
                   │ [镜3-1][镜3-2]  │
                   └────────────────┘
```

- **连线**：人物 → 场景（这场里有谁）· 场景 → 分镜（分镜归属，保证不混场）
- **组节点**：包住一场的分镜，侧边栏会按组展开成树，也能整体拖动
- **折叠**：章节节点上一键折叠本章的场景与分镜（`metadata.hidden` + `visibleNodes` 过滤，节点不删）

## 字段

节点文字是**唯一真相**（用户会直接在画布上改字），所以结构化数据不另存一份，导出 / 自检时按标签解析回来。

- 人物（14）：姓名、称呼、身份、年龄、外貌、服饰、标志特征、音色语气、性格、前史、动机、关系、弧光、生图提示词
- 场景（15 + 出场人物）：场景名、编号、地点、时间、内外景、季节天气、氛围、光线、色调、关键道具、本场造型、场景目标、冲突、结果、生图提示词
- 分镜（16）：镜号、时长、景别、机位高度、机位角度、运镜、构图、画面、情绪、台词、旁白、音效、配乐、节奏、转场、生图提示词

「出场人物」不写进正文，而是存**人物节点 id**（`metadata.directorMeta.characterIds`），显示时才去取当前标题 —— 这样改人名会自动同步。

## 关键设计

| 关注点 | 做法 | 为什么 |
| --- | --- | --- |
| 两步走 | 先提人物 → 用户审核 → 再拆场景分镜 | 人物是跨场景的，一次性提出来才不会把「小满 / 林小满」拆成两个人；先修正人物，后面所有分镜都更准 |
| 长篇人物去重 | 分章提取后再跑一次「合并人物」 | 同一个人在不同章叫法不同，不合并会重复 |
| 逐章拆解 | 每章一次模型调用 | 整本一次喂会超上下文；且能只重拆某一章 |
| 强制具体化 | 提示词里给正反例（❌"气氛紧张" → ✅"雨水打在铁皮雨棚上…"） | 不给反面例子，模型一定写空话 —— 这是上一版笼统的根因，不是层数问题 |
| 外貌只写一次 | 外貌写在人物节点，分镜的「生图提示词」**禁止写外貌** | 两边都写会自相矛盾，出图随机偏向一边 |
| 分镜生图自动接线 | 改核心 `generateImageFromTextNode` 加钩子 | 画布生成输入只读**直接上游一层**，不补线的话分镜拿不到场景与人物 |
| 参考图 | 人物 / 场景节点的「生成形象图 / 场景图」按钮建配置节点并打 `directorPhoto` 标记（含造型标签） | 分镜生图时按场景的「本场造型」匹配对应照片 |
| 节点接入 | 注册进 `node-registry`，提供 `Content` / `Panel` / `resource` / `toolbar` | 不改 `canvas-node` 内部渲染分派，合并上游时冲突面最小 |
| 结构不双存 | 导演台节点的 metadata 只存模型 + 进度；原文拆完写进各章节节点 | 避免和画布节点两份数据不同步；也避免几十万字挂在单节点上 |

## 文件

| 路径 | 作用 |
| --- | --- |
| `web/src/lib/director/spec.ts` | 三层字段规格 + 文本格式化 / 解析 |
| `web/src/lib/director/novel-split.ts` | 按章节标题切分，识别不到时按字数兜底 |
| `web/src/lib/director/prompts.ts` | 人物提取 / 人物合并 / 场景分镜三套提示词 |
| `web/src/lib/director/parse.ts` | 解析模型输出（`===` 分场景、`---` 分镜） |
| `web/src/lib/director/decompose.ts` | 两步编排：分章提取 + 合并去重 + 逐章拆场景分镜 |
| `web/src/lib/director/layout.ts` | 布局坐标计算与建节点 / 连线 / 分组指令 |
| `web/src/lib/director/meta.ts` | 节点元信息读取（lib 层，避免反向依赖组件） |
| `web/src/lib/director/collect.ts` | 归集三层数据（导出 / 自检 / 面板统计共用） |
| `web/src/lib/director/photos.ts` | 在图上找已生成的照片，按造型匹配 |
| `web/src/lib/director/wiring.ts` | 分镜生图要补哪些上游节点 |
| `web/src/lib/director/export.ts` | 导出 JSON / 分镜表 CSV / 剧本 |
| `web/src/lib/director/self-check.ts` | 一致性自检（缺字段、空场、人物对不上） |
| `web/src/lib/director/register.tsx` | 注册四种节点类型 |
| `web/src/components/canvas/nodes/director-node.tsx` | 导演台 / 人物 / 场景 / 章节节点的外观 |
| `web/src/components/canvas/nodes/director-panel.tsx` | 导演台面板（两步、看板、章节列表、导出、自检、清理旧版） |
| `web/src/pages/canvas/project.tsx` | 注册调用 + `visibleNodes` 跳过 `hidden` + 分镜生图钩子 |
| `web/tests/director*.test.*` | 解析 / 布局 / 归集 / 自检 / 导出 / 接线 / 渲染 / 指令落地 |

## 想改的时候看哪里

- 拆解质量：`prompts.ts`。字段说明、正反例、场景判定规则都在这里。
- 字段增删：`spec.ts` 的 `CHARACTER_FIELDS` / `SCENE_FIELDS` / `SHOT_FIELDS`，节点渲染会自动跟着变。
- 排版：`layout.ts` 的 `DIRECTOR_LAYOUT`（行距、节点尺寸、间距）。
- 节点外观：`director-node.tsx`。
- 上游改了本地存储结构导致老数据读不出时：`sqc-fs.ts` 的 `ensureSqcDataRoot()` 加迁移分支。
- 旧版（v1：章节 + 镜头）拆解结果：面板右下角「清理旧版拆解」，只删带导演台标记的节点，你自建的节点不动。

