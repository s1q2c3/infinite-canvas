import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ChapterNodeContent, CharacterNodeContent, DirectorNodeContent, SceneNodeContent } from "../src/components/canvas/nodes/director-node";
import { DirectorPanel } from "../src/components/canvas/nodes/director-panel";
import { canvasThemes } from "../src/lib/canvas-theme";
import { DIRECTOR_CHAPTER_TYPE, DIRECTOR_CHARACTER_TYPE, DIRECTOR_NODE_TYPE, DIRECTOR_SCENE_TYPE } from "../src/lib/director/layout";
import type { CanvasConnection, CanvasNodeData, CanvasNodeMetadata } from "../src/types/canvas";
import type { CanvasNodeContext } from "../src/types/canvas-plugin";

const theme = canvasThemes.dark;

/** 最小可用上下文：只实现组件真正会调到的能力。 */
function makeCtx(node: CanvasNodeData, all: CanvasNodeData[] = [node], connections: CanvasConnection[] = []): { ctx: CanvasNodeContext; ops: unknown[] } {
    const ops: unknown[] = [];
    const ctx = {
        node,
        theme,
        scale: 1,
        isSelected: false,
        updateMetadata: (patch: CanvasNodeMetadata) => {
            node.metadata = { ...node.metadata, ...patch };
        },
        updateNode: () => {},
        getNode: (id: string) => all.find((item) => item.id === id) || null,
        getNodes: () => all,
        getConnections: () => connections,
        getUpstream: () => [],
        getDownstream: () => [],
        applyOps: (next: unknown[]) => {
            ops.push(...next);
        },
        emit: () => {},
        on: () => () => {},
        ai: {
            generateImage: async () => ({ images: [] }),
            generateVideo: async () => ({ url: "", mimeType: "" }),
            generateText: async () => ({ text: "" }),
            listModels: () => [
                { value: "openai:gpt-4o", label: "gpt-4o" },
                { value: "openai:gpt-4o-mini", label: "gpt-4o-mini" },
            ],
            defaultModel: () => "openai:gpt-4o",
        },
        openPanel: () => {},
        closePanel: () => {},
        storage: { get: async () => null, set: async () => {}, remove: async () => {} },
    } as unknown as CanvasNodeContext;
    return { ctx, ops };
}

const DIRECTOR = "director-1";

const directorNode: CanvasNodeData = {
    id: DIRECTOR,
    type: DIRECTOR_NODE_TYPE,
    title: "导演台",
    position: { x: 0, y: 0 },
    width: 320,
    height: 220,
    metadata: { content: "", status: "idle" },
};

const characterNode: CanvasNodeData = {
    id: "char-node-1",
    type: DIRECTOR_CHARACTER_TYPE,
    title: "林小满",
    position: { x: 0, y: 400 },
    width: 240,
    height: 170,
    metadata: {
        content: "姓名：林小满\n身份：便利店店员\n外貌：齐肩黑发低马尾",
        directorMeta: { kind: "character", directorNodeId: DIRECTOR, characterId: "c1", tier: "main" },
    },
};

const sceneNode: CanvasNodeData = {
    id: "scene-node-1",
    type: DIRECTOR_SCENE_TYPE,
    title: "便利店门口",
    position: { x: 0, y: 700 },
    width: 260,
    height: 190,
    metadata: {
        content: "场景名：便利店门口\n地点：城东便利店",
        directorMeta: { kind: "scene", directorNodeId: DIRECTOR, sceneId: "s1", order: 1, chapterNodeId: "chapter-node-1", characterIds: ["char-node-1"] },
    },
};

const shotNode: CanvasNodeData = {
    id: "shot-node-1",
    type: "text",
    title: "镜 1-1",
    position: { x: 0, y: 1000 },
    width: 340,
    height: 240,
    metadata: {
        content: "镜号：1-1\n景别：全景\n画面：小满背对镜头锁门",
        directorMeta: { kind: "shot", directorNodeId: DIRECTOR, shotId: "k1", sceneNodeId: "scene-node-1", index: 1 },
    },
};

const chapterNode: CanvasNodeData = {
    id: "chapter-node-1",
    type: DIRECTOR_CHAPTER_TYPE,
    title: "第一章 雨夜重逢",
    position: { x: 0, y: 700 },
    width: 220,
    height: 300,
    metadata: { content: "第一章 雨夜重逢", directorMeta: { kind: "chapter", directorNodeId: DIRECTOR, chapterId: "h1", order: 1, chapterText: "外面在下雨。" } },
};

const graph = [directorNode, characterNode, chapterNode, sceneNode, shotNode];

test("导演台节点：空状态提示两步流程", () => {
    const { ctx } = makeCtx(directorNode);
    const html = renderToStaticMarkup(<DirectorNodeContent ctx={ctx} />);
    expect(html).toContain("导演台");
    expect(html).toContain("先提人物");
});

test("导演台节点：有内容时显示人物 / 场景 / 分镜统计", () => {
    const { ctx } = makeCtx(directorNode, graph);
    const html = renderToStaticMarkup(<DirectorNodeContent ctx={ctx} />);
    expect(html).toContain("1 人物 · 1 场景 · 1 分镜");
});

