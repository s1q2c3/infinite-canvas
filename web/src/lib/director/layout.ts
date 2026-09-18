/**
 * 导演台布局：章节分行、行内横排（画布世界坐标，x/y 均为节点左上角）。
 *
 *   [章节标题] [镜1] [镜2] [镜3] …
 *   [章节标题] [镜1] [镜2] …
 */

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { DirectorChapter } from "@/types/canvas";

/** 章节标题节点类型（注册在 node-registry 里，走插件渲染路径）。 */
export const DIRECTOR_CHAPTER_TYPE = "sqc:chapter";
/** 导演台节点类型。 */
export const DIRECTOR_NODE_TYPE = "sqc:director";
/** 镜头用内置文本节点，双击即可改字，也能直接连生成配置节点。 */
export const DIRECTOR_SHOT_TYPE = "text";

export const DIRECTOR_LAYOUT = {
    originX: 0,
    originY: 0,
    /** 章节行之间的垂直间距。 */
    rowGapY: 300,
    labelWidth: 240,
    labelHeight: 200,
    shotWidth: 320,
    shotHeight: 200,
    gapX: 40,
    labelGapX: 40,
};

export function newDirectorId(prefix: string) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export type DeployedChapter = { chapterId: string; chapterNodeId: string; shotNodeIds: string[] };

export type DeployStart = { row?: number; originX?: number; originY?: number };

/**
 * 为若干章节生成「建节点 + 连线」指令。
 *
 * row 用于接着已有行往下排；originX / originY 是整块内容的起点，通常取导演台节点正下方，
 * 避免和画布上已有节点叠在一起。
 */
export function buildChapterOps(chapters: DirectorChapter[], directorNodeId: string, start: DeployStart = {}): { ops: CanvasAgentOp[]; deployed: DeployedChapter[] } {
    const ops: CanvasAgentOp[] = [];
    const deployed: DeployedChapter[] = [];
    const originX = start.originX ?? DIRECTOR_LAYOUT.originX;
    const originY = start.originY ?? DIRECTOR_LAYOUT.originY;
    const startRow = start.row ?? 0;
    const rowY = (index: number) => originY + index * DIRECTOR_LAYOUT.rowGapY;
    const shotX = (index: number) => originX + DIRECTOR_LAYOUT.labelWidth + DIRECTOR_LAYOUT.labelGapX + index * (DIRECTOR_LAYOUT.shotWidth + DIRECTOR_LAYOUT.gapX);

    chapters.forEach((chapter, offset) => {
        const row = startRow + offset;
        const y = rowY(row);
        const chapterNodeId = chapter.nodeId || newDirectorId("chapter");
        ops.push({
            type: "add_node",
            id: chapterNodeId,
            nodeType: DIRECTOR_CHAPTER_TYPE,
            title: chapter.title,
            x: originX,
            y,
            width: DIRECTOR_LAYOUT.labelWidth,
            height: DIRECTOR_LAYOUT.labelHeight,
            metadata: {
                content: chapter.title,
                status: "success",
                directorNodeId,
                chapterOrder: chapter.order,
            },
        });

        const shotNodeIds: string[] = [];
        chapter.shots.forEach((shot, shotIndex) => {
            const shotNodeId = shot.nodeId || newDirectorId("shot");
            shotNodeIds.push(shotNodeId);
            ops.push({
                type: "add_node",
                id: shotNodeId,
                nodeType: DIRECTOR_SHOT_TYPE,
                title: `镜 ${shot.index}`,
                x: shotX(shotIndex),
                y,
                width: DIRECTOR_LAYOUT.shotWidth,
                height: DIRECTOR_LAYOUT.shotHeight,
                metadata: { content: shot.content, status: "success", fontSize: 13, chapterNodeId },
            });
            ops.push({ type: "connect_nodes", fromNodeId: chapterNodeId, toNodeId: shotNodeId });
        });

        deployed.push({ chapterId: chapter.id, chapterNodeId, shotNodeIds });
    });

    return { ops, deployed };
}
