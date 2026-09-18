/**
 * 集成测试：把导演台生成的指令交给画布真正的指令执行器（applyCanvasAgentOps），
 * 验证落地的节点 / 连线 / 分组都符合预期。
 *
 * 这层比"布局函数自己算得对"更有意义 —— 它保证生成的 op 真的能被画布吃下。
 *
 * 注意：canvas-agent-ops 会牵到 i18n，i18n 在模块顶层读 localStorage，
 * 而 bun 测试环境没有浏览器全局。所以先补 stub，再动态导入（静态导入会被提升到最前面）。
 */

import { expect, test } from "bun:test";

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
};

const { applyCanvasAgentOps } = await import("../src/lib/canvas/canvas-agent-ops");
const { buildAssetPlan, buildShotPlan, DIRECTOR_CHARACTER_TYPE, DIRECTOR_CHAPTER_TYPE, DIRECTOR_PROP_TYPE, DIRECTOR_SCENE_TYPE } = await import("../src/lib/director/layout");
const { collectShotAssociation } = await import("../src/lib/director/associate");
const { parseAssets, parseShotsByScene } = await import("../src/lib/director/parse");
const { CanvasNodeType } = await import("../src/types/canvas");
const { registerBuiltinNodes } = await import("../src/components/canvas/nodes/builtin-nodes");
const { registerDirectorNodes } = await import("../src/lib/director/register");

// 内置节点必须先注册：applyCanvasAgentOps 对未注册类型会退化成文本节点，
// 组节点（group）就是内置类型之一。真实应用里 project.tsx 也是先注册内置再注册导演台。
registerBuiltinNodes();
registerDirectorNodes();

const emptySnapshot = () => ({ projectId: "p1", title: "画布", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } });

const assetOutput = [
    "### 人物",
    "姓名：林小满",
    "分级：主角",
    "身份：便利店店员",
    "外貌：齐肩黑发",
    "生图提示词：22岁东亚女性",
    "---",
    "姓名：苏晴",
    "分级：配角",
    "身份：同事",
    "外貌：短发圆眼镜",
    "生图提示词：24岁东亚女性",
    "### 场景",
    "场景名：便利店门口",
    "地点：城东便利店",
    "出场人物：林小满、苏晴",
    "出现物品：泛黄的信封",
    "生图提示词：雨夜便利店门口",
    "### 物品",
    "名称：泛黄的信封",
    "外观：米黄色牛皮纸，边角磨毛",
    "生图提示词：米黄色旧信封特写",
].join("\n");

const shotOutput = [
    "=== 便利店门口",
    "--- 分镜",
    "生成类型：图",
    "景别：全景",
    "画面：小满背对镜头锁门",
    "生图提示词：雨夜街道全景",
    "--- 分镜",
    "生成类型：视频",
    "景别：中景",
    "画面：她回头",
    "生图提示词：中景，雨夜",
].join("\n");

/** 第一步：拆资产并落到画布。 */
function applyAssets() {
    const assets = parseAssets(assetOutput);
    const plan = buildAssetPlan({
        directorNodeId: "director-1",
        bundle: { characters: assets.characters, props: assets.props, segments: [{ title: "第一章 雨夜重逢", text: "外面在下雨。", scenes: assets.scenes }] },
        origin: { x: 0, y: 1000 },
    });
    return { plan, result: applyCanvasAgentOps(emptySnapshot(), plan.ops) };
}

/** 第二步：把分镜挂到场景上。 */
function applyShots(applied: ReturnType<typeof applyAssets>["result"]) {
    const scene = applied.nodes.find((node) => node.type === DIRECTOR_SCENE_TYPE)!;
    const groups = parseShotsByScene(shotOutput);
    const plan = buildShotPlan({
        directorNodeId: "director-1",
        assignments: [{ sceneNodeId: scene.id, shots: groups[0].shots }],
        geometry: new Map([[scene.id, { x: scene.position.x, y: scene.position.y, width: scene.width, order: 1 }]]),
    });
    return applyCanvasAgentOps(applied, plan.ops);
}

test("第一步：角色 / 物品 / 场次全部落到画布上，连线与归属标记正确", () => {
    const { result } = applyAssets();

    const byType = (type: string) => result.nodes.filter((node) => node.type === type);
    expect(byType(DIRECTOR_CHARACTER_TYPE)).toHaveLength(2);
    expect(byType(DIRECTOR_PROP_TYPE)).toHaveLength(1);
    // 「章」已降级成场次上的属性，不再有章节节点
    expect(byType(DIRECTOR_CHAPTER_TYPE)).toHaveLength(0);
    expect(byType(DIRECTOR_SCENE_TYPE)).toHaveLength(1);
    expect(result.nodes).toHaveLength(4);

    // 角色主角在前、物品在下一区
    const characters = byType(DIRECTOR_CHARACTER_TYPE);
    expect(characters[0].title).toBe("林小满");
    expect(characters[0].metadata?.directorMeta).toMatchObject({ kind: "character", tier: "main", directorNodeId: "director-1" });
    const propNode = byType(DIRECTOR_PROP_TYPE)[0];
    expect(propNode.metadata?.directorMeta).toMatchObject({ kind: "prop" });
    expect(propNode.position.y).toBeGreaterThan(characters[0].position.y);

    // 场次记住了段标题、段正文与出场人物 / 出现物品的节点 id
    const scene = byType(DIRECTOR_SCENE_TYPE)[0];
    expect(scene.metadata?.directorMeta).toMatchObject({
        kind: "scene",
        chapterTitle: "第一章 雨夜重逢",
        script: "外面在下雨。",
        characterIds: characters.map((item) => item.id),
        propIds: [propNode.id],
    });
    expect(scene.metadata?.content).toContain("地点：城东便利店");

    expect(result.connections.filter((connection) => connection.toNodeId === scene.id)).toHaveLength(3);
});

