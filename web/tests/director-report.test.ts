import { expect, test } from "bun:test";

import { collectDirectorData } from "../src/lib/director/collect";
import { toDirectorJson, toScript, toShotCsv } from "../src/lib/director/export";
import { findDownstreamImages, pickPhotoByLook } from "../src/lib/director/photos";
import { runSelfCheck, summarizeIssues } from "../src/lib/director/self-check";
import { collectShotReferenceNodeIds } from "../src/lib/director/wiring";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

const DIRECTOR = "director-1";

const character = (id: string, name: string, content: string, tier: "main" | "support" = "main"): CanvasNodeData => ({
    id,
    type: "sqc:character",
    title: name,
    position: { x: 0, y: 0 },
    width: 240,
    height: 170,
    metadata: { content, directorMeta: { kind: "character", directorNodeId: DIRECTOR, characterId: `c-${id}`, tier } },
});

const sceneNode = (id: string, order: number, name: string, content: string, characterIds: string[], chapterNodeId = "chapter-node-1"): CanvasNodeData => ({
    id,
    type: "sqc:scene",
    title: name,
    position: { x: 0, y: order * 300 },
    width: 260,
    height: 190,
    metadata: { content, directorMeta: { kind: "scene", directorNodeId: DIRECTOR, sceneId: `s-${id}`, order, chapterNodeId, characterIds } },
});

const shotNode = (id: string, index: number, sceneId: string, content: string): CanvasNodeData => ({
    id,
    type: CanvasNodeType.Text,
    title: `镜 ${index}`,
    position: { x: 0, y: 0 },
    width: 340,
    height: 240,
    metadata: { content, directorMeta: { kind: "shot", directorNodeId: DIRECTOR, shotId: `k-${id}`, sceneNodeId: sceneId, index } },
});

const chapterNode = (id: string, order: number, title: string, chapterText: string): CanvasNodeData => ({
    id,
    type: "sqc:chapter",
    title,
    position: { x: 0, y: 0 },
    width: 220,
    height: 300,
    metadata: { content: title, directorMeta: { kind: "chapter", directorNodeId: DIRECTOR, chapterId: `h-${id}`, order, chapterText } },
});

const CHARACTER_TEXT = "姓名：林小满\n身份：便利店夜班店员\n年龄：22\n外貌：齐肩黑发低马尾，圆脸\n生图提示词：22岁东亚女性，米色针织衫";
const SCENE_TEXT = "场景名：便利店门口\n地点：城东便利店\n时间：深夜 23:40\n本场造型：日常\n生图提示词：雨夜便利店门口外景";
const SHOT_TEXT = "镜号：1-1\n时长：约 4 秒\n景别：全景\n画面：小满背对镜头锁门\n台词：林小满：你还是来了。\n生图提示词：雨夜街道全景";

function buildGraph() {
    const nodes: CanvasNodeData[] = [
        character("char-node-1", "林小满", CHARACTER_TEXT),
        chapterNode("chapter-node-1", 1, "第一章 雨夜重逢", "外面在下雨。"),
        sceneNode("scene-node-1", 1, "便利店门口", SCENE_TEXT, ["char-node-1"]),
        shotNode("shot-node-1", 1, "scene-node-1", SHOT_TEXT),
        shotNode("shot-node-2", 2, "scene-node-1", "镜号：1-2\n景别：中景\n画面：她回头\n生图提示词：中景"),
    ];
    const connections: CanvasConnection[] = [
        { id: "c1", fromNodeId: "char-node-1", toNodeId: "scene-node-1" },
        { id: "c2", fromNodeId: "scene-node-1", toNodeId: "shot-node-1" },
        { id: "c3", fromNodeId: "scene-node-1", toNodeId: "shot-node-2" },
    ];
    return { nodes, connections };
}

test("归集：人物 / 章节 / 场景 / 分镜分层读出，出场人物由 id 解析成当前名字", () => {
    const { nodes } = buildGraph();
    const data = collectDirectorData(nodes, DIRECTOR);

    expect(data.characters).toHaveLength(1);
    expect(data.characters[0].name).toBe("林小满");
    expect(data.characters[0].values.appearance).toBe("齐肩黑发低马尾，圆脸");

    expect(data.chapters).toHaveLength(1);
    expect(data.chapters[0].chapterText).toBe("外面在下雨。");
    expect(data.chapters[0].scenes).toHaveLength(1);
    expect(data.chapters[0].scenes[0].characterNames).toEqual(["林小满"]);
    expect(data.chapters[0].scenes[0].shots).toHaveLength(2);
    expect(data.shots).toHaveLength(2);
    expect(data.orphanScenes).toHaveLength(0);
});

