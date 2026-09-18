/**
 * 关联素材：分镜生成时该带哪些设定文本与参考图。
 *
 * 这是「画布连线」的替代品。工作台没有画布，关系改成存在节点上的关联列表：
 *   场次 → 出场人物 / 出现物品（第一步拆解时写进 directorMeta.characterIds / propIds）
 *   镜头 → 默认继承所属场次，也可以在镜头卡上单独调整（directorMeta.assetIds）
 *
 * 好处：不依赖画布拓扑。改人名、换造型、删节点，关联都自动跟着走。
 */

import { readDirectorMeta } from "@/lib/director/meta";
import { findDownstreamImages, pickPhotoByLook } from "@/lib/director/photos";
import { parseFields, SCENE_FIELDS } from "@/lib/director/spec";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

/** 生图时写入生成配置节点的提示词。 */
export const DIRECTOR_SHOT_PROMPT = "根据下面的分镜脚本生成这一镜的画面。保持人物形象与场景环境前后一致。";

/** 生视频时写入生成配置节点的提示词。 */
export const DIRECTOR_SHOT_VIDEO_PROMPT = "根据下面的分镜脚本生成这一镜的视频。以参考图里的角色形象和场景环境为准，保持前后一致。";

export type AssociatedKind = "character" | "scene" | "prop";

export type AssociatedAsset = {
    nodeId: string;
    kind: AssociatedKind;
    name: string;
    /** 设定文本（节点正文）。 */
    text: string;
    /** 已经生成出来的形象图，可能还没有。 */
    imageUrl?: string;
    imageStorageKey?: string;
    /** 生成这张图时用的造型标签。 */
    look?: string;
};

export type ShotAssociation = {
    assets: AssociatedAsset[];
    /** 关联了但还没生成图的素材：生成前要提醒用户。 */
    missingImages: AssociatedAsset[];
    /** 拼好的上游文本，直接交给模型。 */
    context: string;
};

const KIND_LABEL: Record<AssociatedKind, string> = { character: "人物", scene: "场景", prop: "物品" };

function kindOf(node: CanvasNodeData): AssociatedKind | null {
    const meta = readDirectorMeta(node);
    if (!meta) return null;
    if (meta.kind === "character") return "character";
    if (meta.kind === "scene") return "scene";
    if (meta.kind === "prop") return "prop";
    return null;
}

/**
 * 算出一个镜头的关联素材。
 *
 * 镜头自己的 assetIds 优先；没配过就继承所属场次（场景 + 出场人物 + 出现物品），
 * 这样从剧本拆出来的分镜开箱即用，不需要一个个手工绑定。
 */
export function collectShotAssociation(options: {
    shotNodeId: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    /** 生视频时把已经生成好的分镜图也作为参考图带上，一致性比纯文字好得多。 */
    forVideo?: boolean;
}): ShotAssociation {
    const { shotNodeId, nodes, connections, forVideo } = options;
    const byId = new Map(nodes.map((node) => [node.id, node] as const));
    const shot = byId.get(shotNodeId);
    const shotMeta = shot ? readDirectorMeta(shot) : null;
    if (!shot || shotMeta?.kind !== "shot") return { assets: [], missingImages: [], context: "" };

    const scene = byId.get(shotMeta.sceneNodeId);
    const sceneMeta = scene ? readDirectorMeta(scene) : null;

    const ids: string[] = [];
    if (shotMeta.assetIds?.length) {
        ids.push(...shotMeta.assetIds);
    } else if (scene && sceneMeta?.kind === "scene") {
        ids.push(scene.id, ...sceneMeta.characterIds, ...(sceneMeta.propIds || []));
    } else if (scene) {
        ids.push(scene.id);
    }

    // 场景的「本场造型」用来挑人物照片（人物有多套服饰时按它匹配）
    const look = scene ? (parseFields(SCENE_FIELDS, scene.metadata?.content || "").look || "").trim() : "";

    const assets: AssociatedAsset[] = [];
    for (const id of [...new Set(ids)]) {
        const node = byId.get(id);
        if (!node) continue;
        const kind = kindOf(node);
        if (!kind) continue;
        const photo = pickPhotoByLook(findDownstreamImages(node.id, nodes, connections), kind === "character" ? look : undefined);
        const image = photo?.image.metadata?.images?.find((item) => item.status === "success") || photo?.image.metadata?.images?.[0];
        assets.push({
            nodeId: node.id,
            kind,
            name: node.title || "",
            text: node.metadata?.content || "",
            imageUrl: image?.content,
            imageStorageKey: image?.storageKey,
            look: photo?.look,
        });
    }

    // 生视频：带上已生成的分镜图当首帧参考
    if (forVideo) {
        const shotPhoto = pickPhotoByLook(findDownstreamImages(shot.id, nodes, connections));
        const image = shotPhoto?.image.metadata?.images?.find((item) => item.status === "success");
        if (image?.content) {
            assets.push({ nodeId: shot.id, kind: "scene", name: shot.title || "分镜", text: "", imageUrl: image.content, imageStorageKey: image.storageKey });
        }
    }

    const context = assets
        .filter((asset) => asset.text.trim())
        .map((asset) => `${KIND_LABEL[asset.kind]}：${asset.name}\n${asset.text.trim()}`)
        .join("\n\n");

    return { assets, missingImages: assets.filter((asset) => !asset.imageUrl), context };
}
