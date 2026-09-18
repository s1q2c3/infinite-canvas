/**
 * 导演台布局：人物顶栏 + 章节分块 + 场景行 + 分镜横排。
 *
 * 所有坐标都是画布世界坐标，且都是节点左上角（与 CanvasAgentOp 的 x/y 语义一致）。
 *
 *   [人物1][人物2][人物3] …                    ← 角色库（顶部一行）
 *
 *   [第1章]   [场景1]  ┌组·场景1 的分镜───────┐
 *             [场景2]  │ [镜1-1][镜1-2][镜1-3] │
 *                      └────────────────────┘
 *   [第2章]   [场景3]  ┌组·场景3 的分镜┐
 *                      │ [镜3-1][镜3-2]  │
 *                      └────────────────┘
 */

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { ParsedCharacter, ParsedScene } from "@/lib/director/parse";
import { CHARACTER_FIELDS, formatFields, SCENE_FIELDS, SHOT_FIELDS } from "@/lib/director/spec";
import { CanvasNodeType } from "@/types/canvas";

/** 导演台相关节点类型（都走 node-registry 的插件渲染路径）。 */
export const DIRECTOR_NODE_TYPE = "sqc:director";
export const DIRECTOR_CHARACTER_TYPE = "sqc:character";
export const DIRECTOR_SCENE_TYPE = "sqc:scene";
export const DIRECTOR_CHAPTER_TYPE = "sqc:chapter";

export const DIRECTOR_LAYOUT = {
    /** 人物行 */
    charWidth: 240,
    charHeight: 170,
    charGapX: 36,

    /** 人物行到章节块的垂直间距 */
    charToContentGapY: 130,

    /** 章节节点 */
    chapterWidth: 220,
    chapterHeight: 160,
    chapterToSceneGapX: 48,

    /** 场景节点 */
    sceneWidth: 260,
    sceneHeight: 190,
    sceneGapY: 44,
    sceneToGroupGapX: 48,

    /** 分镜 */
    shotWidth: 340,
    shotHeight: 240,
    shotGapX: 32,

    /** 组节点包住分镜时四周留的边距 */
    groupPadding: 26,

    /** 章节块之间的垂直间距 */
    chapterBlockGapY: 96,
};

export function newDirectorId(prefix: string) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export type DirectorOrigin = { x: number; y: number };

export type DirectorPlan = {
    ops: CanvasAgentOp[];
    characterNodeIds: string[];
    chapterNodeIds: string[];
    sceneNodeIds: string[];
    shotNodeIds: string[];
    /** 场景节点 id -> 该场分镜节点 id 列表（折叠用）。 */
    shotsByScene: Record<string, string[]>;
    /** 章节节点 id -> 该章场景节点 id 列表（折叠用）。 */
    scenesByChapter: Record<string, string[]>;
};

function emptyPlan(): DirectorPlan {
    return { ops: [], characterNodeIds: [], chapterNodeIds: [], sceneNodeIds: [], shotNodeIds: [], shotsByScene: {}, scenesByChapter: {} };
}

/** 人物顶栏占用的高度。 */
export function characterRowHeight() {
    return DIRECTOR_LAYOUT.charHeight;
}

/**
 * 第一步产物：把人物铺到顶部一行。主角排在前面，配角跟在后面。
 */
export function buildCharacterPlan(options: { directorNodeId: string; characters: ParsedCharacter[]; origin: DirectorOrigin }): DirectorPlan {
    const { directorNodeId, characters, origin } = options;
    const plan = emptyPlan();
    const ordered = [...characters].sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "main" ? -1 : 1));

    ordered.forEach((character, index) => {
        const nodeId = newDirectorId("charNode");
        plan.characterNodeIds.push(nodeId);
        plan.ops.push({
            type: "add_node",
            id: nodeId,
            nodeType: DIRECTOR_CHARACTER_TYPE,
            title: character.name,
            x: origin.x + index * (DIRECTOR_LAYOUT.charWidth + DIRECTOR_LAYOUT.charGapX),
            y: origin.y,
            width: DIRECTOR_LAYOUT.charWidth,
            height: DIRECTOR_LAYOUT.charHeight,
            metadata: {
                content: formatFields(CHARACTER_FIELDS, character.values),
                status: "success",
                fontSize: 12,
                directorMeta: { kind: "character", directorNodeId, characterId: newDirectorId("char"), tier: character.tier },
            },
        });
    });

    return plan;
}

export type ChapterPlanInput = {
    title: string;
    text: string;
    scenes: ParsedScene[];
};

/** 「人物姓名 → 人物节点 id」的映射，由调用方给出。 */
export type CharacterLookup = Map<string, string>;

/**
 * 第二步产物：章节 / 场景 / 分镜 + 组 + 连线。
 * origin 通常是人物行下方；调用方负责先删掉上一轮的章节 / 场景 / 分镜 / 组。
 */
