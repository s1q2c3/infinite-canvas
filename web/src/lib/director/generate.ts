/**
 * 工作台的生成封装。
 *
 * 生成结果仍然落在画布上（「配置节点 → 图片 / 视频节点」），这样切到「画布编辑」
 * 能看到同一批产物；工作台的卡片只是去读这些节点上已经生成好的图。
 *
 * 参考图来自关联素材（associate.ts），不再依赖画布连线。
 */

import { newDirectorId } from "@/lib/director/layout";
import { uploadImage } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeImage } from "@/types/canvas";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasPluginAi } from "@/types/canvas-plugin";

export type AssetKind = "character" | "scene" | "prop";

const CONFIG_SIZE = { width: 320, height: 240 };
const MEDIA_SIZE = { width: 320, height: 320 };
const GAP = 96;

/** 生成链落点：配置节点在主体右侧，媒体节点在配置节点下方。 */
function layoutFor(owner: CanvasNodeData, index = 0) {
    const x = owner.position.x + owner.width + GAP;
    const y = owner.position.y + index * (CONFIG_SIZE.height + MEDIA_SIZE.height + GAP * 2);
    return { config: { x, y }, media: { x, y: y + CONFIG_SIZE.height + GAP } };
}

/** 给资产节点（角色 / 场次 / 物品）生成形象图。 */
export async function generateAssetPhoto(options: {
    ai: CanvasPluginAi;
    owner: CanvasNodeData;
    kind: AssetKind;
    prompt: string;
    look?: string;
    references?: string[];
    signal?: AbortSignal;
}): Promise<CanvasAgentOp[] | null> {
    const { ai, owner, kind, prompt, look, references, signal } = options;
    const result = await ai.generateImage(prompt, { references, signal });
    const dataUrl = result.images[0];
    if (!dataUrl) return null;
    const uploaded = await uploadImage(dataUrl, { signal });
    const spot = layoutFor(owner);

    const configId = newDirectorId("photoConfig");
    const imageId = newDirectorId("photoImage");
    const image: CanvasNodeImage = {
        id: imageId,
        status: "success",
        content: uploaded.url,
        storageKey: uploaded.storageKey,
        naturalWidth: uploaded.width,
        naturalHeight: uploaded.height,
        bytes: uploaded.bytes,
        mimeType: uploaded.mimeType,
    };

    return [
        {
            type: "add_node",
            id: configId,
            nodeType: CanvasNodeType.Config,
            title: `${owner.title} · ${kind === "character" ? "形象图" : kind === "scene" ? "场景图" : "物品图"}`,
            x: spot.config.x,
            y: spot.config.y,
            width: CONFIG_SIZE.width,
            height: CONFIG_SIZE.height,
            metadata: { prompt, generationMode: "image", status: "success", directorPhoto: { ownerId: owner.id, kind, look } },
        },
        {
            type: "add_node",
            id: imageId,
            nodeType: CanvasNodeType.Image,
            title: owner.title || "形象图",
            x: spot.media.x,
            y: spot.media.y,
            width: MEDIA_SIZE.width,
            height: MEDIA_SIZE.height,
            metadata: { prompt, status: "success", images: [image], primaryImageId: imageId },
        },
        { type: "connect_nodes", fromNodeId: owner.id, toNodeId: configId },
        { type: "connect_nodes", fromNodeId: configId, toNodeId: imageId },
    ];
}

/** 给分镜节点生成画面（图）或视频。 */
export async function generateShotMedia(options: {
    ai: CanvasPluginAi;
    shot: CanvasNodeData;
    mode: "image" | "video";
    prompt: string;
    references?: string[];
    seconds?: string;
    signal?: AbortSignal;
}): Promise<CanvasAgentOp[] | null> {
    const { ai, shot, mode, prompt, references, seconds, signal } = options;
    const spot = layoutFor(shot);

    if (mode === "video") {
        const file = await ai.generateVideo(prompt, { references, seconds, signal });
        if (!file?.url) return null;
        const configId = newDirectorId("shotConfig");
        const videoId = newDirectorId("shotVideo");
        return [
            {
                type: "add_node",
                id: configId,
                nodeType: CanvasNodeType.Config,
                title: `${shot.title} · 视频`,
                x: spot.config.x,
                y: spot.config.y,
                width: CONFIG_SIZE.width,
                height: CONFIG_SIZE.height,
                metadata: { prompt, generationMode: "video", status: "success", directorShotConfig: shot.id },
            },
            {
                type: "add_node",
                id: videoId,
                nodeType: CanvasNodeType.Video,
                title: shot.title || "分镜视频",
                x: spot.media.x,
                y: spot.media.y,
                width: MEDIA_SIZE.width,
                height: MEDIA_SIZE.height,
                metadata: { prompt, status: "success", content: file.url, mimeType: file.mimeType, durationMs: file.durationMs, naturalWidth: file.width, naturalHeight: file.height },
            },
            { type: "connect_nodes", fromNodeId: shot.id, toNodeId: configId },
            { type: "connect_nodes", fromNodeId: configId, toNodeId: videoId },
        ];
    }

    const result = await ai.generateImage(prompt, { references, signal });
    const dataUrl = result.images[0];
    if (!dataUrl) return null;
    const uploaded = await uploadImage(dataUrl, { signal });
    const configId = newDirectorId("shotConfig");
    const imageId = newDirectorId("shotImage");
    const image: CanvasNodeImage = {
        id: imageId,
        status: "success",
        content: uploaded.url,
        storageKey: uploaded.storageKey,
        naturalWidth: uploaded.width,
        naturalHeight: uploaded.height,
        bytes: uploaded.bytes,
        mimeType: uploaded.mimeType,
    };
    return [
        {
            type: "add_node",
            id: configId,
            nodeType: CanvasNodeType.Config,
            title: `${shot.title} · 分镜图`,
            x: spot.config.x,
            y: spot.config.y,
            width: CONFIG_SIZE.width,
            height: CONFIG_SIZE.height,
            metadata: { prompt, generationMode: "image", status: "success", directorShotConfig: shot.id },
        },
        {
            type: "add_node",
            id: imageId,
            nodeType: CanvasNodeType.Image,
            title: shot.title || "分镜图",
            x: spot.media.x,
            y: spot.media.y,
            width: MEDIA_SIZE.width,
            height: MEDIA_SIZE.height,
            metadata: { prompt, status: "success", images: [image], primaryImageId: imageId },
        },
        { type: "connect_nodes", fromNodeId: shot.id, toNodeId: configId },
        { type: "connect_nodes", fromNodeId: configId, toNodeId: imageId },
    ];
}
