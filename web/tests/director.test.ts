import { expect, test } from "bun:test";

import { buildAssetPlan, buildShotPlan, DIRECTOR_CHARACTER_TYPE, DIRECTOR_CHAPTER_TYPE, DIRECTOR_PROP_TYPE, DIRECTOR_SCENE_TYPE, type AssetBundle } from "../src/lib/director/layout";
import { splitNovelChapters } from "../src/lib/director/novel-split";
import { parseAssets, parseShotsByScene } from "../src/lib/director/parse";
import { DEFAULT_SHOT_PRESETS, readPresets } from "../src/lib/director/presets";
import { detectScriptKind, splitScriptSegments } from "../src/lib/director/script-parse";
import { CHARACTER_FIELDS, formatFields, parseFields, PROP_FIELDS, readShotOutputKind, SCENE_FIELDS, SHOT_FIELDS } from "../src/lib/director/spec";
import { CanvasNodeType } from "../src/types/canvas";

const novel = [
    "书名页的一行简介",
    "",
    "第一章 雨夜重逢",
    "外面在下雨。她站在便利店门口。",
    "",
    "第二章 旧信",
    "信封已经泛黄。",
    "",
    "第三章 决定",
    "她合上笔记本。",
].join("\n");

test("章节切分：按标题切分，标题前的内容作为前言", () => {
    const chapters = splitNovelChapters(novel);
    expect(chapters.map((item) => item.title)).toEqual(["前言", "第一章 雨夜重逢", "第二章 旧信", "第三章 决定"]);
    expect(chapters[1].body).toBe("外面在下雨。她站在便利店门口。");
});

test("章节切分：识别不到标题时按字数兜底且不丢字", () => {
    const plain = Array.from({ length: 40 }, (_, index) => `第${index}段` + "字".repeat(200)).join("\n");
    const chapters = splitNovelChapters(plain);
    expect(chapters.length).toBeGreaterThan(1);
    expect(chapters.map((item) => item.body).join("\n").replace(/\s/g, "")).toBe(plain.replace(/\s/g, ""));
});

test("字段格式化与解析可以来回转，且支持用户手改后的续行", () => {
    const values = { name: "林小满", identity: "便利店店员", appearance: "齐肩黑发\n圆脸", imagePrompt: "22岁东亚女性" };
    const text = formatFields(CHARACTER_FIELDS, values);
    expect(text).toContain("姓名：林小满");
    expect(text).not.toContain("年龄："); // 空值不输出

    const parsed = parseFields(CHARACTER_FIELDS, text);
    expect(parsed.name).toBe("林小满");
    expect(parsed.appearance).toBe("齐肩黑发\n圆脸");
});

test("分镜的生成类型能读出来，默认按生图处理", () => {
    expect(readShotOutputKind("生成类型：视频\n景别：全景")).toBe("video");
    expect(readShotOutputKind("生成类型：图\n景别：全景")).toBe("image");
    expect(readShotOutputKind("景别：全景")).toBe("image");
});

const assetOutput = [
    "### 人物",
    "姓名：林小满",
    "分级：主角",
    "身份：便利店夜班店员；大三学生",
    "外貌：齐肩黑发常扎低马尾，圆脸",
    "生图提示词：22岁东亚女性，米色针织衫",
    "---",
    "姓名：苏晴",
    "分级：配角",
    "身份：同事",
    "外貌：短发，圆眼镜",
    "生图提示词：24岁东亚女性，短发圆眼镜",
    "### 场景",
    "场景名：便利店门口",
    "地点：城东便利店，临街玻璃门外台阶",
    "时间：深夜 23:40",
    "内外景：外景",
    "季节天气：初秋 · 中雨",
    "氛围：冷清、潮湿",
    "光线：店内白炽灯背后逆光",
    "色调：青蓝为主",
    "关键道具：卷帘门、没打开的伞",
    "本场造型：日常",
    "场景目标：让两人重逢",
    "冲突：小满想装作没看见",
    "结果：小满被迫停下",
    "出场人物：林小满、苏晴",
    "出现物品：泛黄的信封",
    "生图提示词：雨夜便利店门口外景，青蓝冷调",
    "---",
    "场景名：街角屋檐下",
    "地点：便利店斜对面",
    "出场人物：林小满",
    "出现物品：无",
    "生图提示词：雨夜街角屋檐",
    "### 物品",
    "名称：泛黄的信封",
    "类别：信物",
    "外观：米黄色牛皮纸，边角磨毛，右上角有邮戳",
    "材质：纸",
    "关联人物：陈默",
    "出现场景：便利店门口",
    "剧情作用：揭开三年前不告而别的真相",
    "首次出现：第一章",
    "生图提示词：米黄色旧信封特写，边角磨毛，邮戳清晰",
].join("\n");

