/**
 * 导演台节点布局。
 *
 * 工作台（四步卡片页）不显示画布，所以这里的坐标只影响「画布编辑」视图 ——
 * 摆得整齐、不重叠就行，不再为生成结果预留大块空间。
 *
 *   [角色1][角色2][角色3] …          ← 角色库
 *   [物品1][物品2] …                 ← 重要物品
 *   [场次1]  [镜1-1][镜1-2][镜1-3]   ← 场次行：场次节点 + 该场分镜横排
 *   [场次2]  [镜2-1][镜2-2]
 *
 * 所有坐标都是画布世界坐标，且都是节点左上角（与 CanvasAgentOp 的 x/y 语义一致）。
 * 关系线（角色 → 场次、场次 → 分镜）保留，画布编辑里能一眼看出结构；
 * 但生成不再依赖它们 —— 工作台按节点上的关联列表取参考图（见 associate.ts）。
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
/** @deprecated 旧数据的章节节点类型。改成场次主轴后不再新建，仅用于兼容读取与清理。 */
export const DIRECTOR_CHAPTER_TYPE = "sqc:chapter";

/** 主体节点与生成配置节点之间的间距（生成结果的落点仍按这个算）。 */
export const GENERATED_STACK_GAP = 96;

export const DIRECTOR_LAYOUT = {
    charWidth: 240,
    charHeight: 170,
    propWidth: 240,
    propHeight: 160,
    sceneWidth: 260,
    sceneHeight: 190,
    shotWidth: 340,
    shotHeight: 240,

    /** 同一行里相邻框的水平间距 */
    cellGapX: 110,
    /** 各区块之间再留的垂直间距 */
    rowGapY: 90,
    /** 场次节点到分镜组的水平间距 */
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
    sceneNodeIds: string[];
    shotNodeIds: string[];
    /** 场景节点 id -> 该场分镜节点 id 列表。 */
    shotsByScene: Record<string, string[]>;
};

function emptyPlan(): DirectorPlan {
    return { ops: [], characterNodeIds: [], propNodeIds: [], sceneNodeIds: [], shotNodeIds: [], shotsByScene: {} };
}

/** 人物行铺在导演台节点正下方。 */
export function assetOrigin(node: { position: { x: number; y: number }; height: number }): DirectorOrigin {
    return { x: node.position.x, y: node.position.y + node.height + DIRECTOR_LAYOUT.rowGapY };
}

/** 合并后的三类资产 + 每段（小说=章 / 剧本=场）的归属。 */
export type AssetSegment = { title: string; text: string; scenes: ParsedScene[] };
export type AssetBundle = { characters: ParsedCharacter[]; props: ParsedProp[]; segments: AssetSegment[] };

/** 第一步产物：角色区 + 物品区 + 场次列 + 关系线。 */
export function buildAssetPlan(options: { directorNodeId: string; bundle: AssetBundle; origin: DirectorOrigin }): DirectorPlan {
    const { directorNodeId, bundle, origin } = options;
    const plan = emptyPlan();
    const L = DIRECTOR_LAYOUT;

    // ── 角色区：主角排前面 ──
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
    const propTop = origin.y + L.charHeight + L.rowGapY;
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

    // ── 场次列：一场一行，按剧情顺序往下排 ──
    let sceneOrder = 0;
    let rowY = propTop + L.propHeight + L.rowGapY;

    bundle.segments.forEach((segment) => {
        segment.scenes.forEach((scene) => {
            sceneOrder += 1;
            const sceneNodeId = newDirectorId("sceneNode");
            plan.sceneNodeIds.push(sceneNodeId);

            // 出场人物 / 出现物品名 → 节点 id；匹配不上的丢掉，一致性自检会报出来
            const characterIds = scene.characterNames.map((name) => characterNodeIdByName.get(name)).filter((id): id is string => Boolean(id));
            const propIds = scene.propNames.map((name) => propNodeIdByName.get(name)).filter((id): id is string => Boolean(id));

            const values: Record<string, string> = { ...scene.values, code: `场次${sceneOrder}` };
            plan.ops.push({
                type: "add_node",
                id: sceneNodeId,
                nodeType: DIRECTOR_SCENE_TYPE,
                title: values.name || `场次${sceneOrder}`,
                x: origin.x,
                y: rowY,
                width: L.sceneWidth,
                height: L.sceneHeight,
                metadata: {
                    content: formatFields(SCENE_FIELDS, values),
                    status: "success",
                    fontSize: 12,
                    directorMeta: {
                        kind: "scene",
                        directorNodeId,
                        sceneId: newDirectorId("scene"),
                        order: sceneOrder,
                        // 「章」降级成场次上的分组属性，同时把该段正文存下来供重新拆分镜
                        chapterTitle: segment.title,
                        script: segment.text,
                        characterIds,
                        propIds,
                    },
                },
            });
            characterIds.forEach((characterNodeId) => plan.ops.push({ type: "connect_nodes", fromNodeId: characterNodeId, toNodeId: sceneNodeId }));
            propIds.forEach((propNodeId) => plan.ops.push({ type: "connect_nodes", fromNodeId: propNodeId, toNodeId: sceneNodeId }));

            plan.shotsByScene[sceneNodeId] = [];
            rowY += L.sceneHeight + L.rowGapY;
        });
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
