import { expect, test } from "bun:test";

import { buildCharacterPlan, buildSceneShotPlan, DIRECTOR_CHARACTER_TYPE, DIRECTOR_CHAPTER_TYPE, DIRECTOR_LAYOUT, DIRECTOR_SCENE_TYPE } from "../src/lib/director/layout";
import { splitNovelChapters } from "../src/lib/director/novel-split";
import { parseCharacters, parseScenesAndShots } from "../src/lib/director/parse";
import { CHARACTER_FIELDS, formatFields, parseFields, SCENE_FIELDS, SHOT_FIELDS } from "../src/lib/director/spec";
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
    expect(parsed.imagePrompt).toBe("22岁东亚女性");
});

test("人物解析：按 --- 分块，读出分级、姓名与字段", () => {
    const raw = [
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
    ].join("\n");

    const characters = parseCharacters(raw);
    expect(characters).toHaveLength(2);
    expect(characters[0].name).toBe("林小满");
    expect(characters[0].tier).toBe("main");
    expect(characters[1].tier).toBe("support");
    expect(characters[0].values.identity).toBe("便利店夜班店员；大三学生");
});

test("人物解析：代码块围栏和空块都能吃下", () => {
    const raw = "```\n姓名：陈默\n分级：主角\n身份：建筑师\n---\n\n```";
    const characters = parseCharacters(raw);
    expect(characters).toHaveLength(1);
    expect(characters[0].name).toBe("陈默");
});

const sceneShotOutput = [
    "=== 场景",
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
    "出场人物：林小满、陈默",
    "生图提示词：雨夜便利店门口外景，青蓝冷调",
    "",
    "--- 分镜",
    "时长：约 4 秒",
    "景别：全景",
    "机位高度：平视略高",
    "机位角度：过肩",
    "运镜：固定",
    "构图：人物居右下",
    "画面：小满背对镜头锁门，针织衫被雨打湿",
    "情绪：疲惫",
    "台词：无",
    "旁白：无",
    "音效：雨声、卷帘门金属声",
    "配乐：低频钢琴",
    "节奏：慢",
    "转场：硬切",
    "生图提示词：雨夜街道全景，玻璃门透出白光",
    "",
    "--- 分镜",
    "时长：约 3 秒",
    "景别：中景",
    "画面：她回头，伞尖在滴水",
    "台词：林小满：你还是来了。",
    "生图提示词：中景，雨夜街道",
    "",
    "=== 场景",
    "场景名：街角屋檐下",
    "地点：便利店斜对面",
    "出场人物：林小满",
    "生图提示词：雨夜街角屋檐",
    "--- 分镜",
    "景别：近景",
    "画面：两人并肩站在屋檐下",
    "生图提示词：近景，雨夜屋檐",
].join("\n");

test("场景分镜解析：=== 分场景、--- 分镜，并读出出场人物", () => {
    const scenes = parseScenesAndShots(sceneShotOutput);
    expect(scenes).toHaveLength(2);

    expect(scenes[0].values.name).toBe("便利店门口");
    expect(scenes[0].characterNames).toEqual(["林小满", "陈默"]);
    expect(scenes[0].look).toBe("日常");
    expect(scenes[0].shots).toHaveLength(2);
    expect(scenes[0].shots[0].values.shotSize).toBe("全景");
    expect(scenes[0].shots[1].values.dialogue).toBe("林小满：你还是来了。");

    // 「出场人物」不进正文，避免用户手改文字时和 id 列表打架
    expect(scenes[0].values.characters).toBeUndefined();
    expect(scenes[1].characterNames).toEqual(["林小满"]);
});

test("场景分镜解析：没有画面的空块会被丢掉", () => {
    const raw = ["=== 场景", "场景名：空场", "出场人物：无", "--- 分镜", "台词：无"].join("\n");
    const scenes = parseScenesAndShots(raw);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].shots).toHaveLength(0);
});

test("人物布局：主角排在前面，节点类型与元信息正确", () => {
    const { ops } = buildCharacterPlan({
        directorNodeId: "director-1",
        origin: { x: 100, y: 200 },
        characters: [
            { tier: "support", name: "苏晴", values: { name: "苏晴", imagePrompt: "x" } },
            { tier: "main", name: "林小满", values: { name: "林小满", imagePrompt: "y" } },
        ],
    });

    expect(ops).toHaveLength(2);
    const [first, second] = ops;
    expect(first.type).toBe("add_node");
    if (first.type !== "add_node" || second.type !== "add_node") throw new Error("类型不对");
    expect(first.nodeType).toBe(DIRECTOR_CHARACTER_TYPE);
    expect(first.title).toBe("林小满"); // 主角在前
    expect(first.x).toBe(100);
    expect(first.y).toBe(200);
    expect(second.x).toBe(100 + DIRECTOR_LAYOUT.charWidth + DIRECTOR_LAYOUT.charGapX);
    expect(first.metadata?.directorMeta).toMatchObject({ kind: "character", tier: "main", directorNodeId: "director-1" });
});

