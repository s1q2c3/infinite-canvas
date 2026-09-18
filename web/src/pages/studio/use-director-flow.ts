/**
 * 导演台流程编排（工作台侧）。
 *
 * ① 剧本切段（小说按章 / 剧本按场）→ ② 逐段拆「角色 / 场次 / 物品」→ ③ 为已定场次写分镜。
 *
 * 和旧版面板的区别：不建章节节点、不为生成结果预留画布空间、不自动接线；
 * 「段」的正文存进场次节点，重新拆分镜时直接取用。
 */

import { useCallback, useMemo, useRef, useState } from "react";

import { collectDirectorData, type CollectedScene, type DirectorCollection } from "@/lib/director/collect";
import { buildRoster, decomposeShots, extractAssets, type GenerateText } from "@/lib/director/decompose";
import { assetOrigin, buildAssetPlan, buildShotPlan, type SceneGeometry, type ShotAssignment } from "@/lib/director/layout";
import { readDirectorMeta, readDirectorState } from "@/lib/director/meta";
import type { ParsedScene } from "@/lib/director/parse";
import { splitScriptSegments } from "@/lib/director/script-parse";
import type { DirectorScriptKind, DirectorState } from "@/types/canvas";
import type { StudioData } from "@/pages/studio/use-studio";

const EMPTY_COLLECTION: DirectorCollection = { characters: [], props: [], chapters: [], scenes: [], shots: [] };

/** 把工作台归集到的场次转回解析结构，供第二步作为「已定好的场次清单」。 */
function toParsedScene(scene: CollectedScene): ParsedScene {
    return {
        values: scene.values,
        characterNames: scene.characterNames,
        propNames: scene.propNames,
        look: (scene.values.look || "").trim(),
        shots: [],
    };
}

/** 场景名模糊匹配：模型偶尔会多写「场景」前缀或空格。 */
function matchScene(scenes: CollectedScene[], wanted: string) {
    const normalize = (value: string) => value.replace(/\s/g, "").replace(/^场景[：:]?/, "").trim();
    const target = normalize(wanted);
    if (!target) return null;
    return (
        scenes.find((scene) => normalize(scene.name) === target) ||
        scenes.find((scene) => normalize(scene.name).includes(target) || target.includes(normalize(scene.name))) ||
        null
    );
}

export type DirectorFlow = {
    state: DirectorState | null;
    collection: DirectorCollection;
    busy: boolean;
    error: string;
    progress: { current: number; total: number; label: string } | null;
    save: (patch: Partial<DirectorState>) => void;
    /** 第一步：按段拆出角色 / 场次 / 物品。会先清掉上一次的拆解结果。 */
    runExtract: (text: string, kind: DirectorScriptKind, model: string) => Promise<void>;
    /** 第二步：为已定下来的场次写分镜。传 only 就只重拆指定段。 */
    runDecompose: (only?: number[]) => Promise<void>;
    /** 清掉所有导演台生成的节点。 */
    clearAll: () => void;
    abort: () => void;
};


