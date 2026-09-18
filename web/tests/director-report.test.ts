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

const prop = (id: string, name: string, content: string): CanvasNodeData => ({
    id,
    type: "sqc:prop",
    title: name,
    position: { x: 0, y: 0 },
    width: 240,
    height: 160,
    metadata: { content, directorMeta: { kind: "prop", directorNodeId: DIRECTOR, propId: `p-${id}` } },
});

const sceneNode = (id: string, order: number, name: string, content: string, characterIds: string[], propIds: string[] = [], chapterNodeId = "chapter-node-1"): CanvasNodeData => ({
    id,
    type: "sqc:scene",
    title: name,
    position: { x: 300, y: order * 900 },
    width: 260,
    height: 190,
    metadata: { content, directorMeta: { kind: "scene", directorNodeId: DIRECTOR, sceneId: `s-${id}`, order, chapterNodeId, characterIds, propIds } },
});

const shotNode = (id: string, index: number, sceneId: string, content: string): CanvasNodeData => ({
    id,
    type: CanvasNodeType.Text,
    title: `镜 ${index}`,
    position: { x: 700, y: 0 },
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
const PROP_TEXT = "名称：泛黄的信封\n类别：信物\n外观：米黄色牛皮纸，边角磨毛\n材质：纸\n生图提示词：米黄色旧信封特写";
const SCENE_TEXT = "场景名：便利店门口\n地点：城东便利店\n时间：深夜 23:40\n本场造型：日常\n生图提示词：雨夜便利店门口外景";
const SHOT_TEXT = "镜号：1-1\n生成类型：图\n时长：约 4 秒\n景别：全景\n画面：小满背对镜头锁门\n台词：林小满：你还是来了。\n生图提示词：雨夜街道全景";

function buildGraph() {
    const nodes: CanvasNodeData[] = [
        character("char-node-1", "林小满", CHARACTER_TEXT),
        prop("prop-node-1", "泛黄的信封", PROP_TEXT),
        chapterNode("chapter-node-1", 1, "第一章 雨夜重逢", "外面在下雨。"),
        sceneNode("scene-node-1", 1, "便利店门口", SCENE_TEXT, ["char-node-1"], ["prop-node-1"]),
        shotNode("shot-node-1", 1, "scene-node-1", SHOT_TEXT),
        shotNode("shot-node-2", 2, "scene-node-1", "镜号：1-2\n生成类型：视频\n景别：中景\n画面：她回头\n生图提示词：中景"),
    ];
    const connections: CanvasConnection[] = [
        { id: "c1", fromNodeId: "char-node-1", toNodeId: "scene-node-1" },
        { id: "c2", fromNodeId: "prop-node-1", toNodeId: "scene-node-1" },
        { id: "c3", fromNodeId: "scene-node-1", toNodeId: "shot-node-1" },
        { id: "c4", fromNodeId: "scene-node-1", toNodeId: "shot-node-2" },
    ];
    return { nodes, connections };
}

test("归集：人物 / 物品 / 章节 / 场景 / 分镜分层读出，出场人物与出现物品由 id 解析成当前名字", () => {
    const { nodes } = buildGraph();
    const data = collectDirectorData(nodes, DIRECTOR);

    expect(data.characters).toHaveLength(1);
    expect(data.characters[0].name).toBe("林小满");
    expect(data.characters[0].values.appearance).toBe("齐肩黑发低马尾，圆脸");

    expect(data.props).toHaveLength(1);
    expect(data.props[0].name).toBe("泛黄的信封");
    expect(data.props[0].values.appearance).toContain("米黄色牛皮纸");

    expect(data.chapters).toHaveLength(1);
    expect(data.chapters[0].chapterText).toBe("外面在下雨。");
    expect(data.chapters[0].scenes).toHaveLength(1);
    expect(data.chapters[0].scenes[0].characterNames).toEqual(["林小满"]);
    expect(data.chapters[0].scenes[0].propNames).toEqual(["泛黄的信封"]);
    expect(data.chapters[0].scenes[0].shots).toHaveLength(2);
    expect(data.orphanScenes).toHaveLength(0);
});

test("归集：读得出每镜的生成类型", () => {
    const { nodes } = buildGraph();
    const data = collectDirectorData(nodes, DIRECTOR);
    expect(data.shots.map((shot) => shot.output)).toEqual(["image", "video"]);
});

test("归集：改了人物 / 物品节点标题后，场景的名单自动跟着变（存的是 id）", () => {
    const { nodes } = buildGraph();
    const renamed = nodes.map((node) => (node.id === "char-node-1" ? { ...node, title: "林满" } : node.id === "prop-node-1" ? { ...node, title: "旧信" } : node));
    const data = collectDirectorData(renamed, DIRECTOR);
    expect(data.scenes[0].characterNames).toEqual(["林满"]);
    expect(data.scenes[0].propNames).toEqual(["旧信"]);
});

test("归集：不属于本导演台的节点不会被算进来", () => {
    const { nodes } = buildGraph();
    const data = collectDirectorData(nodes, "另一个导演台");
    expect(data.characters).toHaveLength(0);
    expect(data.scenes).toHaveLength(0);
});

test("归集：没归属章节的场景会进 orphanScenes", () => {
    const { nodes } = buildGraph();
    const withOrphan = [...nodes, sceneNode("scene-node-9", 9, "野场", SCENE_TEXT, [], [], "")];
    const data = collectDirectorData(withOrphan, DIRECTOR);
    expect(data.orphanScenes.map((scene) => scene.name)).toEqual(["野场"]);
});

test("自检：字段齐全时无问题", () => {
    const { nodes } = buildGraph();
    expect(runSelfCheck(collectDirectorData(nodes, DIRECTOR))).toEqual([]);
});

test("自检：缺必填字段 / 空场 / 说话人不在本场 / 物品缺字段都会被报出来", () => {
    const nodes: CanvasNodeData[] = [
        character("char-node-1", "林小满", "姓名：林小满\n身份：店员"),
        prop("prop-node-1", "钥匙", "名称：钥匙"),
        chapterNode("chapter-node-1", 1, "第一章", "原文"),
        sceneNode("scene-node-1", 1, "空场", "场景名：空场\n地点：某处", []),
        character("char-node-2", "陈默", CHARACTER_TEXT, "support"),
        sceneNode("scene-node-2", 2, "有场", SCENE_TEXT, ["char-node-2"]),
        shotNode("shot-node-1", 1, "scene-node-2", "镜号：2-1\n生成类型：图\n景别：全景\n画面：林小满背对镜头锁门，陈默站在雨里\n台词：林小满：你还是来了。\n生图提示词：x"),
    ];
    const issues = runSelfCheck(collectDirectorData(nodes, DIRECTOR));

    expect(issues.some((issue) => issue.scope.includes("林小满") && issue.message.includes("外貌"))).toBe(true);
    expect(issues.some((issue) => issue.scope.includes("钥匙") && issue.message.includes("外观"))).toBe(true);
    expect(issues.some((issue) => issue.scope.includes("空场") && issue.message.includes("一个分镜都没有"))).toBe(true);
    expect(issues.some((issue) => issue.message.includes("台词说话人「林小满」不在本场"))).toBe(true);
    expect(issues.some((issue) => issue.message.includes("画面提到「林小满」"))).toBe(true);
    expect(summarizeIssues(issues)).toContain("错误");
});

test("导出：分镜表 CSV 一镜一行，含生成类型与出场人物 / 出现物品", () => {
    const { nodes } = buildGraph();
    const csv = toShotCsv(collectDirectorData(nodes, DIRECTOR));
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3); // 表头 + 2 镜
    expect(lines[0]).toContain("生成类型");
    expect(lines[0]).toContain("出现物品");
    expect(lines[1]).toContain("便利店门口");
    expect(lines[1]).toContain("泛黄的信封");
    expect(lines[1]).toContain("图");
    expect(lines[2]).toContain("视频");
});

test("导出：JSON 可解析，结构是 人物 / 物品 / 章节 / 场景 / 分镜", () => {
    const { nodes } = buildGraph();
    const parsed = JSON.parse(toDirectorJson(collectDirectorData(nodes, DIRECTOR)));
    expect(parsed.characters).toHaveLength(1);
    expect(parsed.props).toHaveLength(1);
    expect(parsed.chapters[0].scenes[0].shots).toHaveLength(2);
    expect(parsed.chapters[0].scenes[0].characters).toEqual(["林小满"]);
    expect(parsed.chapters[0].scenes[0].props).toEqual(["泛黄的信封"]);
    expect(parsed.chapters[0].scenes[0].shots[1].output).toBe("视频");
});

test("导出：剧本格式含人物表、物品、场景与分镜生成类型", () => {
    const { nodes } = buildGraph();
    const script = toScript(collectDirectorData(nodes, DIRECTOR));
    expect(script).toContain("人物表");
    expect(script).toContain("重要物品");
    expect(script).toContain("【场景1】便利店门口");
    expect(script).toContain("出现物品：泛黄的信封");
    expect(script).toContain("【视频】");
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
    // 造型对不上时退回第一张，不让生成因为找不到参考图而失败
    expect(pickPhotoByLook(hits, "不存在的造型")?.image.id).toBe("img-daily");
});

test("自动接线：点分镜生图时补齐场景 + 人物 + 物品 + 参考图", () => {
    const { nodes, connections } = buildGraph();
    const withPhotos: CanvasNodeData[] = [
        ...nodes,
        { id: "cfg-char", type: CanvasNodeType.Config, title: "形象图", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { directorPhoto: { ownerId: "char-node-1", kind: "character", look: "日常" } } },
        { id: "img-char", type: CanvasNodeType.Image, title: "林小满", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { content: "blob:char" } },
        { id: "cfg-prop", type: CanvasNodeType.Config, title: "物品图", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { directorPhoto: { ownerId: "prop-node-1", kind: "prop" } } },
        { id: "img-prop", type: CanvasNodeType.Image, title: "信封", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { content: "blob:prop" } },
        { id: "cfg-scene", type: CanvasNodeType.Config, title: "场景图", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { directorPhoto: { ownerId: "scene-node-1", kind: "scene" } } },
        { id: "img-scene", type: CanvasNodeType.Image, title: "便利店门口", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { content: "blob:scene" } },
    ];
    const withPhotoConnections: CanvasConnection[] = [
        ...connections,
        { id: "p1", fromNodeId: "char-node-1", toNodeId: "cfg-char" },
        { id: "p2", fromNodeId: "cfg-char", toNodeId: "img-char" },
        { id: "p3", fromNodeId: "prop-node-1", toNodeId: "cfg-prop" },
        { id: "p4", fromNodeId: "cfg-prop", toNodeId: "img-prop" },
        { id: "p5", fromNodeId: "scene-node-1", toNodeId: "cfg-scene" },
        { id: "p6", fromNodeId: "cfg-scene", toNodeId: "img-scene" },
    ];

    const ids = collectShotReferenceNodeIds("shot-node-1", withPhotos, withPhotoConnections);
    expect(ids).toContain("scene-node-1");
    expect(ids).toContain("char-node-1");
    expect(ids).toContain("prop-node-1");
    expect(ids).toContain("img-char");
    expect(ids).toContain("img-prop");
    expect(ids).toContain("img-scene");
    expect(ids).not.toContain("shot-node-1");

    // 没有照片时也要能工作，只是少了参考图
    const withoutPhotos = collectShotReferenceNodeIds("shot-node-1", nodes, connections);
    expect(withoutPhotos.sort()).toEqual(["char-node-1", "prop-node-1", "scene-node-1"]);
});

test("自动接线：生视频时会额外带上已经生成好的分镜图作参考", () => {
    const { nodes, connections } = buildGraph();
    const withShotImage: CanvasNodeData[] = [
        ...nodes,
        { id: "cfg-shot", type: CanvasNodeType.Config, title: "分镜图", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { directorStack: true } },
        { id: "img-shot", type: CanvasNodeType.Image, title: "镜1-1", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { content: "blob:shot" } },
    ];
    const withShotConnections: CanvasConnection[] = [...connections, { id: "s1", fromNodeId: "shot-node-1", toNodeId: "cfg-shot" }, { id: "s2", fromNodeId: "cfg-shot", toNodeId: "img-shot" }];

    // 生图时不带分镜图
    expect(collectShotReferenceNodeIds("shot-node-1", withShotImage, withShotConnections)).not.toContain("img-shot");
    // 生视频时带上
    expect(collectShotReferenceNodeIds("shot-node-1", withShotImage, withShotConnections, { forVideo: true })).toContain("img-shot");
});

test("自动接线：普通文本节点不受影响", () => {
    const { nodes, connections } = buildGraph();
    expect(collectShotReferenceNodeIds("char-node-1", nodes, connections)).toEqual([]);
});
