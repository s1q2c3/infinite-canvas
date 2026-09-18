import { useMemo, useState } from "react";
import { ArrowRight, Loader2, RefreshCw, Sparkles, Video } from "lucide-react";

import { FieldEditor } from "@/components/studio/field-editor";
import { collectShotAssociation } from "@/lib/director/associate";
import { generateShotMedia } from "@/lib/director/generate";
import { findDownstreamImages, pickPhotoByLook } from "@/lib/director/photos";
import { readPresets, SHOT_PRESET_KEYS, SHOT_PRESET_LABELS } from "@/lib/director/presets";
import { formatFields, parseFields, SHOT_DETAIL_FIELDS, SHOT_FIELDS, SHOT_PRESET_FIELDS } from "@/lib/director/spec";
import { imageToDataUrl } from "@/services/image-storage";
import type { DirectorFlow } from "@/pages/studio/use-director-flow";
import type { StudioData } from "@/pages/studio/use-studio";
import type { CanvasNodeData, ShotPresetValues } from "@/types/canvas";

/**
 * STEP 03 · 分镜：按「段 → 场次」分组的镜头卡。
 *
 * 卡面只有画面描述 + 台词 + 时长 + 生成类型；景别 / 机位 / 运镜 / 构图收进「镜头预设」，
 * 其余字段点开弹窗看。生成时按关联素材取参考图（不再依赖画布连线）。
 */