test("归集：改了人物节点标题后，场景的出场人物自动跟着变（存的是 id）", () => {
    const { nodes } = buildGraph();
    const renamed = nodes.map((node) => (node.id === "char-node-1" ? { ...node, title: "林满" } : node));
    const data = collectDirectorData(renamed, DIRECTOR);
    expect(data.scenes[0].characterNames).toEqual(["林满"]);
});

test("归集：不属于本导演台的节点不会被算进来", () => {
    const { nodes } = buildGraph();
    const data = collectDirectorData(nodes, "另一个导演台");
    expect(data.characters).toHaveLength(0);
    expect(data.scenes).toHaveLength(0);
});

test("归集：没归属章节的场景会进 orphanScenes", () => {
    const { nodes } = buildGraph();
    const withOrphan = [...nodes, sceneNode("scene-node-9", 9, "野场", SCENE_TEXT, [], "")];
    const data = collectDirectorData(withOrphan, DIRECTOR);
    expect(data.orphanScenes.map((scene) => scene.name)).toEqual(["野场"]);
});

test("自检：字段齐全时无问题", () => {
    const { nodes } = buildGraph();
    expect(runSelfCheck(collectDirectorData(nodes, DIRECTOR))).toEqual([]);
});

test("自检：缺必填字段 / 空场 / 说话人不在本场都会被报出来", () => {
    const nodes: CanvasNodeData[] = [
        // 缺外貌和生图提示词
        character("char-node-1", "林小满", "姓名：林小满\n身份：店员"),
        chapterNode("chapter-node-1", 1, "第一章", "原文"),
        // 一个分镜都没有
        sceneNode("scene-node-1", 1, "空场", "场景名：空场\n地点：某处", []),
        // 出场人物只有陈默，但台词是林小满说的
        character("char-node-2", "陈默", CHARACTER_TEXT, "support"),
        sceneNode("scene-node-2", 2, "有场", SCENE_TEXT, ["char-node-2"]),
        shotNode("shot-node-1", 1, "scene-node-2", "镜号：2-1\n景别：全景\n画面：林小满背对镜头锁门，陈默站在雨里\n台词：林小满：你还是来了。\n生图提示词：x"),
    ];
    const issues = runSelfCheck(collectDirectorData(nodes, DIRECTOR));

    expect(issues.some((issue) => issue.scope.includes("林小满") && issue.message.includes("外貌"))).toBe(true);
    expect(issues.some((issue) => issue.scope.includes("空场") && issue.message.includes("一个分镜都没有"))).toBe(true);
    expect(issues.some((issue) => issue.scope.includes("空场") && issue.message.includes("出场人物为空"))).toBe(true);
    expect(issues.some((issue) => issue.message.includes("台词说话人「林小满」不在本场"))).toBe(true);
    expect(issues.some((issue) => issue.message.includes("画面提到「林小满」"))).toBe(true);
    expect(summarizeIssues(issues)).toContain("错误");
});

test("导出：分镜表 CSV 一镜一行，含表头与出场人物", () => {
    const { nodes } = buildGraph();
    const csv = toShotCsv(collectDirectorData(nodes, DIRECTOR));
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3); // 表头 + 2 镜
    expect(lines[0]).toContain("镜号");
    expect(lines[0]).toContain("生图提示词");
    expect(lines[1]).toContain("便利店门口");
    expect(lines[1]).toContain("林小满");
});

test("导出：JSON 可解析，结构是 人物 / 章节 / 场景 / 分镜", () => {
    const { nodes } = buildGraph();
    const parsed = JSON.parse(toDirectorJson(collectDirectorData(nodes, DIRECTOR)));
    expect(parsed.characters).toHaveLength(1);
    expect(parsed.chapters[0].scenes[0].shots).toHaveLength(2);
    expect(parsed.chapters[0].scenes[0].characters).toEqual(["林小满"]);
});