test("第一步解析：一次拆出人物 / 场景 / 物品三个区块", () => {
    const assets = parseAssets(assetOutput);

    expect(assets.characters).toHaveLength(2);
    expect(assets.characters[0].name).toBe("林小满");
    expect(assets.characters[0].tier).toBe("main");
    expect(assets.characters[1].tier).toBe("support");

    expect(assets.scenes).toHaveLength(2);
    expect(assets.scenes[0].values.name).toBe("便利店门口");
    expect(assets.scenes[0].characterNames).toEqual(["林小满", "苏晴"]);
    expect(assets.scenes[0].propNames).toEqual(["泛黄的信封"]);
    expect(assets.scenes[0].look).toBe("日常");
    // 「出场人物 / 出现物品」不进正文，避免用户手改文字时和 id 列表打架
    expect(assets.scenes[0].values.characters).toBeUndefined();
    expect(assets.scenes[0].values.propNames).toBeUndefined();
    expect(assets.scenes[1].propNames).toEqual([]); // 「无」被过滤掉

    expect(assets.props).toHaveLength(1);
    expect(assets.props[0].name).toBe("泛黄的信封");
    expect(assets.props[0].values.appearance).toContain("米黄色牛皮纸");
});

test("第一步解析：代码块围栏和乱序区块都能吃下", () => {
    const raw = ["```", "### 物品", "名称：钥匙", "外观：黄铜，磨得发亮", "生图提示词：黄铜钥匙特写", "### 人物", "姓名：老周", "分级：配角", "身份：店长", "外貌：谢顶，戴袖套", "生图提示词：50岁东亚男性，谢顶", "```"].join("\n");
    const assets = parseAssets(raw);
    expect(assets.props.map((item) => item.name)).toEqual(["钥匙"]);
    expect(assets.characters.map((item) => item.name)).toEqual(["老周"]);
    expect(assets.scenes).toEqual([]);
});

const shotOutput = [
    "=== 便利店门口",
    "--- 分镜",
    "生成类型：图",
    "时长：约 4 秒",
    "景别：全景",
    "画面：小满背对镜头锁门，针织衫被雨打湿",
    "台词：无",
    "生图提示词：雨夜街道全景，玻璃门透出白光",
    "--- 分镜",
    "生成类型：视频",
    "时长：约 3 秒",
    "景别：中景",
    "画面：她回头，伞尖在滴水",
    "台词：林小满：你还是来了。",
    "生图提示词：中景，雨夜街道",
    "=== 场景：街角屋檐下",
    "--- 分镜",
    "生成类型：图",
    "景别：近景",
    "画面：两人并肩站在屋檐下",
    "生图提示词：近景，雨夜屋檐",
].join("\n");

test("第二步解析：按场景名分组，并读出每镜的生成类型", () => {
    const groups = parseShotsByScene(shotOutput);
    expect(groups).toHaveLength(2);
    expect(groups[0].sceneName).toBe("便利店门口");
    expect(groups[0].shots).toHaveLength(2);
    expect(groups[0].shots[0].values.shotSize).toBe("全景");
    expect(readShotOutputKind(formatFields(SHOT_FIELDS, groups[0].shots[1].values))).toBe("video");
    // 「=== 场景：xxx」这种写法要去掉前缀
    expect(groups[1].sceneName).toBe("街角屋檐下");
});

