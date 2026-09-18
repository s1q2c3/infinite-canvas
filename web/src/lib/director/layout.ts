/**
 * 导演台布局：人物区 + 物品区 + 章节分块（场景行 + 分镜横排）。
 *
 * 所有坐标都是画布世界坐标，且都是节点左上角（与 CanvasAgentOp 的 x/y 语义一致）。
 *
 *   [人物1][人物2][人物3] …                    ← 角色库
 *   （每个框正下方预留：配置节点 + 图片/视频节点）
 *
 *   [物品1][物品2] …                           ← 重要物品
 *   （同样预留生成空间）
 *
 *   [第1章]   [场景1]  ┌组·场景1 的分镜───────┐
 *             [场景2]  │ [镜1-1][镜1-2][镜1-3] │
 *                      └────────────────────┘
 *
 * 为什么每个框下面要留一大块：每个框都要生成对应的图或视频，而生成链路是
 * 「框 → 生成配置节点 → 图片/视频节点」三级。把这条链竖着放在框正下方，
 * 一行里的框才能保持成一条横线、一眼看全；横着排会把一行撑成上万像素宽。
 */

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { ParsedCharacter, ParsedProp, ParsedScene, ParsedShot } from "@/lib/director/parse";
import { CHARACTER_FIELDS, formatFields, PROP_FIELDS, readShotOutputKind, SCENE_FIELDS, SHOT_FIELDS, shotOutputLabel } from "@/lib/director/spec";
import { CanvasNodeType } from "@/types/canvas";

/** 导演台相关节点类型（都走 node-registry 的插件渲染路径）。 */
export const DIRECTOR_NODE_TYPE = "sqc:director";
export const DIRECTOR_CHARACTER_TYPE = "sqc:character";
export const DIRECTOR_SCENE_TYPE = "sqc:scene";
export const DIRECTOR_PROP_TYPE = "sqc:prop";
export const DIRECTOR_CHAPTER_TYPE = "sqc:chapter";

/** 生成配置节点 / 图片视频节点的默认高度（与内置 NODE_SPECS 一致），用来算预留高度。 */
const GENERATED_CONFIG_HEIGHT = 240;
const GENERATED_MEDIA_HEIGHT = 240;
/** 框与生成结果之间的间距。 */
export const GENERATED_STACK_GAP = 96;

/**
 * 每个框下方预留的高度：间距 + 配置节点 + 间距 + 图片/视频节点。
 * 必须与核心生成流程里的落点保持一致（见 project.tsx 的 directorStack 分支）。
 */
export const GENERATED_STACK_HEIGHT = GENERATED_STACK_GAP + GENERATED_CONFIG_HEIGHT + GENERATED_STACK_GAP + GENERATED_MEDIA_HEIGHT;

export const DIRECTOR_LAYOUT = {
    charWidth: 240,
    charHeight: 170,
    propWidth: 240,
    propHeight: 160,
    sceneWidth: 260,
    sceneHeight: 190,
    chapterWidth: 220,
    chapterHeight: 160,
    shotWidth: 340,
    shotHeight: 240,

    /** 同一行里相邻框的水平间距 */
    cellGapX: 110,
    /** 各区块之间再留的垂直间距 */
    rowGapY: 90,
    /** 章节块之间的垂直间距 */
    chapterBlockGapY: 90,
    /** 章节节点到场景列的水平间距 */
    chapterToSceneGapX: 60,
    /** 场景节点到分镜组的水平间距 */
    sceneToGroupGapX: 70,
    /** 组节点包住分镜时四周留的边距 */
    groupPadding: 26,
};

export function newDirectorId(prefix: string) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export type DirectorOrigin = { x: number; y: number };

export type DirectorPlan = {
    ops: CanvasAgentOp[];
    characterNodeIds: string[];
    propNodeIds: string[];
    chapterNodeIds: string[];
    sceneNodeIds: string[];
    shotNodeIds: string[];
    /** 场景节点 id -> 该场分镜节点 id 列表（折叠用）。 */
    shotsByScene: Record<string, string[]>;
    /** 章节节点 id -> 该章场景节点 id 列表（折叠用）。 */
    scenesByChapter: Record<string, string[]>;
};

function emptyPlan(): DirectorPlan {
    return { ops: [], characterNodeIds: [], propNodeIds: [], chapterNodeIds: [], sceneNodeIds: [], shotNodeIds: [], shotsByScene: {}, scenesByChapter: {} };
}

/** 人物行占用的高度（含下方生成空间）。 */
export function characterRowHeight() {
    return DIRECTOR_LAYOUT.charHeight + GENERATED_STACK_HEIGHT;
}

