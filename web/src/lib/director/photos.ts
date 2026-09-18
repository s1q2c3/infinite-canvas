/**
 * 照片查找：在画布图上找出某个人物 / 场景 / 分镜已经生成出来的图片节点。
 *
 * 生成链路是「主体节点 → 生成配置节点 → 图片节点」，所以这里按两跳找。
 * 之所以不依赖标记：图片节点是内置生成流程创建的，我们没法给它打标；
 * 但配置节点是我们自己建的，可以带上造型标签（metadata.directorPhoto）。
 */

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type DirectorPhotoMeta } from "@/types/canvas";

export type PhotoHit = {
    image: CanvasNodeData;
    /** 造型标签；由创建配置节点时写入。 */
    look?: string;
    /** 生成配置节点 id。 */
    configNodeId?: string;
};

function downstream(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return connections
        .filter((connection) => connection.fromNodeId === nodeId)
        .map((connection) => byId.get(connection.toNodeId))
        .filter((node): node is CanvasNodeData => Boolean(node));
}

export function readPhotoMeta(node: CanvasNodeData): DirectorPhotoMeta | null {
    return (node.metadata?.directorPhoto as DirectorPhotoMeta | undefined) || null;
}

/**
 * 找某个主体（人物 / 场景 / 分镜）已经生成出来的图片。
 * 走「主体 → 配置 → 图片」两跳，也兼容主体直接连图片的情况。
 */
export function findDownstreamImages(ownerNodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): PhotoHit[] {
    const hits: PhotoHit[] = [];
    const seen = new Set<string>();

    const push = (image: CanvasNodeData, configNodeId?: string, look?: string) => {
        if (seen.has(image.id)) return;
        seen.add(image.id);
        hits.push({ image, configNodeId, look });
    };

    for (const child of downstream(ownerNodeId, nodes, connections)) {
        if (child.type === CanvasNodeType.Image) {
            push(child);
            continue;
        }
        if (child.type !== CanvasNodeType.Config) continue;
        const meta = readPhotoMeta(child);
        for (const grand of downstream(child.id, nodes, connections)) {
            if (grand.type === CanvasNodeType.Image) push(grand, child.id, meta?.look);
        }
    }

    return hits;
}

/** 按造型标签挑一张：优先精确匹配，其次没有标签的，最后随便一张。 */
export function pickPhotoByLook(hits: PhotoHit[], look?: string): PhotoHit | null {
    if (!hits.length) return null;
    const wanted = (look || "").trim();
    if (wanted && wanted !== "默认" && wanted !== "无") {
        const exact = hits.find((hit) => (hit.look || "").trim() === wanted);
        if (exact) return exact;
    }
    return hits.find((hit) => !hit.look) || hits[0];
}