export function StepStoryboard({ studio, flow, onNext, onBack }: { studio: StudioData; flow: DirectorFlow; onNext: () => void; onBack: () => void }) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [pending, setPending] = useState<Record<string, boolean>>({});
    const [error, setError] = useState("");
    const [presetPick, setPresetPick] = useState<Record<string, string>>({});

    const { nodes, connections } = studio;
    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node] as const)), [nodes]);
    const presets = readPresets(flow.state?.presets);

    /** 分镜已经生成出来的图 / 视频。 */
    const mediaOf = (shotNodeId: string) => {
        const hit = pickPhotoByLook(findDownstreamImages(shotNodeId, nodes, connections));
        const image = hit?.image.metadata?.images?.find((item) => item.status === "success");
        const video = hit?.image.metadata?.content;
        return { image, video };
    };

    const buildShotPrompt = (shotNodeId: string, values: Record<string, string>, forVideo: boolean) => {
        const association = collectShotAssociation({ shotNodeId, nodes, connections, forVideo });
        const body = [values.visual, values.dialogue && values.dialogue !== "无" ? `台词：${values.dialogue}` : "", values.imagePrompt].filter(Boolean).join("\n");
        return { association, prompt: [association.context, "【本镜】", body].filter(Boolean).join("\n\n") };
    };

    const generateOne = async (shotNodeId: string, forceMode?: "image" | "video") => {
        const shot = nodeById.get(shotNodeId);
        if (!shot) return;
        const values = parseFields(SHOT_FIELDS, shot.metadata?.content || "");
        const mode = forceMode || (/视频|video/i.test(values.output || "") ? "video" : "image");
        const { association, prompt } = buildShotPrompt(shotNodeId, values, mode === "video");

        setPending((prev) => ({ ...prev, [shotNodeId]: true }));
        setError("");
        try {
            const references = await Promise.all(
                association.assets
                    .filter((asset) => asset.imageUrl || asset.imageStorageKey)
                    .map((asset) => imageToDataUrl({ url: asset.imageUrl, storageKey: asset.imageStorageKey }).catch(() => "")),
            );
            const ops = await generateShotMedia({ ai: studio.ai, shot, mode, prompt, references: references.filter(Boolean), seconds: values.duration });
            if (ops) studio.applyOps(ops);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setPending((prev) => ({ ...prev, [shotNodeId]: false }));
        }
    };

    /** 批量生成当前段 / 全部未生成的分镜，串行跑。 */
    const generateAll = async () => {
        setError("");
        for (const shot of flow.collection.shots) {
            const { image, video } = mediaOf(shot.nodeId);
            const wanted = shot.output === "video" ? video : image;
            if (wanted) continue;
            await generateOne(shot.nodeId);
        }
    };

    const applyPreset = (shotNodeId: string, presetId: string) => {
        setPresetPick((prev) => ({ ...prev, [shotNodeId]: presetId }));
        const shot = nodeById.get(shotNodeId);
        const preset = presets.find((item) => item.id === presetId);
        if (!shot || !preset) return;
        const values = parseFields(SHOT_FIELDS, shot.metadata?.content || "");
        const next = { ...values, ...(preset.values as ShotPresetValues) };
        const meta = shot.metadata?.directorMeta;
        studio.applyOps([
            {
                type: "update_node",
                id: shotNodeId,
                metadata: {
                    content: formatFields(SHOT_FIELDS, next),
                    directorMeta: meta && meta.kind === "shot" ? { ...meta, presetId } : meta,
                },
            },
        ]);
    };

    const saveShot = (shotNodeId: string, values: Record<string, string>) => {
        studio.applyOps([{ type: "update_node", id: shotNodeId, patch: { title: `镜 ${values.code || ""}` }, metadata: { content: formatFields(SHOT_FIELDS, values) } }]);
        setEditingId(null);
    };

    const editingNode = editingId ? nodeById.get(editingId) : null;
    const total = flow.collection.shots.length;

    return (
        <div className="flex min-h-full flex-col">
            <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-6 py-3 text-xs">
                <span className="text-stone-400">
                    共 {flow.collection.chapters.length} 段 · {flow.collection.scenes.length} 场 · {total} 镜
                </span>
                <div className="ml-auto flex items-center gap-2">
                    <button type="button" disabled={flow.busy || !flow.collection.scenes.length} onClick={() => void flow.runDecompose()} className="flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-stone-200 hover:bg-white/10 disabled:opacity-40">
                        {flow.busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                        {total ? "重新拆分镜" : "拆分镜"}
                    </button>
                    <button type="button" disabled={flow.busy || !total} onClick={() => void generateAll()} className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 font-semibold text-white hover:bg-violet-500 disabled:opacity-40">
                        <Sparkles className="size-3.5" />
                        批量生成
                    </button>
                </div>
            </div>

            {error ? <div className="border-b border-red-500/30 bg-red-500/10 px-6 py-2 text-[11px] text-red-300">{error}</div> : null}

            <div className="min-h-0 flex-1 px-6 py-5">
                {!flow.collection.scenes.length ? (
                    <div className="grid h-64 place-items-center text-sm text-stone-500">还没有场次。回到「剧本」步先拆解资产。</div>
                ) : !total ? (
                    <div className="grid h-64 place-items-center text-sm text-stone-500">场次已就绪，点右上角「拆分镜」为它们写镜头。</div>
                ) : (
                    <div className="flex flex-col gap-8">
                        {flow.collection.chapters.map((chapter) => (
                            <section key={chapter.title} className="flex flex-col gap-4">
                                <header className="flex items-center gap-2 text-xs text-stone-400">
                                    <span className="font-medium text-stone-300">{chapter.title}</span>
                                    <span className="text-stone-600">{chapter.scenes.length} 场</span>
                                </header>
                                {chapter.scenes.map((scene) => (
                                    <div key={scene.nodeId} className="flex flex-col gap-2">
                                        <div className="flex items-center gap-2 text-[11px]">
                                            <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-stone-300">场次 {scene.order}</span>
                                            <span className="text-stone-300">{scene.name}</span>
                                            <span className="text-stone-600">{scene.shots.length} 镜</span>
                                        </div>
                                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                                            {scene.shots.map((shot) => {
                                                const media = mediaOf(shot.nodeId);
                                                const presetId = presetPick[shot.nodeId] || "";
                                                return (
                                                    <ShotCard
                                                        key={shot.nodeId}
                                                        code={shot.code}
                                                        values={shot.values}
                                                        isVideo={shot.output === "video"}
                                                        image={media.image}
                                                        video={media.video}
                                                        busy={Boolean(pending[shot.nodeId])}
                                                        presets={presets}
                                                        presetId={presetId}
                                                        onPreset={(value) => applyPreset(shot.nodeId, value)}
                                                        onEdit={() => setEditingId(shot.nodeId)}
                                                        onGenerate={() => void generateOne(shot.nodeId)}
                                                    />
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </section>
                        ))}
                    </div>
                )}
            </div>

            <footer className="flex shrink-0 items-center gap-3 border-t border-white/10 px-6 py-3">
                <button type="button" onClick={onBack} className="rounded-lg border border-white/15 px-4 py-2 text-xs text-stone-300 hover:bg-white/10">
                    返回设定
                </button>
                <button type="button" disabled={!total} onClick={onNext} className="ml-auto flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-stone-900 hover:bg-stone-200 disabled:opacity-40">
                    进入下一步
                    <ArrowRight className="size-3.5" />
                </button>
            </footer>

            {editingNode ? (
                <FieldEditor
                    title={`分镜 ${parseFields(SHOT_FIELDS, editingNode.metadata?.content || "").code || ""}`}
                    fields={SHOT_FIELDS}
                    values={parseFields(SHOT_FIELDS, editingNode.metadata?.content || "")}
                    onSave={(values) => saveShot(editingNode.id, values)}
                    onClose={() => setEditingId(null)}
                    footer={
                        <p className="mt-3 text-[11px] leading-5 text-stone-500">
                            卡面只显示 {SHOT_DETAIL_FIELDS.length + SHOT_PRESET_FIELDS.length} 个字段之外的关键项；景别 / 机位 / 运镜 / 构图可以在卡片上直接用「镜头预设」套用。
                        </p>
                    }
                />
            ) : null}
        </div>
    );
}

/** 一张镜头卡：画面描述 + 台词 + 时长 + 生成类型 + 镜头预设 + 关联素材。 */
function ShotCard({
    code,
    values,
    isVideo,
    image,
    video,
    busy,
    presets,
    presetId,
    onPreset,
    onEdit,
    onGenerate,
}: {
    code: string;
    values: Record<string, string>;
    isVideo: boolean;
    image?: { content?: string };
    video?: string;
    busy: boolean;
    presets: { id: string; name: string; values: ShotPresetValues }[];
    presetId: string;
    onPreset: (id: string) => void;
    onEdit: () => void;
    onGenerate: () => void;
}) {
    const media = isVideo ? video : image?.content;
    return (
        <article className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#141419]">
            <div className="relative aspect-video bg-black/40">
                {media ? (
                    isVideo ? (
                        <video src={media} className="size-full object-cover" muted loop playsInline />
                    ) : (
                        <img src={media} alt={code} className="size-full object-cover" />
                    )
                ) : (
                    <div className="grid size-full place-items-center text-[11px] text-stone-600">{busy ? "生成中…" : "未生成"}</div>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition hover:opacity-100">
                    <button type="button" disabled={busy} onClick={onGenerate} className="grid size-10 place-items-center rounded-full bg-white/90 text-stone-900 hover:bg-white disabled:opacity-50" title={isVideo ? "生成视频" : "生成画面"}>
                        {busy ? <Loader2 className="size-4 animate-spin" /> : isVideo ? <Video className="size-4" /> : <Sparkles className="size-4" />}
                    </button>
                </div>
            </div>

            <div className="flex flex-col gap-2 p-3">
                <div className="flex items-center gap-2 text-[11px]">
                    <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-stone-300">镜 {code}</span>
                    <span className={`rounded-md px-1.5 py-0.5 ${isVideo ? "bg-sky-500/20 text-sky-300" : "bg-violet-500/20 text-violet-300"}`}>{isVideo ? "视频" : "图"}</span>
                    {values.duration ? <span className="text-stone-500">{values.duration}</span> : null}
                    <button type="button" onClick={onEdit} className="ml-auto text-[10px] text-stone-500 hover:text-stone-300">
                        编辑
                    </button>
                </div>

                <p className="line-clamp-3 text-[11px] leading-5 text-stone-300">{values.visual || "（没有画面描述）"}</p>
                {values.dialogue && values.dialogue !== "无" ? <p className="line-clamp-2 text-[11px] leading-5 text-amber-300/80">{values.dialogue}</p> : null}

                <div className="flex flex-wrap items-center gap-1.5">
                    {SHOT_PRESET_KEYS.filter((key) => values[key]).map((key) => (
                        <span key={key} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-stone-400">
                            {SHOT_PRESET_LABELS[key]} {values[key]}
                        </span>
                    ))}
                </div>

                <select
                    value={presetId}
                    onChange={(event) => onPreset(event.target.value)}
                    className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-stone-300 outline-none"
                >
                    <option value="" className="bg-stone-900">
                        套用镜头预设…
                    </option>
                    {presets.map((preset) => (
                        <option key={preset.id} value={preset.id} className="bg-stone-900">
                            {preset.name}
                        </option>
                    ))}
                </select>
            </div>
        </article>
    );
}
