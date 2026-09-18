import { useMemo, useState } from "react";
import { ArrowRight, ImageIcon, Loader2, Palette, Plus, Sparkles, Trash2 } from "lucide-react";

import { FieldEditor } from "@/components/studio/field-editor";
import { generateAssetPhoto, type AssetKind } from "@/lib/director/generate";
import { findDownstreamImages, pickPhotoByLook } from "@/lib/director/photos";
import { CHARACTER_FIELDS, formatFields, parseFields, PROP_FIELDS, SCENE_FIELDS } from "@/lib/director/spec";
import type { DirectorFlow } from "@/pages/studio/use-director-flow";
import type { StudioData } from "@/pages/studio/use-studio";
import type { CanvasNodeData, DirectorCostume } from "@/types/canvas";

const KIND_LABEL: Record<AssetKind, string> = { character: "角色", scene: "场次", prop: "道具" };

/**
 * STEP 02 · 设定：角色 / 场次 / 道具三类资产卡片。
 *
 * 卡片 = 大图位 + 类型 chip + 名字 + 编辑；角色另有服饰变体切换。
 * 全局画风一次设定，所有生图提示词都会带上。
 */
export function StepArt({ studio, flow, onNext, onBack }: { studio: StudioData; flow: DirectorFlow; onNext: () => void; onBack: () => void }) {
    const [tab, setTab] = useState<AssetKind>("character");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [pending, setPending] = useState<Record<string, boolean>>({});
    const [error, setError] = useState("");
    const [style, setStyle] = useState(flow.state?.style || "");

    const { nodes, connections } = studio;
    const { characters, props, scenes } = flow.collection;

    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node] as const)), [nodes]);

    /** 找某个资产已经生成出来的图（按造型标签匹配）。 */
    const photoOf = (nodeId: string, look?: string) => {
        const hit = pickPhotoByLook(findDownstreamImages(nodeId, nodes, connections), look);
        return hit?.image.metadata?.images?.find((item) => item.status === "success") || null;
    };

    /** 拼生图提示词：资产自己的提示词 + 全局画风。 */
    const buildPrompt = (values: Record<string, string>, costume?: string) => {
        const base = (values.imagePrompt || "").trim();
        const parts = [costume ? `${costume}。` : "", base, style.trim() ? `整体风格：${style.trim()}。` : ""].filter(Boolean);
        return parts.join("\n");
    };

    const markPending = (id: string, value: boolean) => setPending((prev) => ({ ...prev, [id]: value }));

    /** 生成一张形象图。 */
    const generateOne = async (ownerId: string, kind: AssetKind, values: Record<string, string>, look?: string, costume?: string) => {
        const owner = nodeById.get(ownerId);
        if (!owner) return;
        const prompt = buildPrompt(values, costume);
        if (!prompt.trim()) {
            setError("这个资产还没有填「生图提示词」，点名字右侧的铅笔补一下。");
            return;
        }
        markPending(ownerId, true);
        try {
            const ops = await generateAssetPhoto({ ai: studio.ai, owner, kind, prompt, look, references: [] });
            if (ops) studio.applyOps(ops);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            markPending(ownerId, false);
        }
    };

    /** 批量生成：串行跑，避免并发打爆接口。 */
    const generateAll = async (kind: AssetKind) => {
        setError("");
        const list =
            kind === "character"
                ? characters.map((item) => ({ id: item.nodeId, values: item.values, look: undefined as string | undefined }))
                : kind === "scene"
                  ? scenes.map((item) => ({ id: item.nodeId, values: item.values, look: undefined }))
                  : props.map((item) => ({ id: item.nodeId, values: item.values, look: undefined }));

        for (const item of list) {
            if (photoOf(item.id, item.look)) continue;
            await generateOne(item.id, kind, item.values, item.look);
        }
    };

    const saveFields = (nodeId: string, fields: typeof CHARACTER_FIELDS, values: Record<string, string>) => {
        studio.applyOps([{ type: "update_node", id: nodeId, patch: { title: values.name || nodeById.get(nodeId)?.title || "" }, metadata: { content: formatFields(fields, values) } }]);
        setEditingId(null);
    };

    const editingNode = editingId ? nodeById.get(editingId) : null;
    const editingFields = editingNode ? (editingNode.type === "sqc:character" ? CHARACTER_FIELDS : editingNode.type === "sqc:prop" ? PROP_FIELDS : SCENE_FIELDS) : CHARACTER_FIELDS;
    const total = characters.length + props.length + scenes.length;

    const counts: { key: AssetKind; count: number }[] = [
        { key: "character", count: characters.length },
        { key: "scene", count: scenes.length },
        { key: "prop", count: props.length },
    ];
    void total;

    return (
        <div className="flex min-h-full flex-col">
            <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-6 py-3 text-xs">
                {counts.map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        onClick={() => setTab(item.key)}
                        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition ${tab === item.key ? "bg-white/10 text-stone-100" : "text-stone-400 hover:text-stone-200"}`}
                    >
                        {KIND_LABEL[item.key]}
                        <span className={`font-semibold ${tab === item.key ? "text-amber-400" : "text-amber-500/70"}`}>| {String(item.count).padStart(2, "0")}</span>
                    </button>
                ))}

                <div className="ml-auto flex items-center gap-2">
                    <div className="flex items-center gap-1.5 rounded-lg border border-white/15 px-2 py-1">
                        <Palette className="size-3.5 text-stone-400" />
                        <input
                            value={style}
                            onChange={(event) => setStyle(event.target.value)}
                            onBlur={() => flow.save({ style })}
                            placeholder="全局画风，例如：水墨写意"
                            className="w-44 bg-transparent text-[11px] text-stone-100 outline-none placeholder:text-stone-600"
                        />
                    </div>
                    <button
                        type="button"
                        disabled={flow.busy}
                        onClick={() => void generateAll(tab)}
                        className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
                    >
                        <Sparkles className="size-3.5" />
                        批量生成{KIND_LABEL[tab]}
                    </button>
                </div>
            </div>

            {style.trim() ? (
                <div className="border-b border-white/10 px-6 py-2 text-[11px] text-stone-400">
                    <span className="text-emerald-400">●</span> 风格：{style.trim()}
                </div>
            ) : null}

            {error ? <div className="border-b border-red-500/30 bg-red-500/10 px-6 py-2 text-[11px] text-red-300">{error}</div> : null}

            <div className="min-h-0 flex-1 px-6 py-5">
                {!total ? (
                    <div className="grid h-64 place-items-center text-sm text-stone-500">还没有资产。回到「剧本」步粘贴文本并拆解。</div>
                ) : (
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {tab === "character"
                            ? characters.map((item) => {
                                  const node = nodeById.get(item.nodeId);
                                  const costume = item.costumes.find((entry) => entry.id !== "main");
                                  const look = costume?.name;
                                  const photo = photoOf(item.nodeId, look);
                                  return (
                                      <AssetCard
                                          key={item.nodeId}
                                          name={item.name}
                                          chip={item.tier === "main" ? "主角" : "配角"}
                                          photo={photo}
                                          busy={Boolean(pending[item.nodeId])}
                                          onEdit={() => setEditingId(item.nodeId)}
                                          onGenerate={() => void generateOne(item.nodeId, "character", item.values, look, costume?.prompt)}
                                          costumeName={costume?.name}
                                      />
                                  );
                              })
                            : tab === "scene"
                              ? scenes.map((item) => (
                                    <AssetCard
                                        key={item.nodeId}
                                        name={item.name}
                                        chip={item.values.location || "场景"}
                                        photo={photoOf(item.nodeId)}
                                        busy={Boolean(pending[item.nodeId])}
                                        onEdit={() => setEditingId(item.nodeId)}
                                        onGenerate={() => void generateOne(item.nodeId, "scene", item.values)}
                                    />
                                ))
                              : props.map((item) => (
                                    <AssetCard
                                        key={item.nodeId}
                                        name={item.name}
                                        chip={item.values.category || "物品"}
                                        photo={photoOf(item.nodeId)}
                                        busy={Boolean(pending[item.nodeId])}
                                        onEdit={() => setEditingId(item.nodeId)}
                                        onGenerate={() => void generateOne(item.nodeId, "prop", item.values)}
                                    />
                                ))}
                        <button
                            type="button"
                            onClick={() => setError("手动新增资产暂时请在「画布编辑」里建节点，或在剧本步重新拆解。")}
                            className="grid aspect-4/3 place-items-center rounded-xl border border-dashed border-white/15 text-stone-600 hover:border-white/30 hover:text-stone-400"
                        >
                            <Plus className="size-6" />
                        </button>
                    </div>
                )}
            </div>

            <footer className="flex shrink-0 items-center gap-3 border-t border-white/10 px-6 py-3">
                <button type="button" onClick={onBack} className="rounded-lg border border-white/15 px-4 py-2 text-xs text-stone-300 hover:bg-white/10">
                    返回剧本
                </button>
                <button type="button" disabled={!total} onClick={onNext} className="ml-auto flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-stone-900 hover:bg-stone-200 disabled:opacity-40">
                    进入下一步
                    <ArrowRight className="size-3.5" />
                </button>
            </footer>

            {editingNode ? (
                <FieldEditor
                    title={`${KIND_LABEL[editingNode.type === "sqc:character" ? "character" : editingNode.type === "sqc:prop" ? "prop" : "scene"]} · ${editingNode.title}`}
                    fields={editingFields}
                    values={parseFields(editingFields, editingNode.metadata?.content || "")}
                    onSave={(values) => saveFields(editingNode.id, editingFields, values)}
                    onClose={() => setEditingId(null)}
                />
            ) : null}
        </div>
    );
}

/** 一张资产卡片：大图位 + 类型 chip + 名字 + 编辑。 */
function AssetCard({
    name,
    chip,
    photo,
    busy,
    onEdit,
    onGenerate,
    costumeName,
}: {
    name: string;
    chip: string;
    photo: { content?: string } | null;
    busy: boolean;
    onEdit: () => void;
    onGenerate: () => void;
    costumeName?: string;
}) {
    return (
        <div className="flex flex-col gap-2">
            <div className="group relative aspect-4/3 overflow-hidden rounded-xl border border-white/10 bg-[#15151a]">
                {photo?.content ? (
                    <img src={photo.content} alt={name} className="size-full object-cover" />
                ) : (
                    <div className="size-full" style={{ backgroundImage: "linear-gradient(45deg,#1c1c22 25%,transparent 25%,transparent 75%,#1c1c22 75%),linear-gradient(45deg,#1c1c22 25%,transparent 25%,transparent 75%,#1c1c22 75%)", backgroundSize: "20px 20px", backgroundPosition: "0 0,10px 10px" }} />
                )}
                <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition group-hover:opacity-100">
                    <button type="button" disabled={busy} onClick={onGenerate} className="grid size-10 place-items-center rounded-full bg-white/90 text-stone-900 hover:bg-white disabled:opacity-50" title="生成">
                        {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    </button>
                    <span className="grid size-10 place-items-center rounded-full bg-white/20 text-white" title="上传（暂未开放）">
                        <ImageIcon className="size-4" />
                    </span>
                </div>
                {photo?.content ? (
                    <button type="button" onClick={onGenerate} className="absolute right-2 top-2 grid size-7 place-items-center rounded-lg bg-black/60 text-stone-200 opacity-0 transition group-hover:opacity-100" title="重新生成">
                        <Sparkles className="size-3.5" />
                    </button>
                ) : null}
            </div>
            <div className="flex items-center gap-2 text-[11px]">
                <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-stone-300">{chip}</span>
                <button type="button" onClick={onEdit} className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-stone-100 hover:text-violet-300" title="点开编辑字段">
                    {name || "未命名"}
                </button>
                {costumeName ? <span className="shrink-0 text-[10px] text-stone-500">{costumeName}</span> : null}
                <button type="button" onClick={onEdit} className="shrink-0 text-stone-500 hover:text-stone-300" title="编辑">
                    <Trash2 className="hidden size-3.5" />
                    <span className="text-[10px]">编辑</span>
                </button>
            </div>
        </div>
    );
}
