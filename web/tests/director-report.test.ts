import { expect, test } from "bun:test";

import { collectShotAssociation } from "../src/lib/director/associate";
import { collectDirectorData } from "../src/lib/director/collect";
import { toDirectorJson, toScript, toShotCsv } from "../src/lib/director/export";
import { findDownstreamImages, pickPhotoByLook } from "../src/lib/director/photos";
import { runSelfCheck, summarizeIssues } from "../src/lib/director/self-check";
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

/** 场次节点：段标题与段正文直接存在 directorMeta 上（不再有章节节点）。 */
const sceneNode = (id: string, order: number, name: string, content: string, characterIds: string[], propIds: string[] = [], chapterTitle = "第一章 雨夜重逢"): CanvasNodeData => ({
    id,
    type: "sqc:scene",
    title: name,
    position: { x: 300, y: order * 900 },
    width: 260,
    height: 190,
    metadata: { content, directorMeta: { kind: "scene", directorNodeId: DIRECTOR, sceneId: `s-${id}`, order, chapterTitle, script: "外面在下雨。", characterIds, propIds } },
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

/** 图片节点：生成结果放在 metadata.images 里（和真实生成流程一致）。 */
const imageNode = (id: string, title: string, content: string): CanvasNodeData => ({
    id,
    type: CanvasNodeType.Image,
    title,
    position: { x: 0, y: 0 },
    width: 340,
    height: 240,
    metadata: { status: "success", images: [{ id: `${id}-img`, status: "success", content }] },
});

const photoConfig = (id: string, ownerId: string, kind: "character" | "scene" | "prop", look?: string): CanvasNodeData => ({
    id,
    type: CanvasNodeType.Config,
    title: "形象图",
    position: { x: 0, y: 0 },
    width: 340,
    height: 240,
    metadata: { directorPhoto: { ownerId, kind, look } },
});

const CHARACTER_TEXT = "姓名：林小满\n身份：便利店夜班店员\n年龄：22\n外貌：齐肩黑发低马尾，圆脸\n生图提示词：22岁东亚女性，米色针织衫";
const PROP_TEXT = "名称：泛黄的信封\n类别：信物\n外观：米黄色牛皮纸，边角磨毛\n材质：纸\n生图提示词：米黄色旧信封特写";
const SCENE_TEXT = "场景名：便利店门口\n地点：城东便利店\n时间：深夜 23:40\n本场造型：日常\n生图提示词：雨夜便利店门口外景";
const SHOT_TEXT = "镜号：1-1\n生成类型：图\n时长：约 4 秒\n景别：全景\n画面：小满背对镜头锁门\n台词：林小满：你还是来了。\n生图提示词：雨夜街道全景";

function buildGraph() {
    const nodes: CanvasNodeData[] = [
        character("char-node-1", "林小满", CHARACTER_TEXT),
        prop("prop-node-1", "泛黄的信封", PROP_TEXT),
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

test("归集：角色 / 物品 / 场次 / 分镜分层读出，场次按段标题聚合成组", () => {
    const { nodes } = buildGraph();
    const data = collectDirectorData(nodes, DIRECTOR);

    expect(data.characters).toHaveLength(1);
    expect(data.characters[0].name).toBe("林小满");
    expect(data.characters[0].values.appearance).toBe("齐肩黑发低马尾，圆脸");

    expect(data.props).toHaveLength(1);
    expect(data.props[0].name).toBe("泛黄的信封");
    expect(data.props[0].values.appearance).toContain("米黄色牛皮纸");

    // 「章」是虚拟分组：按场次上的 chapterTitle 聚合，画布上没有对应节点
    expect(data.chapters).toHaveLength(1);
    expect(data.chapters[0].title).toBe("第一章 雨夜重逢");
    expect(data.chapters[0].chapterText).toBe("外面在下雨。");
    expect(data.chapters[0].scenes).toHaveLength(1);
    expect(data.chapters[0].scenes[0].characterNames).toEqual(["林小满"]);
    expect(data.chapters[0].scenes[0].propNames).toEqual(["泛黄的信封"]);
    expect(data.chapters[0].scenes[0].shots).toHaveLength(2);
});

test("归集：读得出每镜的生成类型", () => {
    const { nodes } = buildGraph();
    const data = collectDirectorData(nodes, DIRECTOR);
    expect(data.shots.map((shot) => shot.output)).toEqual(["image", "video"]);
});

test("归集：改了角色 / 物品节点标题后，场次的名单自动跟着变（存的是 id）", () => {
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

test("归集：没有段标题的场次归到「未分组」", () => {
    const { nodes } = buildGraph();
    const withOrphan = [...nodes, sceneNode("scene-node-9", 9, "野场", SCENE_TEXT, [], [], "")];
    const data = collectDirectorData(withOrphan, DIRECTOR);
    const ungrouped = data.chapters.find((chapter) => chapter.title === "未分组");
    expect(ungrouped?.scenes.map((scene) => scene.name)).toEqual(["野场"]);
});

test("自检：字段齐全时无问题", () => {
    const { nodes } = buildGraph();
    expect(runSelfCheck(collectDirectorData(nodes, DIRECTOR))).toEqual([]);
});

test("自检：缺必填字段 / 空场 / 说话人不在本场 / 物品缺字段都会被报出来", () => {
    const nodes: CanvasNodeData[] = [
        character("char-node-1", "林小满", "姓名：林小满\n身份：店员"),
        prop("prop-node-1", "钥匙", "名称：钥匙"),
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

test("导出：JSON 可解析，结构是 角色 / 物品 / 段 / 场次 / 分镜", () => {
    const { nodes } = buildGraph();
    const parsed = JSON.parse(toDirectorJson(collectDirectorData(nodes, DIRECTOR)));
    expect(parsed.characters).toHaveLength(1);
    expect(parsed.props).toHaveLength(1);
    expect(parsed.chapters[0].scenes[0].shots).toHaveLength(2);
    expect(parsed.chapters[0].scenes[0].characters).toEqual(["林小满"]);
    expect(parsed.chapters[0].scenes[0].props).toEqual(["泛黄的信封"]);
    expect(parsed.chapters[0].scenes[0].shots[1].output).toBe("视频");
});

test("导出：剧本格式含人物表、物品、场次与分镜生成类型", () => {
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
        photoConfig("cfg-daily", "char-node-1", "character", "日常"),
        photoConfig("cfg-school", "char-node-1", "character", "校服"),
        imageNode("img-daily", "日常", "blob:daily"),
        imageNode("img-school", "校服", "blob:school"),
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

test("关联素材：把场次 + 出场角色 + 出现物品连同已生成的参考图一起带出来", () => {
    const { nodes, connections } = buildGraph();
    const withPhotos: CanvasNodeData[] = [
        ...nodes,
        photoConfig("cfg-char", "char-node-1", "character", "日常"),
        imageNode("img-char", "林小满", "blob:char"),
        photoConfig("cfg-prop", "prop-node-1", "prop"),
        imageNode("img-prop", "信封", "blob:prop"),
        photoConfig("cfg-scene", "scene-node-1", "scene"),
        imageNode("img-scene", "便利店门口", "blob:scene"),
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

    const association = collectShotAssociation({ shotNodeId: "shot-node-1", nodes: withPhotos, connections: withPhotoConnections });
    expect(association.assets.map((asset) => asset.kind).sort()).toEqual(["character", "prop", "scene"]);
    expect(association.assets.find((asset) => asset.kind === "character")?.imageUrl).toBe("blob:char");
    expect(association.assets.find((asset) => asset.kind === "prop")?.imageUrl).toBe("blob:prop");
    expect(association.assets.find((asset) => asset.kind === "scene")?.imageUrl).toBe("blob:scene");
    expect(association.missingImages).toHaveLength(0);
    expect(association.context).toContain("地点：城东便利店");

    // 没有照片时也要能工作，只是少了参考图
    const bare = collectShotAssociation({ shotNodeId: "shot-node-1", nodes, connections });
    expect(bare.assets.map((asset) => asset.kind).sort()).toEqual(["character", "prop", "scene"]);
    expect(bare.missingImages).toHaveLength(3);
});

test("关联素材：生视频时额外带上已经生成好的分镜图", () => {
    const { nodes, connections } = buildGraph();
    const withShotImage: CanvasNodeData[] = [...nodes, imageNode("img-shot", "镜1-1", "blob:shot")];
    const withShotConnections: CanvasConnection[] = [...connections, { id: "s1", fromNodeId: "shot-node-1", toNodeId: "img-shot" }];

    // 生图时不带分镜图
    expect(collectShotAssociation({ shotNodeId: "shot-node-1", nodes: withShotImage, connections: withShotConnections }).assets.map((asset) => asset.imageUrl)).not.toContain("blob:shot");
    // 生视频时带上
    expect(
        collectShotAssociation({ shotNodeId: "shot-node-1", nodes: withShotImage, connections: withShotConnections, forVideo: true }).assets.map((asset) => asset.imageUrl),
    ).toContain("blob:shot");
});

test("关联素材：普通节点不受影响", () => {
    const { nodes, connections } = buildGraph();
    expect(collectShotAssociation({ shotNodeId: "char-node-1", nodes, connections }).assets).toEqual([]);
});