test("第二步解析：没有画面的空块会被丢掉", () => {
    const raw = ["=== 空场", "--- 分镜", "台词：无"].join("\n");
    const groups = parseShotsByScene(raw);
    expect(groups).toHaveLength(1);
    expect(groups[0].shots).toHaveLength(0);
});

function buildBundle(): AssetBundle {
    const assets = parseAssets(assetOutput);
    return {
        characters: assets.characters,
        props: assets.props,
        segments: [{ title: "第一章 雨夜重逢", text: "外面在下雨。", scenes: assets.scenes }],
    };
}

test("资产布局：角色区 / 物品区 / 场次列三段分开，且不再建章节节点", () => {
    const { ops, characterNodeIds, propNodeIds, sceneNodeIds } = buildAssetPlan({
        directorNodeId: "director-1",
        bundle: buildBundle(),
        origin: { x: 0, y: 0 },
    });

    const added = ops.filter((op) => op.type === "add_node");
    if (added.some((op) => op.type !== "add_node")) throw new Error("类型不对");
    const chars = added.filter((op) => op.type === "add_node" && op.nodeType === DIRECTOR_CHARACTER_TYPE);
    const props = added.filter((op) => op.type === "add_node" && op.nodeType === DIRECTOR_PROP_TYPE);
    const chapters = added.filter((op) => op.type === "add_node" && op.nodeType === DIRECTOR_CHAPTER_TYPE);
    const scenes = added.filter((op) => op.type === "add_node" && op.nodeType === DIRECTOR_SCENE_TYPE);

    expect(chars).toHaveLength(2);
    expect(props).toHaveLength(1);
    // 「章」已经降级成场次上的分组属性，不再建章节节点
    expect(chapters).toHaveLength(0);
    expect(scenes).toHaveLength(2);
    expect(characterNodeIds).toHaveLength(2);
    expect(propNodeIds).toHaveLength(1);
    expect(sceneNodeIds).toHaveLength(2);

    if (chars[0].type !== "add_node" || chars[1].type !== "add_node") throw new Error("类型不对");
    if (props[0].type !== "add_node") throw new Error("类型不对");
    if (scenes[0].type !== "add_node" || scenes[1].type !== "add_node") throw new Error("类型不对");

    // 角色主角排前面，横向排开
    expect(chars[0].title).toBe("林小满");
    expect(chars[1].x).toBeGreaterThan(chars[0].x);
    expect(chars[1].y).toBe(chars[0].y);

    // 物品区在角色区下方（角色高 170 + 行距 90）
    expect(props[0].y).toBe(170 + 90);

    // 场次列在物品区下方，一场一行往下排（物品高 160 + 行距 90）
    expect(scenes[0].y).toBe(170 + 90 + 160 + 90);
    expect(scenes[1].y - scenes[0].y).toBe(190 + 90);
    expect(scenes[0].x).toBe(scenes[1].x);

    // 连线：人物→场次 + 物品→场次
    const connections = ops.filter((op) => op.type === "connect_nodes");
    expect(connections).toHaveLength(4); // 场次1：两人 + 一物品；场次2：一人
    const toScene2 = connections.filter((op) => op.type === "connect_nodes" && op.toNodeId === sceneNodeIds[1]);
    expect(toScene2).toHaveLength(1);

    // 场次上带段标题与段正文，出场人物 / 出现物品存的是节点 id
    expect(scenes[0].metadata?.directorMeta).toMatchObject({
        kind: "scene",
        chapterTitle: "第一章 雨夜重逢",
        script: "外面在下雨。",
        characterIds: [characterNodeIds[0], characterNodeIds[1]],
        propIds: [propNodeIds[0]],
    });
    expect(scenes[1].metadata?.directorMeta).toMatchObject({ kind: "scene", propIds: [] });
});

