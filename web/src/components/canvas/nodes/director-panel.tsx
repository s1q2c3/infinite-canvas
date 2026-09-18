import { useMemo, useRef, useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, Loader2, RefreshCw, Trash2, Wand2 } from "lucide-react";

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { decomposeChapters, decomposeOneChapter, type GenerateText } from "@/lib/director/decompose";
import { buildChapterOps } from "@/lib/director/layout";
import { splitNovelChapters } from "@/lib/director/novel-split";
import type { DirectorChapter, DirectorState } from "@/types/canvas";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

import { readDirectorState } from "./director-node";

const SHOT_COUNT_OPTIONS = [
    { value: 0, label: "自动（推荐）" },
    { value: 5, label: "约 5 个" },
    { value: 8, label: "约 8 个" },
    { value: 12, label: "约 12 个" },
    { value: 20, label: "约 20 个" },
];

/** 导演台面板：粘贴小说 → 逐章拆解 → 自动铺到画布。 */
export function DirectorPanel({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const { theme, node } = ctx;
    const state = readDirectorState(ctx);
    const [novelText, setNovelText] = useState(state?.novelText || "");
    const [model, setModel] = useState(state?.model || ctx.ai.defaultModel("text"));
    const [shotsPerChapter, setShotsPerChapter] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const abortRef = useRef<AbortController | null>(null);

    const models = useMemo(() => ctx.ai.listModels("text"), [ctx]);
    const chapters = state?.chapters || [];

    const save = (patch: Partial<DirectorState>) => {
        const base: DirectorState = { novelText: state?.novelText || "", model: state?.model || "", chapters: state?.chapters || [], status: state?.status || "idle" };
        ctx.updateMetadata({ director: { ...base, ...patch } });
    };

    /** 删除上一轮拆解产生的所有节点，避免新旧结果叠在一起。 */
    const cleanupOps = (): CanvasAgentOp[] => {
        const ids = chapters.flatMap((chapter) => [chapter.nodeId, ...chapter.shots.map((shot) => shot.nodeId)]).filter((id): id is string => Boolean(id));
        return ids.length ? [{ type: "delete_node", ids }] : [];
    };

    const generateText: GenerateText = async (prompt, options) => {
        const result = await ctx.ai.generateText(prompt, { system: options?.system, model: options?.model, signal: options?.signal });
        return result.text;
    };

    const runAll = async () => {
        const raw = splitNovelChapters(novelText);
        if (!raw.length) return setError("没有识别到可拆解的正文，请检查是否粘贴了小说内容。");
        if (!model) return setError("请先选择用于拆解的模型。");

        setBusy(true);
        setError("");
        const controller = new AbortController();
        abortRef.current = controller;

        const cleanup = cleanupOps();
        if (cleanup.length) ctx.applyOps(cleanup);
        save({ novelText, model, chapters: [], status: "running", progress: { current: 0, total: raw.length, label: "准备中" } });

        try {
            const result = await decomposeChapters(raw, generateText, {
                model,
                shotsPerChapter,
                signal: controller.signal,
                onProgress: (event) => save({ novelText, model, chapters: [], status: "running", progress: event }),
            });
            const { ops, deployed } = buildChapterOps(result, node.id, { originX: node.position.x, originY: node.position.y + node.height + 80 });
            const nextChapters: DirectorChapter[] = result.map((chapter) => {
                const item = deployed.find((entry) => entry.chapterId === chapter.id);
                return { ...chapter, nodeId: item?.chapterNodeId, shots: chapter.shots.map((shot, index) => ({ ...shot, nodeId: item?.shotNodeIds[index] })) };
            });
            ctx.applyOps(ops);
            save({ novelText, model, chapters: nextChapters, status: "done", progress: undefined });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            save({ novelText, model, status: "error", error: message, progress: undefined });
        } finally {
            setBusy(false);
            abortRef.current = null;
        }
    };

    /** 只重拆某一章：删掉该章旧节点，重新生成后放回同一行。 */
    const rerunChapter = async (chapter: DirectorChapter, index: number) => {
        const raw = splitNovelChapters(state?.novelText || "")[index];
        if (!raw) return setError("找不到该章原文，请重新整体拆解一次。");

        setBusy(true);
        setError("");
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const result = await decomposeOneChapter(raw, generateText, { model, shotsPerChapter, signal: controller.signal });
            const stale = [chapter.nodeId, ...chapter.shots.map((shot) => shot.nodeId)].filter((id): id is string => Boolean(id));
            if (stale.length) ctx.applyOps([{ type: "delete_node", ids: stale }]);
            const { ops, deployed } = buildChapterOps([result], node.id, { row: chapter.order - 1, originX: node.position.x, originY: node.position.y + node.height + 80 });
            const item = deployed[0];
            const next: DirectorChapter = { ...result, order: chapter.order, nodeId: item?.chapterNodeId, shots: result.shots.map((shot, shotIndex) => ({ ...shot, nodeId: item?.shotNodeIds[shotIndex] })) };
            ctx.applyOps(ops);
            save({ chapters: chapters.map((entry) => (entry.id === chapter.id ? next : entry)) });
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
            abortRef.current = null;
        }
    };

    const toggleChapter = (chapter: DirectorChapter) => {
        const next = !chapter.collapsed;
        const shots = ctx.getNodes().filter((item) => item.metadata?.chapterNodeId === chapter.nodeId);
        ctx.applyOps([
            ...(chapter.nodeId ? [{ type: "update_node" as const, id: chapter.nodeId, metadata: { chapterCollapsed: next } }] : []),
            ...shots.map((shot) => ({ type: "update_node" as const, id: shot.id, metadata: { hidden: next } })),
        ]);
        save({ chapters: chapters.map((entry) => (entry.id === chapter.id ? { ...entry, collapsed: next } : entry)) });
    };

    const panelStyle = { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text };
    const inputStyle = { background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text };
    const progress = state?.progress;

    return (
        <div className="rounded-2xl border p-4 shadow-2xl backdrop-blur-md" style={panelStyle} onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold">🎬 导演台</div>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={onClose} className="rounded-lg border px-2.5 py-1 text-xs" style={inputStyle}>
                        收起
                    </button>
                </div>
            </div>

            <textarea
                value={novelText}
                onChange={(event) => setNovelText(event.target.value)}
                placeholder="在这里粘贴小说全文。系统会自动按「第X章」切分，逐章拆成镜头脚本。"
                className="thin-scrollbar h-28 w-full resize-y rounded-xl border p-3 text-xs leading-5 outline-none"
                style={inputStyle}
            />

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="opacity-70">模型</span>
                <select value={model} onChange={(event) => setModel(event.target.value)} className="max-w-56 rounded-lg border px-2 py-1.5 text-xs outline-none" style={inputStyle}>
                    {!model ? <option value="">（未配置文本模型）</option> : null}
                    {models.map((item) => (
                        <option key={item.value} value={item.value}>
                            {item.label}
                        </option>
                    ))}
                </select>

                <span className="ml-2 opacity-70">每章镜头</span>
                <select value={shotsPerChapter} onChange={(event) => setShotsPerChapter(Number(event.target.value))} className="rounded-lg border px-2 py-1.5 text-xs outline-none" style={inputStyle}>
                    {SHOT_COUNT_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>
                            {item.label}
                        </option>
                    ))}
                </select>

                <button
                    type="button"
                    onClick={runAll}
                    disabled={busy}
                    className="ml-auto flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                    style={{ ...inputStyle, borderColor: theme.node.activeStroke }}
                >
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
                    {chapters.length ? "重新拆解" : "拆解到画布"}
                </button>
            </div>

            {busy && progress ? (
                <div className="mt-3 text-xs">
                    <div className="mb-1.5 flex items-center justify-between opacity-70">
                        <span>正在拆解：{progress.label}</span>
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
                <div className="mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "rgba(239,68,68,.45)", color: "#ef4444" }}>
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                    <span className="break-all">{error}</span>
                </div>
            ) : null}

            {chapters.length ? (
                <div className="mt-3">
                    <div className="mb-1.5 flex items-center justify-between text-[11px] opacity-60">
                        <span>
                            共 {chapters.length} 章 · {chapters.reduce((sum, chapter) => sum + chapter.shots.length, 0)} 个镜头
                        </span>
                        <span>▸ 折叠 / 展开 · ↻ 重拆本章</span>
                    </div>
                    <div className="thin-scrollbar max-h-64 overflow-y-auto rounded-xl border" style={{ borderColor: theme.node.stroke }}>
                        {chapters.map((chapter, index) => (
                            <div key={chapter.id} className="flex items-center gap-2 border-b px-2.5 py-2 text-xs last:border-b-0" style={{ borderColor: theme.node.stroke }}>
                                <button type="button" onClick={() => toggleChapter(chapter)} className="grid size-5 shrink-0 place-items-center rounded" title={chapter.collapsed ? "展开" : "折叠"}>
                                    {chapter.collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                                </button>
                                <span className="shrink-0 opacity-50">{chapter.order}</span>
                                <span className="min-w-0 flex-1 truncate" title={chapter.title}>
                                    {chapter.title}
                                </span>
                                <span className="shrink-0 opacity-50">{chapter.shots.length} 镜</span>
                                <button type="button" onClick={() => rerunChapter(chapter, index)} disabled={busy} className="grid size-5 shrink-0 place-items-center rounded disabled:opacity-40" title="只重拆这一章">
                                    <RefreshCw className="size-3" />
                                </button>
                                <button
                                    type="button"
                                    disabled={busy}
                                    className="grid size-5 shrink-0 place-items-center rounded disabled:opacity-40"
                                    title="删除这一章及其镜头"
                                    onClick={() => {
                                        const ids = [chapter.nodeId, ...chapter.shots.map((shot) => shot.nodeId)].filter((id): id is string => Boolean(id));
                                        if (ids.length) ctx.applyOps([{ type: "delete_node", ids }]);
                                        save({ chapters: chapters.filter((entry) => entry.id !== chapter.id) });
                                    }}
                                >
                                    <Trash2 className="size-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="mt-3 text-[11px] leading-5 opacity-50">拆解会按「第X章」把小说切分，逐章调用模型生成镜头脚本，然后在画布上按「一章一行、行内横排」铺开。镜头是可编辑的文本节点，双击即可改字。</div>
            )}
        </div>
    );
}
