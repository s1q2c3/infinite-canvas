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

把小说拆成「人物 / 场景 / 重要物品」三类资产，再为每个场景写分镜，直接铺到画布上并连好关系，供后续逐镜生成图片或视频。属于本项目在 Web 侧的自定义功能（上游没有）。

## 用法

1. 画布工具栏 → 新建「导演台」节点（创建后自动弹出面板）。
2. 面板里粘贴小说全文，选拆解模型（**独立于全局默认模型**），可选「每场分镜数」。
3. 点 **「① 拆人物 / 场景 / 物品」** → 三区铺到画布上。**直接在节点上改字**审核。
4. 点 **「② 拆分镜」** → 逐章为已定好的场景写分镜（场景在第①步就定下来了，不会再变）。
5. 逐镜生成：
   - 人物 / 物品 / 场景节点工具栏 →「生成形象图 / 物品图 / 场景图」
   - 分镜节点工具栏 →「生图」或「生视频」（**生视频会自动带上已经生成好的分镜图作参考**）

## 画布上长这样

```
[人物1][人物2][人物3] …              ← 角色库
  ↓ 每个框正下方预留：配置节点 + 图片/视频节点

[物品1][物品2] …                     ← 重要物品
  ↓ 同样预留

[第1章]   [场景1]  ┌组·场景1 的分镜───────┐
          [场景2]  │ [镜1-1][镜1-2][镜1-3] │
                   └────────────────────┘
[第2章]   [场景3]  ┌组·场景3 的分镜┐
                   │ [镜3-1][镜3-2]  │
                   └────────────────┘
```

- **连线**：人物 → 场景（这场里有谁）· 物品 → 场景（这场里出现什么）· 场景 → 分镜（分镜归属，保证不混场）
- **生成空间**：每个框下方都留了一整块（间距 + 配置节点 + 间距 + 图片/视频节点）。生成结果竖着落在框正下方，一行里的框才能保持成一条横线、一眼看全
- **生成类型**：分镜标题直接标出「· 图」/「· 视频」；人物 / 物品 / 场景节点左上角有「生图」标记
- **组节点**：包住一场的分镜，侧边栏会按组展开成树
- **折叠**：章节节点一键折叠本章的场景与分镜（`metadata.hidden` + `visibleNodes` 过滤，节点不删）

## 字段

节点文字是**唯一真相**（用户会直接在画布上改字），所以结构化数据不另存一份，导出 / 自检时按标签解析回来。

- 人物（14）：姓名、称呼、身份、年龄、外貌、服饰、标志特征、音色语气、性格、前史、动机、关系、弧光、生图提示词
- 场景（15 + 出场人物 + 出现物品）：场景名、编号、地点、时间、内外景、季节天气、氛围、光线、色调、关键道具、本场造型、场景目标、冲突、结果、生图提示词
- 分镜（17）：镜号、**生成类型**、时长、景别、机位高度、机位角度、运镜、构图、画面、情绪、台词、旁白、音效、配乐、节奏、转场、生图提示词
- 重要物品（9）：名称、类别、外观、材质、关联人物、出现场景、剧情作用、首次出现、生图提示词

「出场人物」「出现物品」不写进正文，而是存**节点 id**（`metadata.directorMeta.characterIds / propIds`），显示时才去取当前标题 —— 改人名会自动同步。

## 关键设计

