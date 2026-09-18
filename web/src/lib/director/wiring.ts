/**
 * 分镜生图自动接线。
 *
 * 内置文本节点的「生图」按钮只会把分镜自己连到生成配置节点，而画布的生成输入
 * 只读直接上游一层（见 canvas-resource-references.ts 的 getContextInputNodes），
 * 所以「人物 → 场景 → 分镜」这条链不会自动把人物信息带给分镜。
 *
 * 这里在生成前把该补的上游一次性补齐：
 *   分镜自己 + 所属场景 + 该场出场人物 + 它们的照片（按「本场造型」挑）
 * 这样最终 prompt 里就同时有分镜脚本、场景设定和人物设定，参考图也齐了。
 */

import { readDirectorMeta } from "@/lib/director/meta";
import { findDownstreamImages, pickPhotoByLook } from "@/lib/director/photos";
import { parseFields, SCENE_FIELDS } from "@/lib/director/spec";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

/** 生成配置节点上写入的提示词：告诉模型拿上游这些文本干什么。 */
export const DIRECTOR_SHOT_PROMPT = "根据下面的分镜脚本生成这一镜的画面。保持人物形象与场景环境前后一致。";

/**
 * 给定一个分镜节点，算出它的生成配置节点应该再连上哪些上游节点。
 * 返回的 id 不包含分镜自己（那条线由内置流程负责）。
 */
export function collectShotReferenceNodeIds(shotNodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): string[] {
    const shot = nodes.find((node) => node.id === shotNodeId);
    const shotMeta = shot ? readDirectorMeta(shot) : null;
    if (!shot || shotMeta?.kind !== "shot") return [];

    const scene = nodes.find((node) => node.id === shotMeta.sceneNodeId);
    if (!scene) return [];
    const sceneMeta = readDirectorMeta(scene);
    const look = parseFields(SCENE_FIELDS, scene.metadata?.content || "").look;

    const ids: string[] = [scene.id];

    // 场景照片
    const scenePhoto = pickPhotoByLook(findDownstreamImages(scene.id, nodes, connections));
    if (scenePhoto) ids.push(scenePhoto.image.id);

    if (sceneMeta?.kind !== "scene") return [...new Set(ids)];

    sceneMeta.characterIds.forEach((characterNodeId) => {
        const character = nodes.find((node) => node.id === characterNodeId);
        if (!character) return;
        ids.push(character.id);
        // 人物照片按「本场造型」挑；对不上就用默认那张
        const photo = pickPhotoByLook(findDownstreamImages(character.id, nodes, connections), look);
        if (photo) ids.push(photo.image.id);
    });

    return [...new Set(ids)];
}
