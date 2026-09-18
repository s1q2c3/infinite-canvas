import { useMemo, useRef, useState } from "react";
import { saveAs } from "file-saver";
import { AlertCircle, ChevronDown, ChevronRight, FileJson, Loader2, RefreshCw, ShieldCheck, Table2, Trash2, Wand2 } from "lucide-react";

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { collectDirectorData, type CollectedScene } from "@/lib/director/collect";
import { buildRoster, decomposeShots, extractAssets, type GenerateText } from "@/lib/director/decompose";
import { toDirectorJson, toScript, toShotCsv } from "@/lib/director/export";
import { assetOrigin, buildAssetPlan, buildShotPlan, DIRECTOR_LAYOUT, type SceneGeometry, type ShotAssignment } from "@/lib/director/layout";
import { splitNovelChapters } from "@/lib/director/novel-split";
import type { ParsedScene } from "@/lib/director/parse";
import { findDownstreamImages } from "@/lib/director/photos";
import { runSelfCheck, summarizeIssues, type SelfCheckIssue } from "@/lib/director/self-check";
import type { DirectorNodeKind, DirectorState } from "@/types/canvas";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

import { readDirectorMeta, readDirectorState } from "@/lib/director/meta";

const SHOT_COUNT_OPTIONS = [
    { value: 0, label: "自动（推荐）" },
    { value: 3, label: "约 3 个" },
    { value: 5, label: "约 5 个" },
    { value: 8, label: "约 8 个" },
];

/** 把画布上归集到的场景转回解析结构，供第二步作为「已定好的场景清单」。 */
function toParsedScene(scene: CollectedScene): ParsedScene {
    return {
        values: scene.values,
        characterNames: scene.characterNames,
        propNames: scene.propNames,
        look: (scene.values.look || "").trim(),
        shots: [],
    };
}