test("输入甄别：剧本按场次标记切段，小说按章切段", () => {
    const script = ["1．内景 咖啡馆 日", "小满坐在窗边。", "", "小满：你来晚了。", "", "2．外景 街道 夜", "雨还在下。"].join("\n");
    expect(detectScriptKind(script)).toBe("script");
    expect(splitScriptSegments(script, "script").length).toBeGreaterThanOrEqual(2);

    expect(detectScriptKind(novel)).toBe("novel");
    expect(splitScriptSegments(novel, "novel").map((item) => item.title)).toContain("第一章 雨夜重逢");
});

test("镜头预设：没配过时回落到默认那套，配过就用项目里的", () => {
    expect(readPresets(undefined)).toBe(DEFAULT_SHOT_PRESETS);
    expect(readPresets([])).toBe(DEFAULT_SHOT_PRESETS);
    const custom = [{ id: "p1", name: "自定义", values: { shotSize: "中景" } }];
    expect(readPresets(custom)).toEqual(custom);
    // 结构不完整的数据会被过滤掉，避免界面拿到半截对象
    expect(readPresets([{ id: "bad" }])).toBe(DEFAULT_SHOT_PRESETS);
});

test("分镜布局：挂到已有场景右侧，标题带上生成类型", () => {
    const groups = parseShotsByScene(shotOutput);
    const { ops, shotNodeIds, shotsByScene } = buildShotPlan({
        directorNodeId: "director-1",
        assignments: [{ sceneNodeId: "scene-node-1", shots: groups[0].shots }],
        geometry: new Map([["scene-node-1", { x: 300, y: 1000, width: 260, order: 1 }]]),
    });

    const added = ops.filter((op) => op.type === "add_node");
    if (added.some((op) => op.type !== "add_node")) throw new Error("类型不对");
    const shots = added.filter((op) => op.type === "add_node" && op.nodeType === CanvasNodeType.Text);
    const groupNodes = added.filter((op) => op.type === "add_node" && op.nodeType === CanvasNodeType.Group);

    expect(shots).toHaveLength(2);
    expect(groupNodes).toHaveLength(1);
    expect(shotNodeIds).toHaveLength(2);
    expect(shotsByScene["scene-node-1"]).toHaveLength(2);

    if (shots[0].type !== "add_node" || shots[1].type !== "add_node") throw new Error("类型不对");
    // 与场景同一行、排在场景右侧
    expect(shots[0].y).toBe(1000);
    expect(shots[0].x).toBeGreaterThan(300 + 260);
    expect(shots[1].x).toBeGreaterThan(shots[0].x);
    // 标题直接标出这一镜该生图还是生视频
    expect(shots[0].title).toBe("镜 1-1 · 图");
    expect(shots[1].title).toBe("镜 1-2 · 视频");
    // 镜号在场景内递增
    expect(shots[0].metadata?.content).toContain("镜号：1-1");
    expect(shots[1].metadata?.content).toContain("镜号：1-2");

    // 分镜被归进组，侧边栏才能按组展开成树
    const group = groupNodes[0];
    if (group.type !== "add_node") throw new Error("类型不对");
    const assignments = ops.filter((op) => op.type === "update_node" && op.metadata?.groupId);
    expect(assignments).toHaveLength(2);

    // 场景 → 分镜 连线
    const connections = ops.filter((op) => op.type === "connect_nodes");
    expect(connections).toHaveLength(2);
});

test("分镜布局：场景找不到时安全跳过，不产生空组", () => {
    const groups = parseShotsByScene(shotOutput);
    const { ops } = buildShotPlan({
        directorNodeId: "director-1",
        assignments: [{ sceneNodeId: "不存在的场景", shots: groups[0].shots }],
        geometry: new Map(),
    });
    expect(ops).toHaveLength(0);
});

test("字段规格：人物 14 / 场景 15 / 分镜 17 / 物品 9，且场景正文不含出场人物与出现物品", () => {
    expect(CHARACTER_FIELDS).toHaveLength(14);
    expect(SHOT_FIELDS).toHaveLength(17);
    expect(PROP_FIELDS).toHaveLength(9);
    expect(SCENE_FIELDS.some((field) => field.label === "出场人物")).toBe(false);
    expect(SCENE_FIELDS.some((field) => field.label === "出现物品")).toBe(false);
});