test("导演台节点：拆解中显示进度，失败显示错误", () => {
    const busy: CanvasNodeData = {
        ...directorNode,
        metadata: { content: "", status: "idle", director: { model: "m", step: "decomposing", progress: { current: 2, total: 5, label: "第二章" } } },
    };
    const busyHtml = renderToStaticMarkup(<DirectorNodeContent ctx={makeCtx(busy).ctx} />);
    expect(busyHtml).toContain("正在拆解场景与分镜");
    expect(busyHtml).toContain("2/5");

    const failed: CanvasNodeData = { ...directorNode, metadata: { content: "", status: "idle", director: { model: "m", step: "error", error: "接口未配置" } } };
    const failedHtml = renderToStaticMarkup(<DirectorNodeContent ctx={makeCtx(failed).ctx} />);
    expect(failedHtml).toContain("拆解失败");
    expect(failedHtml).toContain("接口未配置");
});

test("人物节点：显示分级与设定正文", () => {
    const html = renderToStaticMarkup(<CharacterNodeContent ctx={makeCtx(characterNode).ctx} />);
    expect(html).toContain("主角");
    expect(html).toContain("林小满");
    expect(html).toContain("齐肩黑发低马尾");
});

test("场景节点：出场人物按人物节点的当前标题动态渲染", () => {
    const renamed = graph.map((node) => (node.id === "char-node-1" ? { ...node, title: "林满" } : node));
    const html = renderToStaticMarkup(<SceneNodeContent ctx={makeCtx(sceneNode, renamed).ctx} />);
    expect(html).toContain("出场人物：林满");
    expect(html).not.toContain("林小满");
});

test("章节节点：显示章号与场镜数，点击折叠本章场景与分镜", () => {
    const { ctx, ops } = makeCtx(chapterNode, graph);
    const html = renderToStaticMarkup(<ChapterNodeContent ctx={ctx} />);
    expect(html).toContain("第 1 章");
    expect(html).toContain("第一章 雨夜重逢");
    expect(html).toContain("1 场 · 1 镜");
    expect(html).toContain("折叠本章");

    // 模拟点击折叠
    ctx.applyOps([
        { type: "update_node", id: chapterNode.id, metadata: { directorMeta: { kind: "chapter", directorNodeId: DIRECTOR, chapterId: "h1", order: 1, chapterText: "", collapsed: true } } },
        { type: "update_node", id: "scene-node-1", metadata: { hidden: true } },
        { type: "update_node", id: "shot-node-1", metadata: { hidden: true } },
    ]);
    expect(ops).toHaveLength(3);
    expect(ops[0]).toMatchObject({ id: "chapter-node-1", metadata: { directorMeta: { collapsed: true } } });
    expect(ops[1]).toMatchObject({ id: "scene-node-1", metadata: { hidden: true } });
    expect(ops[2]).toMatchObject({ id: "shot-node-1", metadata: { hidden: true } });
});

test("面板：渲染两步按钮、模型下拉、每章分镜档位", () => {
    const html = renderToStaticMarkup(<DirectorPanel ctx={makeCtx(directorNode, graph).ctx} onClose={() => {}} />);
    expect(html).toContain("① 提取人物");
    expect(html).toContain("② 拆解场景与分镜");
    expect(html).toContain("每章分镜");
    expect(html).toContain("gpt-4o");
    // 没提取人物前第二步不可用
    expect(html).toContain("disabled");
});

test("面板：已提取人物后显示人物标签与章节列表、进度看板", () => {
    const node: CanvasNodeData = {
        ...directorNode,
        metadata: { content: "", status: "idle", director: { model: "openai:gpt-4o", step: "done", sourceText: "第一章 雨夜重逢\n外面在下雨。" } },
    };
    const html = renderToStaticMarkup(<DirectorPanel ctx={makeCtx(node, graph).ctx} onClose={() => {}} />);

    expect(html).toContain("已提取 1 个人物");
    expect(html).toContain("林小满 · 主角");
    expect(html).toContain("共 1 章 · 1 场 · 1 镜");
    expect(html).toContain("① 人物照片");
    expect(html).toContain("② 场景照片");
    expect(html).toContain("③ 分镜图");
    expect(html).toContain("导出分镜表");
    expect(html).toContain("一致性自检");
    expect(html).toContain("清理旧版拆解");
    // 导演台独立模型要回填到下拉
    expect(html).toContain('value="openai:gpt-4o" selected=""');
});

test("节点注册：四种类型都进注册表，只有导演台出现在创建菜单", async () => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
    };

    const registry = await import("../src/lib/canvas/node-registry");
    const register = await import("../src/lib/director/register");
    register.registerDirectorNodes();

    const director = registry.getNodeDefinition(DIRECTOR_NODE_TYPE);
    expect(director?.title).toBe("导演台");
    expect(director?.autoOpenPanel).toBe(true);
    expect(typeof director?.Panel).toBe("function");

    // 人物 / 场景 / 章节由拆解自动生成，不该出现在手动创建菜单里
    [DIRECTOR_CHARACTER_TYPE, DIRECTOR_SCENE_TYPE, DIRECTOR_CHAPTER_TYPE].forEach((type) => {
        const definition = registry.getNodeDefinition(type);
        expect(definition).toBeTruthy();
        expect(definition?.showInCreateMenu).toBe(false);
        expect(typeof definition?.Content).toBe("function");
    });

    // 人物 / 场景要能把正文暴露成生成输入，否则生图拿不到设定
    const characterResource = registry.getNodeDefinition(DIRECTOR_CHARACTER_TYPE)?.resource;
    expect(characterResource?.(characterNode)).toMatchObject({ kind: "text" });
    expect(characterResource?.(characterNode)?.text).toContain("林小满");
    const sceneResource = registry.getNodeDefinition(DIRECTOR_SCENE_TYPE)?.resource;
    expect(sceneResource?.(sceneNode)?.text).toContain("便利店门口");
});
