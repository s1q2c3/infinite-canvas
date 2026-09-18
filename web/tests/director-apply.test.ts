/**
 * 集成测试：把导演台生成的指令交给画布真正的指令执行器（applyCanvasAgentOps），
 * 验证落地的节点 / 连线 / 分组 / 折叠标记都符合预期。
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
const { buildCharacterPlan, buildSceneShotPlan, DIRECTOR_CHAPTER_TYPE, DIRECTOR_SCENE_TYPE } = await import("../src/lib/director/layout");
const { parseCharacters, parseScenesAndShots } = await import("../src/lib/director/parse");
const { CanvasNodeType } = await import("../src/types/canvas");
const { registerBuiltinNodes } = await import("../src/components/canvas/nodes/builtin-nodes");
const { registerDirectorNodes } = await import("../src/lib/director/register");

// 内置节点必须先注册：applyCanvasAgentOps 对未注册类型会退化成文本节点，
// 组节点（group）就是内置类型之一。真实应用里 project.tsx 也是先注册内置再注册导演台。
registerBuiltinNodes();
registerDirectorNodes();

const emptySnapshot = () => ({ projectId: "p1", title: "画布", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } });

const characterOutput = ["姓名：林小满", "分级：主角", "身份：便利店店员", "外貌：齐肩黑发", "生图提示词：22岁东亚女性", "---", "姓名：陈默", "分级：主角", "身份：建筑师", "外貌：清瘦高个", "生图提示词：25岁东亚男性"].join("\n");

const sceneOutput = [
    "=== 场景",
    "场景名：便利店门口",
    "地点：城东便利店",
    "出场人物：林小满、陈默",
    "生图提示词：雨夜便利店门口",
    "--- 分镜",
    "景别：全景",
    "画面：小满背对镜头锁门",
    "生图提示词：雨夜街道全景",
    "--- 分镜",
    "景别：中景",
    "画面：她回头",
    "生图提示词：中景，雨夜",
].join("\n");

/** 建一套完整的两步产物。 */
function buildBothSteps() {
    const characters = parseCharacters(characterOutput);
    const characterPlan = buildCharacterPlan({ directorNodeId: "director-1", characters, origin: { x: 0, y: 0 } });
    const lookup = new Map(characterPlan.characterNodeIds.map((id, index) => [characters[index].name, id]));
    const scenePlan = buildSceneShotPlan({
        directorNodeId: "director-1",
        characterLookup: lookup,
        origin: { x: 0, y: 1000 },
        chapters: [{ title: "第一章 雨夜重逢", text: "外面在下雨。", scenes: parseScenesAndShots(sceneOutput) }],
    });
    return { characterPlan, scenePlan };
}

test("第一步：人物节点真的落到画布上，并带上导演台归属标记", () => {
    const { characterPlan } = buildBothSteps();
    const result = applyCanvasAgentOps(emptySnapshot(), characterPlan.ops);

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.map((node) => node.type)).toEqual(["sqc:character", "sqc:character"]);
    expect(result.nodes[0].title).toBe("林小满");
    expect(result.nodes[0].metadata?.directorMeta).toMatchObject({ kind: "character", directorNodeId: "director-1", tier: "main" });
    // 节点文字是可读的字段文本，用户能直接在画布上改
    expect(result.nodes[0].metadata?.content).toContain("外貌：齐肩黑发");
});

test("第二步：章节 / 场景 / 分镜 / 组全部落地，连线与分组正确", () => {
    const { characterPlan, scenePlan } = buildBothSteps();
    const afterCharacters = applyCanvasAgentOps(emptySnapshot(), characterPlan.ops);
    const result = applyCanvasAgentOps(afterCharacters, scenePlan.ops);

    const byType = (type: string) => result.nodes.filter((node) => node.type === type);
    expect(byType(DIRECTOR_CHAPTER_TYPE)).toHaveLength(1);
    expect(byType(DIRECTOR_SCENE_TYPE)).toHaveLength(1);
    expect(byType(CanvasNodeType.Text)).toHaveLength(2);
    expect(byType(CanvasNodeType.Group)).toHaveLength(1);
    expect(result.nodes).toHaveLength(7); // 2 人物 + 1 章节 + 1 场景 + 2 分镜 + 1 组

    // 分镜被归进组：侧边栏才能按组展开成树
    const shots = byType(CanvasNodeType.Text);
    const group = byType(CanvasNodeType.Group)[0];
    shots.forEach((shot) => expect(shot.metadata?.groupId).toBe(group.id));

    // 连线：人物→场景 2 条 + 场景→分镜 2 条
    const sceneNode = byType(DIRECTOR_SCENE_TYPE)[0];
    expect(result.connections.filter((connection) => connection.toNodeId === sceneNode.id)).toHaveLength(2);
    expect(result.connections.filter((connection) => connection.fromNodeId === sceneNode.id)).toHaveLength(2);

    // 分镜记住所属场景，点生图时才能自动接上场景与人物
    expect(shots[0].metadata?.directorMeta).toMatchObject({ kind: "shot", sceneNodeId: sceneNode.id, index: 1 });
    expect(shots[1].metadata?.directorMeta).toMatchObject({ kind: "shot", sceneNodeId: sceneNode.id, index: 2 });

    // 镜号在场景内递增，并写进正文
    expect(shots[0].metadata?.content).toContain("镜号：1-1");
    expect(shots[1].metadata?.content).toContain("镜号：1-2");
});

test("折叠：把 hidden 打到场景与分镜上，节点与连线都还在（只是不渲染）", () => {
    const { characterPlan, scenePlan } = buildBothSteps();
    const applied = applyCanvasAgentOps(applyCanvasAgentOps(emptySnapshot(), characterPlan.ops), scenePlan.ops);
    const sceneNodeId = applied.nodes.find((node) => node.type === DIRECTOR_SCENE_TYPE)!.id;
    const shotIds = applied.nodes.filter((node) => node.type === CanvasNodeType.Text).map((node) => node.id);

    const collapsed = applyCanvasAgentOps(applied, [...shotIds, sceneNodeId].map((id) => ({ type: "update_node" as const, id, metadata: { hidden: true } })));

    expect(collapsed.nodes).toHaveLength(applied.nodes.length); // 没有删节点
    expect(collapsed.nodes.filter((node) => node.metadata?.hidden)).toHaveLength(3);
    expect(collapsed.connections).toHaveLength(applied.connections.length); // 连线也保留
});

test("重跑第二步：按归属标记能精确删掉上一轮产物，人物节点不受影响", () => {
    const { characterPlan, scenePlan } = buildBothSteps();
    const applied = applyCanvasAgentOps(applyCanvasAgentOps(emptySnapshot(), characterPlan.ops), scenePlan.ops);

    // 面板的清理逻辑：删掉本导演台除人物外的所有节点
    const stale = applied.nodes.filter((node) => {
        const meta = node.metadata?.directorMeta as { directorNodeId?: string; kind?: string } | undefined;
        return meta?.directorNodeId === "director-1" && meta.kind !== "character";
    });
    const cleaned = applyCanvasAgentOps(applied, [{ type: "delete_node", ids: stale.map((node) => node.id) }]);

    expect(cleaned.nodes).toHaveLength(2);
    expect(cleaned.nodes.every((node) => node.type === "sqc:character")).toBe(true);
    expect(cleaned.connections).toHaveLength(0);
});