test("导出：剧本格式含人物表、场景与分镜", () => {
    const { nodes } = buildGraph();
    const script = toScript(collectDirectorData(nodes, DIRECTOR));
    expect(script).toContain("人物表");
    expect(script).toContain("【场景1】便利店门口");
    expect(script).toContain("台词：林小满：你还是来了。");
});

test("照片查找：走「主体 → 配置 → 图片」两跳，并能按造型挑", () => {
    const nodes: CanvasNodeData[] = [
        character("char-node-1", "林小满", CHARACTER_TEXT),
        { id: "cfg-daily", type: CanvasNodeType.Config, title: "形象图", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { directorPhoto: { ownerId: "char-node-1", kind: "character", look: "日常" } } },
        { id: "cfg-school", type: CanvasNodeType.Config, title: "形象图", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { directorPhoto: { ownerId: "char-node-1", kind: "character", look: "校服" } } },
        { id: "img-daily", type: CanvasNodeType.Image, title: "日常", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { content: "blob:daily" } },
        { id: "img-school", type: CanvasNodeType.Image, title: "校服", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { content: "blob:school" } },
    ];
    const connections: CanvasConnection[] = [
        { id: "1", fromNodeId: "char-node-1", toNodeId: "cfg-daily" },
        { id: "2", fromNodeId: "cfg-daily", toNodeId: "img-daily" },
        { id: "3", fromNodeId: "char-node-1", toNodeId: "cfg-school" },
        { id: "4", fromNodeId: "cfg-school", toNodeId: "img-school" },
    ];

    const hits = findDownstreamImages("char-node-1", nodes, connections);
    expect(hits).toHaveLength(2);
    expect(pickPhotoByLook(hits, "校服")?.image.id).toBe("img-school");
    expect(pickPhotoByLook(hits, "日常")?.image.id).toBe("img-daily");
    // 造型对不上时退回第一张，不让生图因为找不到参考图而失败
    expect(pickPhotoByLook(hits, "不存在的造型")?.image.id).toBe("img-daily");
});

test("自动接线：点分镜生图时补齐场景 + 出场人物 + 参考图", () => {
    const { nodes, connections } = buildGraph();
    const withPhotos: CanvasNodeData[] = [
        ...nodes,
        { id: "cfg-char", type: CanvasNodeType.Config, title: "形象图", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { directorPhoto: { ownerId: "char-node-1", kind: "character", look: "日常" } } },
        { id: "img-char", type: CanvasNodeType.Image, title: "林小满", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { content: "blob:char" } },
        { id: "cfg-scene", type: CanvasNodeType.Config, title: "场景图", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { directorPhoto: { ownerId: "scene-node-1", kind: "scene" } } },
        { id: "img-scene", type: CanvasNodeType.Image, title: "便利店门口", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { content: "blob:scene" } },
    ];
    const withPhotoConnections: CanvasConnection[] = [
        ...connections,
        { id: "p1", fromNodeId: "char-node-1", toNodeId: "cfg-char" },
        { id: "p2", fromNodeId: "cfg-char", toNodeId: "img-char" },
        { id: "p3", fromNodeId: "scene-node-1", toNodeId: "cfg-scene" },
        { id: "p4", fromNodeId: "cfg-scene", toNodeId: "img-scene" },
    ];

    const ids = collectShotReferenceNodeIds("shot-node-1", withPhotos, withPhotoConnections);
    expect(ids).toContain("scene-node-1"); // 场景设定
    expect(ids).toContain("char-node-1"); // 人物设定
    expect(ids).toContain("img-char"); // 人物照片 → 参考图
    expect(ids).toContain("img-scene"); // 场景照片 → 参考图
    expect(ids).not.toContain("shot-node-1"); // 分镜自己由内置流程连

    // 没有照片时也要能工作，只是少了参考图
    const withoutPhotos = collectShotReferenceNodeIds("shot-node-1", nodes, connections);
    expect(withoutPhotos).toEqual(["scene-node-1", "char-node-1"]);
});

test("自动接线：普通文本节点不受影响", () => {
    const { nodes, connections } = buildGraph();
    expect(collectShotReferenceNodeIds("char-node-1", nodes, connections)).toEqual([]);
});
