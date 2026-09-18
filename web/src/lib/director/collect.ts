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
    /** 所属段（小说=章 / 剧本=场）的标题。工作台按它分组，不再有章节节点。 */
    chapterTitle: string;
    /** 该段正文。重新拆分镜时要回到它。 */
    script: string;
    characterIds: string[];
    characterNames: string[];
    propIds: string[];
    propNames: string[];
    shots: CollectedShot[];
};

/** 按段聚合出来的分组 —— 纯虚拟结构，只为分组展示与导出，画布上没有对应节点。 */
export type CollectedChapter = {
    title: string;
    order: number;
    chapterText: string;
    scenes: CollectedScene[];
};

export type CollectedCharacter = {
    nodeId: string;
    name: string;
    tier: DirectorCharacterTier;
    values: Record<string, string>;
    text: string;
    /** 服饰变体（主形象 + 换装）。 */
    costumes: { id: string; name: string; prompt: string }[];
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
    /** 按段聚合的分组（展示用）。 */
    chapters: CollectedChapter[];
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

    owned.forEach((node) => {
        const meta = readDirectorMeta(node);
        if (!meta) return;
        if (meta.kind === "character") {
            const values = parseFields(CHARACTER_FIELDS, node.metadata?.content || "");
            characters.push({
                nodeId: node.id,
                name: node.title || values.name || "",
                tier: meta.tier,
                values,
                text: node.metadata?.content || "",
                costumes: meta.costumes || [],
            });
        } else if (meta.kind === "prop") {
            const values = parseFields(PROP_FIELDS, node.metadata?.content || "");
            props.push({ nodeId: node.id, name: node.title || values.name || "", values, text: node.metadata?.content || "" });
        } else if (meta.kind === "scene") {
            sceneNodes.push(node);
        } else if (meta.kind === "shot") {
            shotNodes.push(node);
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
            chapterTitle: meta.chapterTitle || "",
            script: meta.script || "",
            characterIds: meta.characterIds,
            characterNames: resolve(meta.characterIds),
            propIds: meta.propIds || [],
            propNames: resolve(meta.propIds || []),
            shots,
        };
    };

    const scenes = sceneNodes
        .map(buildScene)
        .filter((scene): scene is CollectedScene => Boolean(scene))
        .sort((a, b) => a.order - b.order);

    // 按段聚合：同一段标题的场次归一组，顺序按第一场出现的位置
    const groups = new Map<string, CollectedChapter>();
    scenes.forEach((scene) => {
        const title = scene.chapterTitle || "未分组";
        let group = groups.get(title);
        if (!group) {
            group = { title, order: groups.size + 1, chapterText: scene.script, scenes: [] };
            groups.set(title, group);
        }
        if (!group.chapterText && scene.script) group.chapterText = scene.script;
        group.scenes.push(scene);
    });

    return {
        characters: characters.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "main" ? -1 : 1)),
        props,
        chapters: [...groups.values()],
        scenes,
        shots: scenes.flatMap((scene) => scene.shots),
    };
}