test("场景分镜布局：章节分块、场景行、分镜横排、组包住分镜、连线齐全", () => {
    const scenes = parseScenesAndShots(sceneShotOutput);
    const { ops, sceneNodeIds, shotNodeIds, shotsByScene } = buildSceneShotPlan({
        directorNodeId: "director-1",
        origin: { x: 0, y: 1000 },
        characterLookup: new Map([
            ["林小满", "char-1"],
            ["陈默", "char-2"],
        ]),
        chapters: [
            { title: "第一章 雨夜重逢", text: "原文一", scenes: [scenes[0]] },
            { title: "第二章 旧信", text: "原文二", scenes: [scenes[1]] },
        ],
    });

    const added = ops.filter((op) => op.type === "add_node");
    if (added.some((op) => op.type !== "add_node")) throw new Error("类型不对");
    const chapterNodes = added.filter((op) => op.type === "add_node" && op.nodeType === DIRECTOR_CHAPTER_TYPE);
    const sceneNodes = added.filter((op) => op.type === "add_node" && op.nodeType === DIRECTOR_SCENE_TYPE);
    const shotNodes = added.filter((op) => op.type === "add_node" && op.nodeType === CanvasNodeType.Text);
    const groupNodes = added.filter((op) => op.type === "add_node" && op.nodeType === CanvasNodeType.Group);

    expect(chapterNodes).toHaveLength(2);
    expect(sceneNodes).toHaveLength(2);
    expect(shotNodes).toHaveLength(3); // 第一场 2 镜 + 第二场 1 镜
    expect(groupNodes).toHaveLength(2);
    expect(sceneNodeIds).toHaveLength(2);
    expect(shotNodeIds).toHaveLength(3);

    // 第二章的块排在第一章下面
    if (chapterNodes[0].type !== "add_node" || chapterNodes[1].type !== "add_node") throw new Error("类型不对");
    expect(chapterNodes[0].y).toBe(1000);
    expect(chapterNodes[1].y).toBeGreaterThan(1000);

    // 场景在章节右侧
    if (sceneNodes[0].type !== "add_node") throw new Error("类型不对");
    expect(sceneNodes[0].x).toBe(DIRECTOR_LAYOUT.chapterWidth + DIRECTOR_LAYOUT.chapterToSceneGapX);

    // 同一场的两个分镜在同一行、x 递增
    const firstSceneShots = shotNodes.filter((op) => op.type === "add_node" && op.y === 1000);
    expect(firstSceneShots).toHaveLength(2);
    if (firstSceneShots[0].type !== "add_node" || firstSceneShots[1].type !== "add_node") throw new Error("类型不对");
    expect(firstSceneShots[1].x).toBeGreaterThan(firstSceneShots[0].x);

    // 分镜上写了 groupId，侧边栏才能按组展开成树
    const groupAssignments = ops.filter((op) => op.type === "update_node" && op.metadata?.groupId);
    expect(groupAssignments).toHaveLength(3);

    // 连线：人物→场景 3 条（场景1 两人 + 场景2 一人），场景→分镜 3 条
    const connections = ops.filter((op) => op.type === "connect_nodes");
    expect(connections).toHaveLength(6);
    const toScene = connections.filter((op) => op.type === "connect_nodes" && sceneNodeIds.includes(op.toNodeId));
    expect(toScene).toHaveLength(3);
    expect(toScene.filter((op) => op.type === "connect_nodes" && op.fromNodeId === "char-1")).toHaveLength(2);

    // 场景节点上的出场人物存的是人物节点 id
    if (sceneNodes[0].type !== "add_node") throw new Error("类型不对");
    expect(sceneNodes[0].metadata?.directorMeta).toMatchObject({ kind: "scene", characterIds: ["char-1", "char-2"] });

    // 折叠用：场景 → 分镜 的映射
    expect(shotsByScene[sceneNodeIds[0]]).toHaveLength(2);
    expect(shotsByScene[sceneNodeIds[1]]).toHaveLength(1);
});

test("场景分镜布局：章节节点高度包住本章所有场景行", () => {
    const scenes = parseScenesAndShots(sceneShotOutput);
    const { ops } = buildSceneShotPlan({
        directorNodeId: "d",
        origin: { x: 0, y: 0 },
        characterLookup: new Map(),
        chapters: [{ title: "章", text: "", scenes: [scenes[0], scenes[1]] }],
    });
    const chapter = ops.find((op) => op.type === "add_node" && op.nodeType === DIRECTOR_CHAPTER_TYPE);
    if (!chapter || chapter.type !== "add_node") throw new Error("没找到章节节点");
    const expected = 2 * (DIRECTOR_LAYOUT.sceneHeight + DIRECTOR_LAYOUT.sceneGapY) - DIRECTOR_LAYOUT.sceneGapY;
    expect(chapter.height).toBe(expected);
});

test("场景字段规格里不含「出场人物」，它由 id 动态渲染", () => {
    expect(SCENE_FIELDS.some((field) => field.label === "出场人物")).toBe(false);
    expect(SHOT_FIELDS).toHaveLength(16);
    expect(CHARACTER_FIELDS).toHaveLength(14);
});