/** 导演台面板：① 拆人物 / 场景 / 物品 → 你审核 → ② 只拆分镜。 */
export function DirectorPanel({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const { theme, node } = ctx;
    const state = readDirectorState(node);
    const [novelText, setNovelText] = useState(state?.sourceText || "");
    const [model, setModel] = useState(state?.model || ctx.ai.defaultModel("text"));
    const [shotsPerScene, setShotsPerScene] = useState(state?.shotsPerChapter ?? 0);
    const [error, setError] = useState("");
    const [issues, setIssues] = useState<SelfCheckIssue[] | null>(null);
    const [expandedChapterId, setExpandedChapterId] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const nodes = ctx.getNodes();
    const connections = ctx.getConnections();
    const collection = collectDirectorData(nodes, node.id);
    const models = useMemo(() => ctx.ai.listModels("text"), [ctx]);
    const busy = state?.step === "extracting" || state?.step === "decomposing";
    const progress = state?.progress;

    /** 合并写入 director 状态，避免覆盖掉别的字段。 */
    const save = (patch: Partial<DirectorState>) => {
        const current = (ctx.node.metadata?.director as DirectorState | undefined) || { model, step: "idle" as const };
        ctx.updateMetadata({ director: { ...current, ...patch } });
    };

    const generateText: GenerateText = async (prompt, options) => {
        const result = await ctx.ai.generateText(prompt, { system: options?.system, model: options?.model, signal: options?.signal });
        return result.text;
    };

    const origin = assetOrigin(node);

    const ownedNodes = (kinds: DirectorNodeKind[]) =>
        nodes.filter((item) => {
            const meta = readDirectorMeta(item);
            return meta?.directorNodeId === node.id && kinds.includes(meta.kind);
        });

    /** 第一步重跑会重建场景，所以分镜 / 组也一并清掉。 */
    const cleanupAllOps = (): CanvasAgentOp[] => {
        const ids = ownedNodes(["character", "prop", "chapter", "scene", "shot", "group"]).map((item) => item.id);
        return ids.length ? [{ type: "delete_node", ids }] : [];
    };

    /** 只删分镜与组（第二步重跑用），资产节点不动。 */
    const cleanupShotOps = (): CanvasAgentOp[] => {
        const ids = ownedNodes(["shot", "group"]).map((item) => item.id);
        return ids.length ? [{ type: "delete_node", ids }] : [];
    };

    /** 人物 + 物品节点当前内容拼成资产表（用户可能改过，所以现读节点）。 */
    const currentRoster = () =>
        buildRoster([
            ...ownedNodes(["character"]).map((item) => ({ name: item.title, text: item.metadata?.content || "" })),
            ...ownedNodes(["prop"]).map((item) => ({ name: item.title, text: item.metadata?.content || "" })),
        ]);

    /** 第一步：拆人物 / 场景 / 物品。 */
    const runExtractAssets = async () => {
        const chapters = splitNovelChapters(novelText);
        if (!chapters.length) return setError("没有识别到可拆解的正文，请检查是否粘贴了小说内容。");
        if (!model) return setError("请先选择用于拆解的模型。");

        setError("");
        setIssues(null);
        const controller = new AbortController();
        abortRef.current = controller;
        const cleanup = cleanupAllOps();
        if (cleanup.length) ctx.applyOps(cleanup);

        const base: Partial<DirectorState> = { model, sourceText: novelText, shotsPerChapter: shotsPerScene, chapterCount: chapters.length };
        save({ ...base, step: "extracting", progress: { current: 0, total: chapters.length + 1, label: "准备中" } });

        try {
            const bundle = await extractAssets(chapters, generateText, {
                model,
                signal: controller.signal,
                onProgress: (event) => save({ ...base, step: "extracting", progress: event }),
            });
            if (!bundle.characters.length && !bundle.props.length && !bundle.chapters.some((chapter) => chapter.scenes.length)) {
                throw new Error("模型没有拆出任何内容，请检查小说文本或换一个模型。");
            }
            const plan = buildAssetPlan({ directorNodeId: node.id, bundle, origin });
            ctx.applyOps(plan.ops);
            save({ ...base, step: "extracted", progress: undefined, error: undefined });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            save({ ...base, step: "error", error: message, progress: undefined });
        } finally {
            abortRef.current = null;
        }
    };


    /** 场景节点的当前几何位置，第二步据此把分镜摆在场景右侧。 */
    const sceneGeometry = () => {
        const geometry = new Map<string, SceneGeometry>();
        collection.scenes.forEach((scene) => {
            const item = nodes.find((candidate) => candidate.id === scene.nodeId);
            if (item) geometry.set(scene.nodeId, { x: item.position.x, y: item.position.y, width: item.width, order: scene.order });
        });
        return geometry;
    };

    /** 把模型返回的「按场景分组的分镜」对到画布上的场景节点（先精确匹配，再模糊匹配）。 */
    const matchAssignments = (chapterIndex: number, groups: Array<{ sceneName: string; shots: Array<{ values: Record<string, string> }> }>): ShotAssignment[] => {
        const chapter = collection.chapters[chapterIndex];
        if (!chapter) return [];
        const normalize = (value: string) => value.replace(/\s/g, "").trim();
        return groups
            .map((group) => {
                const wanted = normalize(group.sceneName);
                const scene =
                    chapter.scenes.find((item) => normalize(item.name) === wanted) ||
                    chapter.scenes.find((item) => wanted && (normalize(item.name).includes(wanted) || wanted.includes(normalize(item.name))));
                return scene ? { sceneNodeId: scene.nodeId, shots: group.shots } : null;
            })
            .filter((item): item is ShotAssignment => Boolean(item));
    };

    /** 某一章的分镜与组节点 id（重拆那一章时只删这些）。 */
    const shotsOfChapterIds = (chapterIndex: number): string[] => {
        const chapter = collection.chapters[chapterIndex];
        if (!chapter) return [];
        const sceneIds = new Set(chapter.scenes.map((scene) => scene.nodeId));
        const shots = ownedNodes(["shot"]).filter((item) => {
            const meta = readDirectorMeta(item);
            return meta?.kind === "shot" && sceneIds.has(meta.sceneNodeId);
        });
        const groupIds = shots.map((item) => item.metadata?.groupId).filter((id): id is string => Boolean(id));
        return [...shots.map((item) => item.id), ...groupIds];
    };

    /** 第二步：只为已经定好的场景写分镜。传 only 就只重拆指定章。 */
    const runDecomposeShots = async (only?: number[]) => {
        if (!collection.chapters.length) return setError("还没有场景，请先执行第 ① 步。");
        const roster = currentRoster();
        if (!roster.trim()) return setError("资产表是空的，请先执行第 ① 步。");

        setError("");
        setIssues(null);
        const controller = new AbortController();
        abortRef.current = controller;

        const staleIds = only?.length ? only.flatMap((index) => shotsOfChapterIds(index)) : ownedNodes(["shot", "group"]).map((item) => item.id);
        if (staleIds.length) ctx.applyOps([{ type: "delete_node", ids: staleIds }]);

        const chapters = collection.chapters.map((chapter) => ({ title: chapter.title, body: chapter.chapterText }));
        const scenesByChapter = collection.chapters.map((chapter) => chapter.scenes.map(toParsedScene));
        const geometry = sceneGeometry();

        const base: Partial<DirectorState> = { model, shotsPerChapter: shotsPerScene };
        save({ ...base, step: "decomposing", progress: { current: 0, total: only?.length ?? chapters.length, label: "准备中" } });

        try {
            const results = await decomposeShots(chapters, generateText, {
                model,
                roster,
                scenesByChapter,
                shotsPerScene,
                signal: controller.signal,
                only,
                onProgress: (event) => save({ ...base, step: "decomposing", progress: event }),
            });
            const assignments = results.flatMap((result) => matchAssignments(result.chapterIndex, result.groups));
            if (!assignments.length) throw new Error("模型没有按场景名返回分镜，请重试或换一个模型。");
            const plan = buildShotPlan({ directorNodeId: node.id, assignments, geometry });
            ctx.applyOps(plan.ops);
            save({ ...base, step: "done", progress: undefined, error: undefined, sourceText: undefined });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            save({ ...base, step: "error", error: message, progress: undefined });
        } finally {
            abortRef.current = null;
        }
    };

    /** 某一章的场景 / 分镜 / 组节点 id（删除与折叠都用）。 */
    const chapterChildIds = (chapterNodeId: string) => {
        const scenes = nodes.filter((item) => {
            const meta = readDirectorMeta(item);
            return meta?.kind === "scene" && meta.chapterNodeId === chapterNodeId;
        });
        const sceneIds = new Set(scenes.map((item) => item.id));
        const shots = nodes.filter((item) => {
            const meta = readDirectorMeta(item);
            return meta?.kind === "shot" && sceneIds.has(meta.sceneNodeId);
        });
        const groupIds = shots.map((item) => item.metadata?.groupId).filter((id): id is string => Boolean(id));
        return { sceneIds: scenes.map((item) => item.id), shotIds: shots.map((item) => item.id), groupIds };
    };

    /** 只重拆某一章的分镜：场景不动，只重建这一章的分镜与组。 */
    const rerunChapter = async (chapterOrder: number) => {
        const chapter = collection.chapters.find((item) => item.order === chapterOrder);
        if (!chapter) return setError("找不到这一章，请重新整体拆解一次。");
        await runDecomposeShots([chapterOrder - 1]);
    };


    /** 删除一章及其全部场景 / 分镜。 */
    const deleteChapter = (chapterOrder: number) => {
        const chapterNode = collection.chapters.find((item) => item.order === chapterOrder);
        if (!chapterNode) return;
        const child = chapterChildIds(chapterNode.nodeId);
        ctx.applyOps([{ type: "delete_node", ids: [chapterNode.nodeId, ...child.sceneIds, ...child.shotIds, ...child.groupIds] }]);
    };

    /** 折叠 / 展开一章（只改 hidden，不删节点）。 */
    const toggleChapter = (chapterOrder: number) => {
        const chapterNode = collection.chapters.find((item) => item.order === chapterOrder);
        if (!chapterNode) return;
        const nodeData = nodes.find((item) => item.id === chapterNode.nodeId);
        if (!nodeData) return;
        const meta = readDirectorMeta(nodeData);
        if (meta?.kind !== "chapter") return;
        const collapsed = !meta.collapsed;
        const child = chapterChildIds(chapterNode.nodeId);
        ctx.applyOps([
            { type: "update_node", id: chapterNode.nodeId, metadata: { directorMeta: { ...meta, collapsed } } },
            ...[...child.sceneIds, ...child.shotIds].map((id) => ({ type: "update_node" as const, id, metadata: { hidden: collapsed } })),
        ]);
    };

    /** 清理 v1 旧拆解结果：只删能识别为导演台生成的节点，删前先报数。 */
    const cleanupLegacy = () => {
        const legacy = nodes.filter((item) => {
            const metadata = item.metadata;
            if (!metadata) return false;
            if (metadata.chapterNodeId || metadata.chapterOrder !== undefined || metadata.directorNodeId) return true;
            const director = metadata.director as { novelText?: unknown; chapters?: unknown } | undefined;
            return Boolean(director && (director.novelText !== undefined || Array.isArray(director.chapters)));
        });
        if (!legacy.length) return setError("没有找到旧版拆解结果。");
        if (!window.confirm(`将删除 ${legacy.length} 个「旧版导演台」生成的节点。\n你自己创建的节点不会被删。\n\n确定继续吗？`)) return;
        ctx.applyOps([{ type: "delete_node", ids: legacy.map((item) => item.id) }]);
        setError("");
        setIssues(null);
    };

    const download = (text: string, filename: string, mime: string) => saveAs(new Blob([text], { type: `${mime};charset=utf-8` }), filename);

    const runCheck = () => {
        const result = runSelfCheck(collection);
        setIssues(result);
        if (!result.length) setError("");
    };

    // 生成进度看板：沿「框 → 配置节点 → 图片/视频节点」两跳数已经产出的媒体
    const downstreamTypes = (nodeId: string): string[] => {
        const found: string[] = [];
        connections
            .filter((connection) => connection.fromNodeId === nodeId)
            .forEach((connection) => {
                const target = nodes.find((item) => item.id === connection.toNodeId);
                if (!target) return;
                found.push(target.type);
                connections
                    .filter((next) => next.fromNodeId === target.id)
                    .forEach((next) => {
                        const grand = nodes.find((item) => item.id === next.toNodeId);
                        if (grand) found.push(grand.type);
                    });
            });
        return found;
    };
    const hasMedia = (nodeId: string, type: string) => downstreamTypes(nodeId).includes(type);
    const characterImages = collection.characters.filter((item) => hasMedia(item.nodeId, "image")).length;
    const propImages = collection.props.filter((item) => hasMedia(item.nodeId, "image")).length;
    const sceneImages = collection.scenes.filter((item) => hasMedia(item.nodeId, "image")).length;
    const shotImages = collection.shots.filter((item) => hasMedia(item.nodeId, "image")).length;
    const videoShots = collection.shots.filter((shot) => shot.output === "video");
    const shotVideos = videoShots.filter((item) => hasMedia(item.nodeId, "video")).length;

    const panelStyle = { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text };
    const inputStyle = { background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text };
    const extracted = collection.scenes.length > 0 || collection.characters.length > 0;

    const stageRow = (label: string, done: number, total: number, color: string, hint: string) => (
        <div className="flex items-center gap-2.5 text-[11px]">
            <span className="w-[72px] shrink-0" style={{ color: total ? color : theme.node.faint }}>
                {label}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: theme.node.stroke }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%`, background: color }} />
            </div>
            <span className="w-[46px] shrink-0 text-right" style={{ color: theme.node.muted }}>
                {done}/{total}
            </span>
            <span className="w-[64px] shrink-0 text-right text-[10px]" style={{ color: theme.node.faint }}>
                {hint}
            </span>
        </div>
    );

    return (
        <div className="rounded-2xl border p-4 shadow-2xl backdrop-blur-md" style={panelStyle} onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">🎬 导演台</div>
                <button type="button" onClick={onClose} className="rounded-lg border px-2.5 py-1 text-xs" style={inputStyle}>
                    收起
                </button>
            </div>

            {/* 步骤条 */}
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
                <span className="rounded-full px-2.5 py-1 font-semibold" style={{ background: extracted ? "#4c1d95" : theme.node.panel, color: extracted ? "#ddd6fe" : theme.node.muted }}>
                    ① 人物 / 场景 / 物品
                </span>
                <span style={{ color: theme.node.faint }}>──▶</span>
                <span className="rounded-full px-2.5 py-1 font-semibold" style={{ background: collection.shots.length ? "#0c4a6e" : theme.node.panel, color: collection.shots.length ? "#bae6fd" : theme.node.muted }}>
                    ② 分镜
                </span>
                <span className="ml-auto text-[10px]" style={{ color: theme.node.faint }}>
                    模型独立于全局默认
                </span>
            </div>

            <div className="mb-1 text-[10px]" style={{ color: theme.node.muted }}>
                小说原文（自动按「第X章」切分；跑完第二步后原文会分散存进各章节节点）
            </div>
            <textarea
                value={novelText}
                onChange={(event) => setNovelText(event.target.value)}
                placeholder="在这里粘贴小说全文。先点「① 拆人物 / 场景 / 物品」，审核修改后，再点「② 拆分镜」。"
                className="thin-scrollbar h-24 w-full resize-y rounded-xl border p-2.5 text-[11px] leading-5 outline-none"
                style={inputStyle}
            />

            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]">
                <span style={{ color: theme.node.muted }}>模型</span>
                <select value={model} onChange={(event) => setModel(event.target.value)} className="max-w-48 rounded-lg border px-2 py-1.5 text-[11px] outline-none" style={inputStyle}>
                    {!model ? <option value="">（未配置文本模型）</option> : null}
                    {models.map((item) => (
                        <option key={item.value} value={item.value}>
                            {item.label}
                        </option>
                    ))}
                </select>
                <span style={{ color: theme.node.muted }}>每场分镜</span>
                <select value={shotsPerScene} onChange={(event) => setShotsPerScene(Number(event.target.value))} className="rounded-lg border px-2 py-1.5 text-[11px] outline-none" style={inputStyle}>
                    {SHOT_COUNT_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>
                            {item.label}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={runExtractAssets}
                    disabled={busy}
                    className="ml-auto flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50"
                    style={{ ...inputStyle, borderColor: "#7c5cff", color: "#c4b5fd" }}
                >
                    {state?.step === "extracting" ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
                    {extracted ? "重拆资产" : "① 拆人物 / 场景 / 物品"}
                </button>
            </div>

            {busy && progress ? (
                <div className="mt-3 text-[11px]">
                    <div className="mb-1.5 flex items-center justify-between" style={{ color: theme.node.muted }}>
                        <span>
                            {state?.step === "extracting" ? "正在拆资产" : "正在拆分镜"}：{progress.label}
                        </span>
                        <span>
                            {progress.current}/{progress.total}
                        </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: theme.node.stroke }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%`, background: theme.node.activeStroke }} />
                    </div>
                </div>
            ) : null}

            {error ? (
                <div className="mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: "rgba(239,68,68,.45)", color: "#ef4444" }}>
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                    <span className="break-all">{error}</span>
                </div>
            ) : null}

            {/* 资产清单 */}
            {extracted ? (
                <div className="mt-3 border-t pt-3" style={{ borderColor: theme.node.stroke }}>
                    <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                        <span style={{ color: "#c4b5fd" }}>
                            {collection.characters.length} 人物 · {collection.props.length} 物品 · {collection.scenes.length} 场景
                        </span>
                        <span style={{ color: theme.node.faint }}>直接在画布上改节点文字即可审核</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {collection.characters.map((character) => (
                            <span
                                key={character.nodeId}
                                className="rounded-md border px-2 py-0.5 text-[10px]"
                                style={
                                    character.tier === "main"
                                        ? { background: "#1e1b33", borderColor: "#7c5cff", color: "#c4b5fd" }
                                        : { background: "#1e1b33", borderColor: "#5b4b8a", color: "#a99ecb" }
                                }
                            >
                                {character.name} · {character.tier === "main" ? "主角" : "配角"}
                            </span>
                        ))}
                        {collection.props.map((prop) => (
                            <span key={prop.nodeId} className="rounded-md border px-2 py-0.5 text-[10px]" style={{ background: "#2a2110", borderColor: "#a16207", color: "#fcd34d" }}>
                                {prop.name} · 物品
                            </span>
                        ))}
                    </div>
                </div>
            ) : null}

            {/* 第二步 */}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-[11px]" style={{ borderColor: theme.node.stroke }}>
                <button
                    type="button"
                    onClick={() => runDecomposeShots()}
                    disabled={busy || !collection.scenes.length}
                    className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold disabled:opacity-40"
                    style={{ ...inputStyle, borderColor: "#2d5f8f", color: "#bae6fd" }}
                >
                    {state?.step === "decomposing" ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
                    {collection.shots.length ? "重拆分镜" : "② 拆分镜"}
                </button>
                <span style={{ color: theme.node.faint }}>场景已在第①步定好，这里只为它们写分镜；重拆只重建分镜，资产节点不动</span>
            </div>

            {/* 章节列表 */}
            {collection.chapters.length ? (
                <div className="mt-3">
                    <div className="mb-1.5 flex items-center justify-between text-[10px]" style={{ color: theme.node.faint }}>
                        <span>
                            共 {collection.chapters.length} 章 · {collection.scenes.length} 场 · {collection.shots.length} 镜
                        </span>
                        <span>折叠 / 重拆本章分镜 / 删除本章</span>
                    </div>
                    <div className="thin-scrollbar max-h-56 overflow-y-auto rounded-xl border" style={{ borderColor: theme.node.stroke }}>
                        {collection.chapters.map((chapter) => (
                            <div key={chapter.nodeId} className="border-b last:border-b-0" style={{ borderColor: theme.node.stroke }}>
                                <div className="flex items-center gap-2 px-2.5 py-2 text-[11px]">
                                    <button type="button" onClick={() => toggleChapter(chapter.order)} className="grid size-5 shrink-0 place-items-center rounded" title={chapter.collapsed ? "展开" : "折叠"}>
                                        {chapter.collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                                    </button>
                                    <span className="shrink-0" style={{ color: theme.node.faint }}>
                                        {chapter.order}
                                    </span>
                                    <button
                                        type="button"
                                        className="min-w-0 flex-1 truncate text-left"
                                        title={`${chapter.title}（点开看原文）`}
                                        onClick={() => setExpandedChapterId((current) => (current === chapter.nodeId ? null : chapter.nodeId))}
                                    >
                                        {chapter.title}
                                    </button>
                                    <span className="shrink-0" style={{ color: theme.node.faint }}>
                                        {chapter.scenes.length} 场 {chapter.scenes.reduce((sum, scene) => sum + scene.shots.length, 0)} 镜
                                    </span>
                                    <button type="button" onClick={() => rerunChapter(chapter.order)} disabled={busy} className="grid size-5 shrink-0 place-items-center rounded disabled:opacity-40" title="只重拆这一章的分镜">
                                        <RefreshCw className="size-3" />
                                    </button>
                                    <button type="button" onClick={() => deleteChapter(chapter.order)} disabled={busy} className="grid size-5 shrink-0 place-items-center rounded disabled:opacity-40" title="删除这一章及其场景分镜">
                                        <Trash2 className="size-3" />
                                    </button>
                                </div>
                                {expandedChapterId === chapter.nodeId ? (
                                    <div className="thin-scrollbar max-h-40 overflow-y-auto whitespace-pre-wrap border-t px-3 py-2 text-[10px] leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                                        {chapter.chapterText || "（这一章没有存原文）"}
                                    </div>
                                ) : null}
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            {/* 生成进度看板 */}
            {collection.scenes.length ? (
                <div className="mt-3 rounded-xl border p-3" style={{ borderColor: theme.node.stroke }}>
                    <div className="mb-2 text-[11px]" style={{ color: theme.node.text }}>
                        生成进度
                    </div>
                    <div className="flex flex-col gap-2">
                        {stageRow("人物照片", characterImages, collection.characters.length, "#7c5cff", "人物节点生图")}
                        {stageRow("物品照片", propImages, collection.props.length, "#fcd34d", "物品节点生图")}
                        {stageRow("场景照片", sceneImages, collection.scenes.length, "#2d8fbf", "场景节点生图")}
                        {stageRow("分镜图", shotImages, collection.shots.length, "#34d399", "点分镜生图")}
                        {stageRow("分镜视频", shotVideos, videoShots.length, "#fb923c", "点分镜生视频")}
                    </div>
                    <div className="mt-2 text-[10px]" style={{ color: theme.node.faint }}>
                        生视频会自动带上已经生成好的分镜图作参考；建议先把分镜图生完再生视频
                    </div>
                </div>
            ) : null}

            {/* 导出 / 自检 / 清理 */}
            <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3 text-[10px]" style={{ borderColor: theme.node.stroke }}>
                <button type="button" disabled={!collection.scenes.length} className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 disabled:opacity-40" style={inputStyle} onClick={() => download(toDirectorJson(collection), "导演台-结构化.json", "application/json")}>
                    <FileJson className="size-3" />
                    导出 JSON
                </button>
                <button type="button" disabled={!collection.shots.length} className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 disabled:opacity-40" style={inputStyle} onClick={() => download(toShotCsv(collection), "导演台-分镜表.csv", "text/csv")}>
                    <Table2 className="size-3" />
                    导出分镜表
                </button>
                <button type="button" disabled={!collection.scenes.length} className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 disabled:opacity-40" style={inputStyle} onClick={() => download(toScript(collection), "导演台-剧本.txt", "text/plain")}>
                    <FileJson className="size-3" />
                    导出剧本
                </button>
                <button type="button" disabled={!collection.scenes.length} className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 disabled:opacity-40" style={inputStyle} onClick={runCheck}>
                    <ShieldCheck className="size-3" />
                    一致性自检
                </button>
                <button type="button" onClick={cleanupLegacy} className="ml-auto rounded-lg border px-2.5 py-1.5" style={{ borderColor: "#7f1d1d", color: "#fca5a5" }}>
                    清理旧版拆解
                </button>
            </div>

            {issues ? (
                <div className="mt-2">
                    <div className="mb-1 text-[10px]" style={{ color: issues.length ? "#fbbf24" : "#4ade80" }}>
                        {issues.length ? summarizeIssues(issues) : "自检通过，没有发现问题"}
                    </div>
                    {issues.length ? (
                        <div className="thin-scrollbar max-h-44 overflow-y-auto rounded-xl border p-2 text-[10px] leading-5" style={{ borderColor: theme.node.stroke }}>
                            {issues.slice(0, 200).map((issue, index) => (
                                <div key={`${issue.scope}-${index}`} className="flex gap-1.5">
                                    <span style={{ color: issue.level === "error" ? "#ef4444" : "#fbbf24" }}>{issue.level === "error" ? "✕" : "!"}</span>
                                    <span style={{ color: theme.node.muted }}>
                                        <span style={{ color: theme.node.text }}>{issue.scope}</span> {issue.message}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : null}

            {!extracted && !busy ? (
                <div className="mt-3 text-[10px] leading-5" style={{ color: theme.node.faint }}>
                    流程：粘贴小说 →「① 拆人物 / 场景 / 物品」→ 在画布上直接改设定 →「② 拆分镜」。<br />
                    拆完会按「人物区 + 物品区 + 章节分块（场景行 + 分镜横排）」铺开，每个框下方都留了生成图片 / 视频的位置。
                </div>
            ) : null}
        </div>
    );
}