export function useDirectorFlow(studio: StudioData) {
    const { nodes, directorNode, applyOps, ai } = studio;
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [progress, setProgress] = useState<{ current: number; total: number; label: string } | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const state = directorNode ? readDirectorState(directorNode) : null;

    const collection = useMemo(
        () => (directorNode ? collectDirectorData(nodes, directorNode.id) : EMPTY_COLLECTION),
        [directorNode, nodes],
    );

    const save = useCallback(
        (patch: Partial<DirectorState>) => {
            if (!directorNode) return;
            const current = readDirectorState(directorNode) || { model: "", step: "idle" as const };
            applyOps([{ type: "update_node", id: directorNode.id, metadata: { director: { ...current, ...patch } } }]);
        },
        [applyOps, directorNode],
    );

    const generateText: GenerateText = useCallback(
        async (prompt, options) => {
            const result = await ai.generateText(prompt, { system: options?.system, model: options?.model, signal: options?.signal });
            return result.text;
        },
        [ai],
    );

    /** 导演台生成的节点 id（含旧版章节节点，重拆时一并清掉）。 */
    const ownedIds = useCallback(
        () => nodes.filter((node) => readDirectorMeta(node)?.directorNodeId === directorNode?.id).map((node) => node.id),
        [directorNode, nodes],
    );

    const clearAll = useCallback(() => {
        const ids = ownedIds();
        if (ids.length) applyOps([{ type: "delete_node", ids }]);
    }, [applyOps, ownedIds]);

    const abort = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        setBusy(false);
        setProgress(null);
    }, []);

    /** 第一步：按段拆出角色 / 场次 / 物品。会先清掉上一次的拆解结果。 */
    const runExtract = useCallback(
        async (text: string, kind: DirectorScriptKind, model: string) => {
            if (!directorNode) return;
            const segments = splitScriptSegments(text, kind);
            if (!segments.length) {
                setError("没有识别到可拆解的正文，请检查粘贴的内容。");
                return;
            }
            if (!model) {
                setError("请先选择用于拆解的模型。");
                return;
            }

            setError("");
            const controller = new AbortController();
            abortRef.current = controller;
            setBusy(true);

            // 重拆会重建全部资产，旧节点（含旧版章节节点）一并清掉
            const stale = ownedIds();
            if (stale.length) applyOps([{ type: "delete_node", ids: stale }]);

            const base: Partial<DirectorState> = { model, sourceText: text, scriptKind: kind };
            save({ ...base, step: "extracting", progress: { current: 0, total: segments.length + 1, label: "准备中" } });

            try {
                const bundle = await extractAssets(segments, generateText, {
                    model,
                    kind,
                    signal: controller.signal,
                    onProgress: (event) => {
                        setProgress(event);
                        save({ ...base, step: "extracting", progress: event });
                    },
                });
                if (!bundle.characters.length && !bundle.props.length && !bundle.segments.some((segment) => segment.scenes.length)) {
                    throw new Error("模型没有拆出任何内容，请检查文本或换一个模型。");
                }
                const plan = buildAssetPlan({ directorNodeId: directorNode.id, bundle, origin: assetOrigin(directorNode) });
                applyOps(plan.ops);
                save({ ...base, step: "extracted", stage: "art", progress: undefined, error: undefined });
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                setError(message);
                save({ ...base, step: "error", error: message, progress: undefined });
            } finally {
                setBusy(false);
                setProgress(null);
                abortRef.current = null;
            }
        },
        [applyOps, directorNode, generateText, ownedIds, save],
    );

    /** 第二步：为已定下来的场次写分镜。传 only 就只重拆指定段。 */
    const runDecompose = useCallback(
        async (only?: number[]) => {
            if (!directorNode) return;
            if (!collection.scenes.length) {
                setError("还没有场次，请先执行第 ① 步。");
                return;
            }
            const roster = buildRoster([
                ...collection.characters.map((character) => ({ name: character.name, text: character.text })),
                ...collection.props.map((prop) => ({ name: prop.name, text: prop.text })),
            ]);
            if (!roster.trim()) {
                setError("资产表是空的，请先执行第 ① 步。");
                return;
            }

            setError("");
            const controller = new AbortController();
            abortRef.current = controller;
            setBusy(true);

            const segments = collection.chapters.map((chapter) => ({ title: chapter.title, body: chapter.chapterText }));
            const scenesBySegment = collection.chapters.map((chapter) => chapter.scenes.map(toParsedScene));

            // 要重拆的段：删掉它们的旧分镜与组，其余保留
            const targetChapters = only?.length ? collection.chapters.filter((_, index) => only.includes(index)) : collection.chapters;
            const targetSceneIds = new Set(targetChapters.flatMap((chapter) => chapter.scenes.map((scene) => scene.nodeId)));
            const staleShots = only?.length ? collection.shots.filter((shot) => targetSceneIds.has(shot.sceneNodeId)).map((shot) => shot.nodeId) : collection.shots.map((shot) => shot.nodeId);
            const staleGroups = nodes.filter((node) => readDirectorMeta(node)?.kind === "group" && readDirectorMeta(node)?.directorNodeId === directorNode.id).map((node) => node.id);
            const staleIds = [...staleShots, ...staleGroups];
            if (staleIds.length) applyOps([{ type: "delete_node", ids: staleIds }]);

            const geometry = new Map<string, SceneGeometry>();
            collection.scenes.forEach((scene) => {
                const node = nodes.find((item) => item.id === scene.nodeId);
                if (node) geometry.set(scene.nodeId, { x: node.position.x, y: node.position.y, width: node.width, order: scene.order });
            });

            const model = state?.model || "";
            const base: Partial<DirectorState> = { model };
            save({ ...base, step: "decomposing", progress: { current: 0, total: segments.length, label: "准备中" } });

            try {
                const results = await decomposeShots(segments, generateText, {
                    model,
                    roster,
                    scenesBySegment,
                    shotsPerScene: state?.shotsPerChapter ?? 0,
                    signal: controller.signal,
                    only,
                    onProgress: (event) => {
                        setProgress(event);
                        save({ ...base, step: "decomposing", progress: event });
                    },
                });

                const assignments: ShotAssignment[] = [];
                results.forEach((result) => {
                    const chapter = collection.chapters[result.segmentIndex];
                    if (!chapter) return;
                    result.groups.forEach((group) => {
                        const scene = matchScene(chapter.scenes, group.sceneName);
                        if (scene) assignments.push({ sceneNodeId: scene.nodeId, shots: group.shots });
                    });
                });
                if (!assignments.length) throw new Error("模型没有按场次名返回分镜，请重试或换一个模型。");

                const plan = buildShotPlan({ directorNodeId: directorNode.id, assignments, geometry });
                applyOps(plan.ops);
                save({ ...base, step: "done", stage: "storyboard", progress: undefined, error: undefined });
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                setError(message);
                save({ ...base, step: "error", error: message, progress: undefined });
            } finally {
                setBusy(false);
                setProgress(null);
                abortRef.current = null;
            }
        },
        [applyOps, collection, directorNode, generateText, nodes, save, state?.model, state?.shotsPerChapter],
    );

    return { state, collection, busy, error, progress, save, runExtract, runDecompose, clearAll, abort };
}