/** 物品行占用的高度（含下方生成空间）。 */
export function propRowHeight() {
    return DIRECTOR_LAYOUT.propHeight + GENERATED_STACK_HEIGHT;
}

/** 场景行占用的高度（含下方生成空间）—— 场景本身和它的分镜在同一行，共用这段预留。 */
export function sceneRowHeight() {
    return DIRECTOR_LAYOUT.sceneHeight + GENERATED_STACK_HEIGHT;
}

/** 人物行铺在导演台节点正下方。 */
export function assetOrigin(node: { position: { x: number; y: number }; height: number }): DirectorOrigin {
    return { x: node.position.x, y: node.position.y + node.height + DIRECTOR_LAYOUT.rowGapY };
}

/** 合并后的三类资产 + 按章的归属。 */
export type AssetChapter = { title: string; text: string; scenes: ParsedScene[] };
export type AssetBundle = { characters: ParsedCharacter[]; props: ParsedProp[]; chapters: AssetChapter[] };

/** 第一步产物：人物区 + 物品区 + 章节块（章节节点 + 场景行）+ 连线。 */
export function buildAssetPlan(options: { directorNodeId: string; bundle: AssetBundle; origin: DirectorOrigin }): DirectorPlan {
    const { directorNodeId, bundle, origin } = options;
    const plan = emptyPlan();
    const L = DIRECTOR_LAYOUT;

    // ── 人物区：主角排前面 ──
    const characters = [...bundle.characters].sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "main" ? -1 : 1));
    const characterNodeIdByName = new Map<string, string>();
    characters.forEach((character, index) => {
        const nodeId = newDirectorId("charNode");
        plan.characterNodeIds.push(nodeId);
        characterNodeIdByName.set(character.name, nodeId);
        plan.ops.push({
            type: "add_node",
            id: nodeId,
            nodeType: DIRECTOR_CHARACTER_TYPE,
            title: character.name,
            x: origin.x + index * (L.charWidth + L.cellGapX),
            y: origin.y,
            width: L.charWidth,
            height: L.charHeight,
            metadata: {
                content: formatFields(CHARACTER_FIELDS, character.values),
                status: "success",
                fontSize: 12,
                directorMeta: { kind: "character", directorNodeId, characterId: newDirectorId("char"), tier: character.tier },
            },
        });
    });

    // ── 物品区 ──
    const propTop = origin.y + characterRowHeight() + L.rowGapY;
    const propNodeIdByName = new Map<string, string>();
    bundle.props.forEach((prop, index) => {
        const nodeId = newDirectorId("propNode");
        plan.propNodeIds.push(nodeId);
        propNodeIdByName.set(prop.name, nodeId);
        plan.ops.push({
            type: "add_node",
            id: nodeId,
            nodeType: DIRECTOR_PROP_TYPE,
            title: prop.name,
            x: origin.x + index * (L.propWidth + L.cellGapX),
            y: propTop,
            width: L.propWidth,
            height: L.propHeight,
            metadata: {
                content: formatFields(PROP_FIELDS, prop.values),
                status: "success",
                fontSize: 12,
                directorMeta: { kind: "prop", directorNodeId, propId: newDirectorId("prop") },
            },
        });
    });

    // ── 章节块：章节节点 + 场景行 ──
    let sceneOrder = 0;
    let blockY = propTop + propRowHeight() + L.rowGapY;

    bundle.chapters.forEach((chapter, chapterIndex) => {
        const chapterNodeId = newDirectorId("chapterNode");
        plan.chapterNodeIds.push(chapterNodeId);
        plan.scenesByChapter[chapterNodeId] = [];

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

        const sceneX = origin.x + L.chapterWidth + L.chapterToSceneGapX;
        let rowY = blockY;
        chapter.scenes.forEach((scene) => {
            sceneOrder += 1;
            const sceneNodeId = newDirectorId("sceneNode");
            plan.sceneNodeIds.push(sceneNodeId);
            plan.scenesByChapter[chapterNodeId].push(sceneNodeId);

            // 出场人物 / 出现物品名 → 节点 id；匹配不上的丢掉，一致性自检会报出来
            const characterIds = scene.characterNames.map((name) => characterNodeIdByName.get(name)).filter((id): id is string => Boolean(id));
            const propIds = scene.propNames.map((name) => propNodeIdByName.get(name)).filter((id): id is string => Boolean(id));

            const values: Record<string, string> = { ...scene.values, code: `第${chapterIndex + 1}章 · 场景${sceneOrder}` };
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
                    directorMeta: { kind: "scene", directorNodeId, sceneId: newDirectorId("scene"), order: sceneOrder, chapterNodeId, characterIds, propIds },
                },
            });
            characterIds.forEach((characterNodeId) => plan.ops.push({ type: "connect_nodes", fromNodeId: characterNodeId, toNodeId: sceneNodeId }));
            propIds.forEach((propNodeId) => plan.ops.push({ type: "connect_nodes", fromNodeId: propNodeId, toNodeId: sceneNodeId }));

            plan.shotsByScene[sceneNodeId] = [];
            rowY += sceneRowHeight() + L.rowGapY;
        });

        const scenesHeight = chapter.scenes.length ? chapter.scenes.length * (sceneRowHeight() + L.rowGapY) - L.rowGapY : L.chapterHeight;
        const blockHeight = Math.max(L.chapterHeight, scenesHeight);
        const chapterOp = plan.ops[chapterOpIndex];
        if (chapterOp.type === "add_node") plan.ops[chapterOpIndex] = { ...chapterOp, height: blockHeight };
        blockY += blockHeight + L.chapterBlockGapY;
    });

    return plan;
}