| 关注点 | 做法 | 为什么 |
| --- | --- | --- |
| 两步走 | ① 拆三类资产 → 用户审核 → ② 只拆分镜 | 人物 / 物品是跨场景资产，先定下来用户才好审；场景先定，第二步就不用重新判定场景，避免两次拆出来的场景对不上 |
| 长篇去重 | 分章提取后再跑一次「合并人物与物品」；**场景不合并** | 同一个人在不同章叫法不同，不合并会重复；但场景是时空单元，同一地点在不同时间就是不同场景 |
| 逐章拆解 | 每章一次模型调用 | 整本一次喂会超上下文；且能只重拆某一章 |
| 强制具体化 | 提示词里给正反例（❌"气氛紧张" → ✅"雨水打在铁皮雨棚上…"） | 不给反面例子，模型一定写空话 |
| 外貌只写一次 | 外貌写在人物节点，分镜的「生图提示词」**禁止写外貌** | 两边都写会自相矛盾，出图随机偏向一边 |
| 生成类型 | 模型判定每镜该「图」还是「视频」（静态 / 对话 → 图；动作 / 运镜 / 情绪爆发 → 视频） | 一眼看出哪些要生视频，也决定工具栏按钮 |
| 生成结果落点 | 导演台建的配置节点带 `metadata.directorStack`，核心生成流程据此把图片 / 视频放到**正下方** | 布局给每个框留了下方空间；横着排会把一行撑成上万像素宽 |
| 分镜自动接线 | 改核心 `generateImageFromTextNode` 加钩子 | 画布生成输入只读**直接上游一层**，不补线的话分镜拿不到场景与人物 |
| 生视频 | 分镜工具栏「生视频」→ 建 video 模式的配置节点，并额外接上**已生成的分镜图** | 图生视频的一致性比纯文字好得多 |
| 参考图 | 人物 / 物品 / 场景节点的生成按钮建的配置节点带 `directorPhoto` 标记（含造型标签） | 分镜生成时按场景的「本场造型」匹配对应照片 |
| 节点接入 | 注册进 `node-registry`，提供 `Content` / `Panel` / `resource` / `toolbar` | 不改 `canvas-node` 内部渲染分派，合并上游时冲突面最小 |
| 结构不双存 | 导演台节点的 metadata 只存模型 + 进度；原文拆完写进各章节节点 | 避免和画布节点两份数据不同步；也避免几十万字挂在单节点上 |

## 文件

| 路径 | 作用 |
| --- | --- |
| `web/src/lib/director/spec.ts` | 四类字段规格 + 文本格式化 / 解析 + 分镜生成类型判定 |
| `web/src/lib/director/novel-split.ts` | 按章节标题切分，识别不到时按字数兜底 |
| `web/src/lib/director/prompts.ts` | 资产提取 / 资产合并 / 分镜三套提示词 |
| `web/src/lib/director/parse.ts` | 解析模型输出（`###` 分区块、`===` 分场景、`---` 分条目） |
| `web/src/lib/director/decompose.ts` | 两步编排：逐章拆资产 + 合并去重 + 逐章拆分镜 |
| `web/src/lib/director/layout.ts` | 三区布局坐标、生成空间预留、建节点 / 连线 / 分组指令 |
| `web/src/lib/director/meta.ts` | 节点元信息读取（lib 层，避免反向依赖组件） |
| `web/src/lib/director/collect.ts` | 归集四层数据（导出 / 自检 / 面板统计共用） |
| `web/src/lib/director/photos.ts` | 在图上找已生成的照片，按造型匹配 |
| `web/src/lib/director/wiring.ts` | 分镜生成要补哪些上游节点（生视频时多带分镜图） |
| `web/src/lib/director/export.ts` | 导出 JSON / 分镜表 CSV / 剧本 |
| `web/src/lib/director/self-check.ts` | 一致性自检（缺字段、空场、人物对不上） |
| `web/src/lib/director/register.tsx` | 注册五种节点类型 + 生成按钮 |
| `web/src/components/canvas/nodes/director-node.tsx` | 导演台 / 人物 / 物品 / 场景 / 章节节点的外观与生成类型标记 |
| `web/src/components/canvas/nodes/director-panel.tsx` | 导演台面板（两步、五段看板、章节列表、导出、自检、清理旧版） |
| `web/src/components/canvas/canvas-node-hover-toolbar.tsx` | 分镜的「生图 / 生视频」入口 |
| `web/src/pages/canvas/project.tsx` | 注册调用 + `visibleNodes` 跳过 `hidden` + 生成落点与自动接线钩子 |
| `web/tests/director*.test.*` | 解析 / 布局 / 归集 / 自检 / 导出 / 接线 / 渲染 / 指令落地 |

## 想改的时候看哪里

- 拆解质量：`prompts.ts`。字段说明、正反例、场景判定规则、生成类型判定标准都在这里。
- 字段增删：`spec.ts` 的 `CHARACTER_FIELDS` / `SCENE_FIELDS` / `SHOT_FIELDS` / `PROP_FIELDS`，节点渲染会自动跟着变。
- 排版与生成空间：`layout.ts` 的 `DIRECTOR_LAYOUT` 与 `GENERATED_STACK_HEIGHT`。**改这里必须同步改 `project.tsx` 里 `directorStack` 分支的落点**，否则生成的图会压到别的框上。
- 节点外观：`director-node.tsx`。
- 上游改了本地存储结构导致老数据读不出时：`sqc-fs.ts` 的 `ensureSqcDataRoot()` 加迁移分支。
- 旧版（v1：章节 + 镜头）拆解结果：面板右下角「清理旧版拆解」，只删带导演台标记的节点，你自建的节点不动。
