/**
 * 导演台数据归集：把画布上属于某个导演台的节点，整理成结构化的三层数据。
 *
 * 导出、一致性自检、面板统计都用它，避免三处各写一遍遍历逻辑。
 * 结构以画布节点为准（节点文字是唯一真相），所以这里每次都从节点现读。
 */

import { readDirectorMeta } from "@/lib/director/meta";
import { CHARACTER_FIELDS, parseFields, SCENE_FIELDS, SHOT_FIELDS } from "@/lib/director/spec";
import type { CanvasNodeData, DirectorCharacterTier } from "@/types/canvas";

export type CollectedShot = {
    nodeId: string;
    index: number;
    code: string;
    values: Record<string, string>;
    text: string;
    sceneNodeId: string;
};

export type CollectedScene = {
    nodeId: string;
    order: number;
    name: string;
    values: Record<string, string>;
    text: string;
    characterIds: string[];
    characterNames: string[];
    shots: CollectedShot[];
};

export type CollectedChapter = {
    nodeId: string;
    order: number;
    title: string;
    chapterText: string;
    /** 该章是否已折叠（面板里的箭头状态）。 */
    collapsed: boolean;
    scenes: CollectedScene[];
};

export type CollectedCharacter = {
    nodeId: string;
    name: string;
    tier: DirectorCharacterTier;
    values: Record<string, string>;
    text: string;
};

export type DirectorCollection = {
    characters: CollectedCharacter[];
    chapters: CollectedChapter[];
    /** 未归属到任何章节的场景（异常情况，自检会报）。 */
    orphanScenes: CollectedScene[];
    scenes: CollectedScene[];
    shots: CollectedShot[];
};

/** 收集某个导演台节点生成的全部内容。 */
export function collectDirectorData(nodes: CanvasNodeData[], directorNodeId: string): DirectorCollection {
    const owned = nodes.filter((node) => readDirectorMeta(node)?.directorNodeId === directorNodeId);

    const characters: CollectedCharacter[] = [];
    const sceneNodes: CanvasNodeData[] = [];
    const shotNodes: CanvasNodeData[] = [];
    const chapterNodes: CanvasNodeData[] = [];

    owned.forEach((node) => {
        const meta = readDirectorMeta(node);
        if (!meta) return;
        if (meta.kind === "character") {
            const values = parseFields(CHARACTER_FIELDS, node.metadata?.content || "");
            characters.push({ nodeId: node.id, name: node.title || values.name || "", tier: meta.tier, values, text: node.metadata?.content || "" });
        } else if (meta.kind === "scene") {
            sceneNodes.push(node);
        } else if (meta.kind === "shot") {
            shotNodes.push(node);
        } else if (meta.kind === "chapter") {
            chapterNodes.push(node);
        }
    });

    const nameByNodeId = new Map(characters.map((character) => [character.nodeId, character.name]));

    const shotsByScene = new Map<string, CollectedShot[]>();
    shotNodes.forEach((node) => {
        const meta = readDirectorMeta(node);
        if (meta?.kind !== "shot") return;
        const values = parseFields(SHOT_FIELDS, node.metadata?.content || "");
        const list = shotsByScene.get(meta.sceneNodeId) || [];
        list.push({
            nodeId: node.id,
            index: meta.index,
            code: values.code || `${meta.index}`,
            values,
            text: node.metadata?.content || "",
            sceneNodeId: meta.sceneNodeId,
        });
        shotsByScene.set(meta.sceneNodeId, list);
    });

    const buildScene = (node: CanvasNodeData): CollectedScene | null => {
        const meta = readDirectorMeta(node);
        if (meta?.kind !== "scene") return null;
        const values = parseFields(SCENE_FIELDS, node.metadata?.content || "");
        const shots = (shotsByScene.get(node.id) || []).sort((a, b) => a.index - b.index);
        return {
            nodeId: node.id,
            order: meta.order,
            name: node.title || values.name || "",
            values,
            text: node.metadata?.content || "",
            characterIds: meta.characterIds,
            characterNames: meta.characterIds.map((id) => nameByNodeId.get(id)).filter((name): name is string => Boolean(name)),
            shots,
        };
    };

    const allScenes = sceneNodes.map(buildScene).filter((scene): scene is CollectedScene => Boolean(scene));

    const chapters: CollectedChapter[] = chapterNodes
        .map((node) => {
            const meta = readDirectorMeta(node);
            if (meta?.kind !== "chapter") return null;
            const chapterScenes = allScenes
                .filter((scene) => {
                    const sceneMeta = readDirectorMeta(sceneNodes.find((item) => item.id === scene.nodeId)!);
                    return sceneMeta?.kind === "scene" && sceneMeta.chapterNodeId === node.id;
                })
                .sort((a, b) => a.order - b.order);
            return { nodeId: node.id, order: meta.order, title: node.title, chapterText: meta.chapterText || "", collapsed: Boolean(meta.collapsed), scenes: chapterScenes };
        })
        .filter((chapter): chapter is CollectedChapter => Boolean(chapter))
        .sort((a, b) => a.order - b.order);

    const claimed = new Set(chapters.flatMap((chapter) => chapter.scenes.map((scene) => scene.nodeId)));
    const orphanScenes = allScenes.filter((scene) => !claimed.has(scene.nodeId)).sort((a, b) => a.order - b.order);

    return {
        characters: characters.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "main" ? -1 : 1)),
        chapters,
        orphanScenes,
        scenes: allScenes.sort((a, b) => a.order - b.order),
        shots: allScenes.flatMap((scene) => scene.shots),
    };
}