export function buildSceneShotPlan(options: {
    directorNodeId: string;
    chapters: ChapterPlanInput[];
    characterLookup: CharacterLookup;
    origin: DirectorOrigin;
}): DirectorPlan {
    const { directorNodeId, chapters, characterLookup, origin } = options;
    const plan = emptyPlan();
    const L = DIRECTOR_LAYOUT;

    let blockY = origin.y;
    let sceneOrder = 0;

    chapters.forEach((chapter, chapterIndex) => {
        const chapterNodeId = newDirectorId("chapterNode");
        plan.chapterNodeIds.push(chapterNodeId);
        plan.scenesByChapter[chapterNodeId] = [];

        // 章节节点先占位，算完该章场景后回填高度（要包住所有场景行）
        const chapterOpIndex = plan.ops.length;
        plan.ops.push({
            type: "add_node",
            id: chapterNodeId,
            nodeType: DIRECTOR_CHAPTER_TYPE,
            title: chapter.title,
            x: origin.x,
            y: blockY,
            width: L.chapterWidth,
            height: L.chapterHeight,
            metadata: {
                content: chapter.title,
                status: "success",
                directorMeta: { kind: "chapter", directorNodeId, chapterId: newDirectorId("chapter"), order: chapterIndex + 1, chapterText: chapter.text },
            },
        });

        let rowY = blockY;
        chapter.scenes.forEach((scene) => {
            sceneOrder += 1;
            const sceneNodeId = newDirectorId("sceneNode");
            plan.sceneNodeIds.push(sceneNodeId);
            plan.scenesByChapter[chapterNodeId].push(sceneNodeId);

            // 出场人物名 → 人物节点 id；匹配不上的丢掉，一致性自检会报出来
            const characterIds = scene.characterNames.map((name) => characterLookup.get(name)).filter((id): id is string => Boolean(id));

            const values: Record<string, string> = { ...scene.values, code: `第${chapterIndex + 1}章 · 场景${sceneOrder}` };
            const sceneX = origin.x + L.chapterWidth + L.chapterToSceneGapX;
            plan.ops.push({
                type: "add_node",
                id: sceneNodeId,
                nodeType: DIRECTOR_SCENE_TYPE,
                title: values.name || `场景${sceneOrder}`,
                x: sceneX,
                y: rowY,
                width: L.sceneWidth,
                height: L.sceneHeight,
                metadata: {
                    content: formatFields(SCENE_FIELDS, values),
                    status: "success",
                    fontSize: 12,
                    directorMeta: { kind: "scene", directorNodeId, sceneId: newDirectorId("scene"), order: sceneOrder, chapterNodeId, characterIds },
                },
            });
            characterIds.forEach((characterNodeId) => {
                plan.ops.push({ type: "connect_nodes", fromNodeId: characterNodeId, toNodeId: sceneNodeId });
            });

            if (!scene.shots.length) {
                plan.shotsByScene[sceneNodeId] = [];
                rowY += L.sceneHeight + L.sceneGapY;
                return;
            }

            const groupNodeId = newDirectorId("groupNode");
            const shotsX = sceneX + L.sceneWidth + L.sceneToGroupGapX;
            const shotNodeIds: string[] = [];

            scene.shots.forEach((shot, shotIndex) => {
                const shotNodeId = newDirectorId("shotNode");
                shotNodeIds.push(shotNodeId);
                plan.shotNodeIds.push(shotNodeId);
                const shotValues: Record<string, string> = { ...shot.values, code: `${sceneOrder}-${shotIndex + 1}` };
                plan.ops.push({
                    type: "add_node",
                    id: shotNodeId,
                    nodeType: CanvasNodeType.Text,
                    title: `镜 ${shotValues.code}`,
                    x: shotsX + shotIndex * (L.shotWidth + L.shotGapX),
                    y: rowY,
                    width: L.shotWidth,
                    height: L.shotHeight,
                    metadata: {
                        content: formatFields(SHOT_FIELDS, shotValues),
                        status: "success",
                        fontSize: 12,
                        directorMeta: { kind: "shot", directorNodeId, shotId: newDirectorId("shot"), sceneNodeId, index: shotIndex + 1 },
                    },
                });
                plan.ops.push({ type: "connect_nodes", fromNodeId: sceneNodeId, toNodeId: shotNodeId });
            });

            plan.shotsByScene[sceneNodeId] = shotNodeIds;

            // 组节点包住该场分镜：侧边栏会按组展开成树，也能整体拖动
            plan.ops.push({
                type: "add_node",
                id: groupNodeId,
                nodeType: CanvasNodeType.Group,
                title: `场景${sceneOrder} 的分镜`,
                x: shotsX - L.groupPadding,
                y: rowY - L.groupPadding,
                width: scene.shots.length * L.shotWidth + (scene.shots.length - 1) * L.shotGapX + L.groupPadding * 2,
                height: L.shotHeight + L.groupPadding * 2,
                metadata: { status: "idle", directorMeta: { kind: "group", directorNodeId } },
            });
            shotNodeIds.forEach((shotNodeId) => {
                plan.ops.push({ type: "update_node", id: shotNodeId, metadata: { groupId: groupNodeId } });
            });

            rowY += L.sceneHeight + L.sceneGapY;
        });

        const scenesHeight = chapter.scenes.length ? chapter.scenes.length * (L.sceneHeight + L.sceneGapY) - L.sceneGapY : L.chapterHeight;
        const blockHeight = Math.max(L.chapterHeight, scenesHeight);
        const chapterOp = plan.ops[chapterOpIndex];
        if (chapterOp.type === "add_node") plan.ops[chapterOpIndex] = { ...chapterOp, height: blockHeight };
        blockY += blockHeight + L.chapterBlockGapY;
    });

    return plan;
}