test("第二步：分镜挂到场次右侧、归进组，标题带生成类型", () => {
    const { result } = applyAssets();
    const afterShots = applyShots(result);

    const shots = afterShots.nodes.filter((node) => node.type === CanvasNodeType.Text);
    const group = afterShots.nodes.find((node) => node.type === CanvasNodeType.Group)!;
    const scene = afterShots.nodes.find((node) => node.type === DIRECTOR_SCENE_TYPE)!;

    expect(shots).toHaveLength(2);
    expect(shots.map((shot) => shot.title)).toEqual(["镜 1-1 · 图", "镜 1-2 · 视频"]);
    // 与场次同一行、排在场景右侧
    expect(shots[0].position.y).toBe(scene.position.y);
    expect(shots[0].position.x).toBeGreaterThan(scene.position.x + scene.width);
    // 归进组：侧边栏才能按组展开成树
    shots.forEach((shot) => expect(shot.metadata?.groupId).toBe(group.id));
    shots.forEach((shot) => expect(shot.metadata?.directorMeta).toMatchObject({ kind: "shot", sceneNodeId: scene.id }));
    expect(shots[0].metadata?.content).toContain("镜号：1-1");
    expect(shots[1].metadata?.content).toContain("生成类型：视频");
});

test("重跑第二步：只删分镜与组，资产节点（角色 / 物品 / 场次）原样保留", () => {
    const { result } = applyAssets();
    const afterShots = applyShots(result);

    const stale = afterShots.nodes.filter((node) => {
        const meta = node.metadata?.directorMeta as { directorNodeId?: string; kind?: string } | undefined;
        return meta?.directorNodeId === "director-1" && (meta.kind === "shot" || meta.kind === "group");
    });
    const cleaned = applyCanvasAgentOps(afterShots, [{ type: "delete_node", ids: stale.map((node) => node.id) }]);

    expect(cleaned.nodes).toHaveLength(result.nodes.length);
    expect(cleaned.nodes.some((node) => node.type === DIRECTOR_CHARACTER_TYPE)).toBe(true);
    expect(cleaned.nodes.some((node) => node.type === DIRECTOR_PROP_TYPE)).toBe(true);
    expect(cleaned.nodes.some((node) => node.type === DIRECTOR_SCENE_TYPE)).toBe(true);
    // 角色 → 场次、物品 → 场次 的连线保留，场次 → 分镜 的连线随分镜删掉
    expect(cleaned.connections).toHaveLength(3);
});

test("重跑第一步：清掉全部产物（场次变了，分镜必须重建）", () => {
    const { result } = applyAssets();
    const afterShots = applyShots(result);

    const stale = afterShots.nodes.filter((node) => {
        const meta = node.metadata?.directorMeta as { directorNodeId?: string } | undefined;
        return meta?.directorNodeId === "director-1";
    });
    const cleaned = applyCanvasAgentOps(afterShots, [{ type: "delete_node", ids: stale.map((node) => node.id) }]);

    expect(cleaned.nodes).toHaveLength(0);
    expect(cleaned.connections).toHaveLength(0);
});

test("关联素材：分镜默认继承所属场次的出场人物与出现物品（不依赖画布连线）", () => {
    const { result } = applyAssets();
    const afterShots = applyShots(result);
    const scene = afterShots.nodes.find((node) => node.type === DIRECTOR_SCENE_TYPE)!;
    const shot = afterShots.nodes.find((node) => node.type === CanvasNodeType.Text)!;

    // 把场次 → 分镜的连线删掉，关联素材照样能取到 —— 这正是「替代连线」的意义
    const withoutShotLinks = { ...afterShots, connections: afterShots.connections.filter((connection) => connection.toNodeId !== shot.id) };
    const association = collectShotAssociation({ shotNodeId: shot.id, nodes: withoutShotLinks.nodes, connections: withoutShotLinks.connections });

    expect(association.assets.map((asset) => asset.kind).sort()).toEqual(["character", "character", "prop", "scene"]);
    expect(association.assets.find((asset) => asset.kind === "scene")?.nodeId).toBe(scene.id);
    expect(association.context).toContain("地点：城东便利店");
    // 还没有生成任何参考图，所以全部算「缺图」
    expect(association.missingImages).toHaveLength(4);
});

test("关联素材：镜头自己配了 assetIds 时以它为准", () => {
    const { result } = applyAssets();
    const afterShots = applyShots(result);
    const shot = afterShots.nodes.find((node) => node.type === CanvasNodeType.Text)!;
    const character = afterShots.nodes.find((node) => node.type === DIRECTOR_CHARACTER_TYPE)!;

    const patched = applyCanvasAgentOps(afterShots, [
        { type: "update_node", id: shot.id, metadata: { directorMeta: { ...(shot.metadata?.directorMeta as object), assetIds: [character.id] } } },
    ]);
    const association = collectShotAssociation({ shotNodeId: shot.id, nodes: patched.nodes, connections: patched.connections });

    expect(association.assets).toHaveLength(1);
    expect(association.assets[0].nodeId).toBe(character.id);
});