/** 场景节点的几何信息，第二步据此把分镜摆在场景右侧。 */
export type SceneGeometry = { x: number; y: number; width: number; order: number };

/** 一个场景要挂上去的分镜。 */
export type ShotAssignment = { sceneNodeId: string; shots: ParsedShot[] };

/**
 * 第二步产物：把分镜挂到已有场景上（场景节点已在第一步建好）。
 * geometry 是各场景节点的当前位置，由调用方从画布现读。
 */
export function buildShotPlan(options: { directorNodeId: string; assignments: ShotAssignment[]; geometry: Map<string, SceneGeometry> }): DirectorPlan {
    const { directorNodeId, assignments, geometry } = options;
    const plan = emptyPlan();
    const L = DIRECTOR_LAYOUT;

    assignments.forEach((assignment) => {
        const scene = geometry.get(assignment.sceneNodeId);
        if (!scene || !assignment.shots.length) {
            plan.shotsByScene[assignment.sceneNodeId] = [];
            return;
        }

        const groupNodeId = newDirectorId("groupNode");
        const shotsX = scene.x + scene.width + L.sceneToGroupGapX;
        const shotNodeIds: string[] = [];

        assignment.shots.forEach((shot, index) => {
            const shotNodeId = newDirectorId("shotNode");
            shotNodeIds.push(shotNodeId);
            plan.shotNodeIds.push(shotNodeId);

            const kind = readShotOutputKind(formatFields(SHOT_FIELDS, shot.values));
            const values: Record<string, string> = { ...shot.values, code: `${scene.order}-${index + 1}` };
            plan.ops.push({
                type: "add_node",
                id: shotNodeId,
                nodeType: CanvasNodeType.Text,
                // 标题带上生成类型，一眼看出哪些是图、哪些是视频
                title: `镜 ${values.code} · ${shotOutputLabel(kind)}`,
                x: shotsX + index * (L.shotWidth + L.cellGapX),
                y: scene.y,
                width: L.shotWidth,
                height: L.shotHeight,
                metadata: {
                    content: formatFields(SHOT_FIELDS, values),
                    status: "success",
                    fontSize: 12,
                    directorMeta: { kind: "shot", directorNodeId, shotId: newDirectorId("shot"), sceneNodeId: assignment.sceneNodeId, index: index + 1 },
                },
            });
            plan.ops.push({ type: "connect_nodes", fromNodeId: assignment.sceneNodeId, toNodeId: shotNodeId });
        });

        plan.shotsByScene[assignment.sceneNodeId] = shotNodeIds;

        // 组节点包住该场分镜：侧边栏会按组展开成树，也能整体拖动
        plan.ops.push({
            type: "add_node",
            id: groupNodeId,
            nodeType: CanvasNodeType.Group,
            title: `场景${scene.order} 的分镜`,
            x: shotsX - L.groupPadding,
            y: scene.y - L.groupPadding,
            width: assignment.shots.length * L.shotWidth + (assignment.shots.length - 1) * L.cellGapX + L.groupPadding * 2,
            height: L.shotHeight + L.groupPadding * 2,
            metadata: { status: "idle", directorMeta: { kind: "group", directorNodeId } },
        });
        shotNodeIds.forEach((shotNodeId) => {
            plan.ops.push({ type: "update_node", id: shotNodeId, metadata: { groupId: groupNodeId } });
        });
    });

    return plan;
}
