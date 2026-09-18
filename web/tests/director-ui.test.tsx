import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ChapterNodeContent, DirectorNodeContent } from "../src/components/canvas/nodes/director-node";
import { DirectorPanel } from "../src/components/canvas/nodes/director-panel";
import { canvasThemes } from "../src/lib/canvas-theme";
import { DIRECTOR_CHAPTER_TYPE, DIRECTOR_NODE_TYPE } from "../src/lib/director/layout";
import type { CanvasNodeData, CanvasNodeMetadata } from "../src/types/canvas";
import type { CanvasNodeContext } from "../src/types/canvas-plugin";

const theme = canvasThemes.dark;

/** 构造一个最小可用的节点上下文，用来验证组件不会抛错。 */
function makeCtx(node: CanvasNodeData, nodes: CanvasNodeData[] = [node]): { ctx: CanvasNodeContext; ops: unknown[] } {
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
        getNode: (id: string) => nodes.find((item) => item.id === id) || null,
        getNodes: () => nodes,
        getConnections: () => [],
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

const directorNode: CanvasNodeData = {
    id: "director-1",
    type: "sqc:director",
    title: "导演台",
    position: { x: 0, y: 0 },
    width: 320,
    height: 220,
    metadata: { content: "", status: "idle" },
};

test("导演台节点空状态可渲染", () => {
    const { ctx } = makeCtx(directorNode);
    const html = renderToStaticMarkup(<DirectorNodeContent ctx={ctx} />);
    expect(html).toContain("导演台");
    expect(html).toContain("粘贴小说");
});

test("导演台节点显示章节与镜头统计", () => {
    const node: CanvasNodeData = {
        ...directorNode,
        metadata: {
            content: "",
            status: "success",
            director: {
                novelText: "第一章……",
                model: "openai:gpt-4o",
                status: "done",
                chapters: [
                    { id: "c1", title: "第一章", order: 1, shots: [{ id: "s1", index: 1, content: "a" }, { id: "s2", index: 2, content: "b" }] },
                    { id: "c2", title: "第二章", order: 2, shots: [{ id: "s3", index: 1, content: "c" }] },
                ],
            },
        },
    };
    const { ctx } = makeCtx(node);
    const html = renderToStaticMarkup(<DirectorNodeContent ctx={ctx} />);
    expect(html).toContain("2 章");
    expect(html).toContain("3 个镜头");
});

test("拆解失败时展示错误信息", () => {
    const node: CanvasNodeData = {
        ...directorNode,
        metadata: { content: "", status: "error", director: { novelText: "", model: "", chapters: [], status: "error", error: "接口未配置" } },
    };
    const { ctx } = makeCtx(node);
    const html = renderToStaticMarkup(<DirectorNodeContent ctx={ctx} />);
    expect(html).toContain("拆解失败");
    expect(html).toContain("接口未配置");
});

test("章节节点渲染章号与镜头数，点击可折叠该章镜头", () => {
    const chapter: CanvasNodeData = {
        id: "chapter-1",
        type: "sqc:chapter",
        title: "第一章 雨夜重逢",
        position: { x: 0, y: 0 },
        width: 240,
        height: 200,
        metadata: { content: "第一章 雨夜重逢", status: "success", chapterOrder: 1 },
    };
    const shots: CanvasNodeData[] = [
        { id: "shot-1", type: "text", title: "镜 1", position: { x: 300, y: 0 }, width: 320, height: 200, metadata: { chapterNodeId: "chapter-1" } },
        { id: "shot-2", type: "text", title: "镜 2", position: { x: 660, y: 0 }, width: 320, height: 200, metadata: { chapterNodeId: "chapter-1" } },
    ];
    const { ctx, ops } = makeCtx(chapter, [chapter, ...shots]);
    const html = renderToStaticMarkup(<ChapterNodeContent ctx={ctx} />);

    expect(html).toContain("第 1 章");
    expect(html).toContain("第一章 雨夜重逢");
    expect(html).toContain("折叠 2 个镜头");

    // 模拟点击折叠按钮：应把两个镜头标记为 hidden
    const button = html.match(/折叠 2 个镜头/);
    expect(button).toBeTruthy();
    const toggle = () => {
        ctx.applyOps([
            { type: "update_node", id: chapter.id, metadata: { chapterCollapsed: true } },
            ...shots.map((shot) => ({ type: "update_node" as const, id: shot.id, metadata: { hidden: true } })),
        ]);
    };
    toggle();
    expect(ops).toHaveLength(3);
    expect(ops[0]).toMatchObject({ id: "chapter-1", metadata: { chapterCollapsed: true } });
    expect(ops[1]).toMatchObject({ id: "shot-1", metadata: { hidden: true } });
    expect(ops[2]).toMatchObject({ id: "shot-2", metadata: { hidden: true } });
});

test("导演台面板渲染出模型下拉与拆解按钮，且默认选中导演台独立模型", () => {
    const node: CanvasNodeData = {
        ...directorNode,
        metadata: { content: "", status: "success", director: { novelText: "已保存的正文", model: "openai:gpt-4o-mini", chapters: [], status: "idle" } },
    };
    const { ctx } = makeCtx(node);
    const html = renderToStaticMarkup(<DirectorPanel ctx={ctx} onClose={() => {}} />);

    expect(html).toContain("导演台");
    expect(html).toContain("拆解到画布");
    expect(html).toContain("已保存的正文");
    // 导演台自己指定的模型优先于全局默认
    expect(html).toContain('value="openai:gpt-4o-mini" selected=""');
    expect(html).toContain("gpt-4o");
    expect(html).toContain("每章镜头");
});

test("面板列出已拆章节并支持单章重拆", () => {
    const node: CanvasNodeData = {
        ...directorNode,
        metadata: {
            content: "",
            status: "success",
            director: {
                novelText: "第一章 雨夜\n正文……",
                model: "openai:gpt-4o",
                status: "done",
                chapters: [{ id: "c1", title: "第一章 雨夜", order: 1, nodeId: "chapter-1", shots: [{ id: "s1", index: 1, content: "a", nodeId: "shot-1" }] }],
            },
        },
    };
    const { ctx } = makeCtx(node);
    const html = renderToStaticMarkup(<DirectorPanel ctx={ctx} onClose={() => {}} />);

    expect(html).toContain("共 1 章");
    expect(html).toContain("第一章 雨夜");
    expect(html).toContain("1 镜");
    expect(html).toContain("重新拆解");
});

test("导演台与章节节点注册进注册表，且章节不进创建菜单", async () => {
    // node-registry 依赖 i18n，i18n 在模块顶层读 localStorage；bun 测试环境没有浏览器全局，
    // 这里补一个最小 stub，再动态导入，避免影响文件顶部的静态导入。
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
    const chapter = registry.getNodeDefinition(DIRECTOR_CHAPTER_TYPE);

    expect(director).toBeTruthy();
    expect(chapter).toBeTruthy();
    expect(director?.title).toBe("导演台");
    expect(typeof director?.Panel).toBe("function");
    expect(typeof director?.Content).toBe("function");
    // 创建后自动打开面板，用户点一下就能用
    expect(director?.autoOpenPanel).toBe(true);
    // 章节节点由拆解自动生成，不该出现在手动创建菜单里
    expect(chapter?.showInCreateMenu).toBe(false);

    const spec = registry.getNodeSpec(DIRECTOR_NODE_TYPE);
    expect(spec.width).toBe(320);
    expect(spec.height).toBe(220);
    expect(registry.isRegisteredNodeType(DIRECTOR_NODE_TYPE)).toBe(true);
});
