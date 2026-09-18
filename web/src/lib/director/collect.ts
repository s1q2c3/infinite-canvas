import { readDirectorMeta } from "@/lib/director/meta";
import { CHARACTER_FIELDS, parseFields, PROP_FIELDS, readShotOutputKind, SCENE_FIELDS, SHOT_FIELDS, type ShotOutputKind } from "@/lib/director/spec";
import type { CanvasNodeData, DirectorCharacterTier } from "@/types/canvas";

export type CollectedShot = {
    nodeId: string;
    index: number;
    code: string;
    /** 这一镜该生图还是生视频。 */
    output: ShotOutputKind;
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
    propIds: string[];
    propNames: string[];
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

export type CollectedProp = {
    nodeId: string;
    name: string;
    values: Record<string, string>;
    text: string;
};

export type DirectorCollection = {
    characters: CollectedCharacter[];
    props: CollectedProp[];
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
    const props: CollectedProp[] = [];
    const sceneNodes: CanvasNodeData[] = [];
    const shotNodes: CanvasNodeData[] = [];
    const chapterNodes: CanvasNodeData[] = [];

    owned.forEach((node) => {
        const meta = readDirectorMeta(node);
        if (!meta) return;
        if (meta.kind === "character") {
            const values = parseFields(CHARACTER_FIELDS, node.metadata?.content || "");
            characters.push({ nodeId: node.id, name: node.title || values.name || "", tier: meta.tier, values, text: node.metadata?.content || "" });
        } else if (meta.kind === "prop") {
            const values = parseFields(PROP_FIELDS, node.metadata?.content || "");
            props.push({ nodeId: node.id, name: node.title || values.name || "", values, text: node.metadata?.content || "" });
        } else if (meta.kind === "scene") {
            sceneNodes.push(node);
        } else if (meta.kind === "shot") {
            shotNodes.push(node);
        } else if (meta.kind === "chapter") {
            chapterNodes.push(node);
        }
    });

    const nameByNodeId = new Map<string, string>([
        ...characters.map((item) => [item.nodeId, item.name] as const),
        ...props.map((item) => [item.nodeId, item.name] as const),
    ]);

    const shotsByScene = new Map<string, CollectedShot[]>();
    shotNodes.forEach((node) => {
        const meta = readDirectorMeta(node);
        if (meta?.kind !== "shot") return;
        const text = node.metadata?.content || "";
        const values = parseFields(SHOT_FIELDS, text);
        const list = shotsByScene.get(meta.sceneNodeId) || [];
        list.push({
            nodeId: node.id,
            index: meta.index,
            code: values.code || `${meta.index}`,
            output: readShotOutputKind(text),
            values,
            text,
            sceneNodeId: meta.sceneNodeId,
        });
        shotsByScene.set(meta.sceneNodeId, list);
    });

    const sceneNodeById = new Map(sceneNodes.map((node) => [node.id, node] as const));
    const buildScene = (node: CanvasNodeData): CollectedScene | null => {
        const meta = readDirectorMeta(node);
        if (meta?.kind !== "scene") return null;
        const values = parseFields(SCENE_FIELDS, node.metadata?.content || "");
        const shots = (shotsByScene.get(node.id) || []).sort((a, b) => a.index - b.index);
        const resolve = (ids: string[]) => ids.map((id) => nameByNodeId.get(id)).filter((name): name is string => Boolean(name));
        return {
            nodeId: node.id,
            order: meta.order,
            name: node.title || values.name || "",
            values,
            text: node.metadata?.content || "",
            characterIds: meta.characterIds,
            characterNames: resolve(meta.characterIds),
            propIds: meta.propIds || [],
            propNames: resolve(meta.propIds || []),
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
                    const sceneMeta = readDirectorMeta(sceneNodeById.get(scene.nodeId)!);
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
        props,
        chapters,
        orphanScenes,
        scenes: allScenes.sort((a, b) => a.order - b.order),
        shots: allScenes.flatMap((scene) => scene.shots),
    };
}
