import { useMemo, useState } from "react";
import { Film, FolderOpen, Loader2, Video } from "lucide-react";

import { findDownstreamImages, pickPhotoByLook } from "@/lib/director/photos";
import type { DirectorFlow } from "@/pages/studio/use-director-flow";
import type { StudioData } from "@/pages/studio/use-studio";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

/** 找某个节点下游指定类型的节点（经过一层配置节点）。 */
function downstreamOfType(ownerId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], type: string) {
    const byId = new Map(nodes.map((node) => [node.id, node] as const));
    const children = connections
        .filter((connection) => connection.fromNodeId === ownerId)
        .map((connection) => byId.get(connection.toNodeId))
        .filter((node): node is CanvasNodeData => Boolean(node));
    const direct = children.filter((node) => node.type === type);
    const viaConfig = children
        .filter((node) => node.type === CanvasNodeType.Config)
        .flatMap((config) =>
            connections
                .filter((connection) => connection.fromNodeId === config.id)
                .map((connection) => byId.get(connection.toNodeId))
                .filter((node): node is CanvasNodeData => Boolean(node)),
        )
        .filter((node) => node.type === type);
    return [...direct, ...viaConfig];
}

/**
 * STEP 04 · 短片：把已经生成好的分镜视频按镜号顺序拼成一条成片。
 *
 * 拼接交给内置的 ffmpeg（主进程调用），渲染进程只负责把片段按顺序递过去。
 */
export function StepFilm({ studio, flow, onBack }: { studio: StudioData; flow: DirectorFlow; onBack: () => void }) {
    const [busy, setBusy] = useState(false);
    const [output, setOutput] = useState("");
    const [error, setError] = useState("");
    const [progress, setProgress] = useState("");

    const { nodes, connections } = studio;

    /** 已生成的分镜片段，按镜号顺序。 */
    const clips = useMemo(() => {
        const list = flow.collection.shots
            .map((shot) => {
                const videoNode = downstreamOfType(shot.nodeId, nodes, connections, CanvasNodeType.Video).find((node) => Boolean(node.metadata?.content));
                const imageNode = pickPhotoByLook(findDownstreamImages(shot.nodeId, nodes, connections))?.image;
                const image = imageNode?.metadata?.images?.find((item) => item.status === "success");
                return {
                    nodeId: shot.nodeId,
                    code: shot.code,
                    output: shot.output,
                    video: videoNode?.metadata?.content,
                    videoStorageKey: videoNode?.metadata?.storageKey,
                    image: image?.content,
                    imageStorageKey: image?.storageKey,
                    sceneNodeId: shot.sceneNodeId,
                };
            })
            .filter((item) => Boolean(item.video || item.image));
        // 按镜号排序（「1-2」这种编号按数字段比较）
        return list.sort((a, b) => {
            const pa = a.code.split(/[^\d]+/).filter(Boolean).map(Number);
            const pb = b.code.split(/[^\d]+/).filter(Boolean).map(Number);
            for (let index = 0; index < Math.max(pa.length, pb.length); index += 1) {
                const diff = (pa[index] || 0) - (pb[index] || 0);
                if (diff) return diff;
            }
            return 0;
        });
    }, [connections, flow.collection.shots, nodes]);

    const videoClips = clips.filter((clip) => clip.video);
    const imageClips = clips.filter((clip) => !clip.video);

    const concat = async () => {
        if (!videoClips.length) {
            setError("还没有已生成的分镜视频。回「分镜」步生成几个视频再来。");
            return;
        }
        setBusy(true);
        setError("");
        setOutput("");
        try {
            setProgress("正在读取片段…");
            const payload: { name: string; data: ArrayBuffer }[] = [];
            for (const clip of videoClips) {
                const response = await fetch(clip.video as string);
                payload.push({ name: `shot-${clip.code.replace(/[^\w-]/g, "_")}.mp4`, data: await response.arrayBuffer() });
            }
            setProgress(`正在拼接 ${payload.length} 个片段…`);
            const result = (await window.sqcStudio?.concatVideos(payload)) as { ok: boolean; path?: string; error?: string } | undefined;
            if (!result) throw new Error("当前不在桌面版里运行，拼接成片需要桌面版。");
            if (!result.ok || !result.path) throw new Error(result.error || "拼接失败。");
            setOutput(result.path);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
            setProgress("");
        }
    };

    return (
        <div className="flex min-h-full flex-col">
            <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-6 py-3 text-xs">
                <span className="text-stone-400">
                    共 {clips.length} 个片段 · {videoClips.length} 个视频 · {imageClips.length} 个静帧
                </span>
                <div className="ml-auto flex items-center gap-2">
                    <button
                        type="button"
                        disabled={busy || !videoClips.length}
                        onClick={() => void concat()}
                        className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
                    >
                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Film className="size-3.5" />}
                        拼成成片
                    </button>
                </div>
            </div>

            {progress ? <div className="border-b border-white/10 px-6 py-2 text-[11px] text-stone-400">{progress}</div> : null}
            {error ? <div className="border-b border-red-500/30 bg-red-500/10 px-6 py-2 text-[11px] text-red-300">{error}</div> : null}
            {output ? (
                <div className="flex items-center gap-3 border-b border-emerald-500/30 bg-emerald-500/10 px-6 py-2 text-[11px] text-emerald-300">
                    成片已保存：<span className="font-mono">{output}</span>
                    <button type="button" onClick={() => void window.sqcStudio?.openPath(output)} className="flex items-center gap-1 rounded border border-emerald-500/40 px-2 py-0.5 hover:bg-emerald-500/20">
                        <FolderOpen className="size-3" />
                        打开
                    </button>
                </div>
            ) : null}

            <div className="min-h-0 flex-1 px-6 py-5">
                {!clips.length ? (
                    <div className="grid h-64 place-items-center text-sm text-stone-500">还没有生成任何片段。回「分镜」步生成画面或视频。</div>
                ) : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {clips.map((clip) => (
                            <div key={clip.nodeId} className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#141419]">
                                <div className="relative aspect-video bg-black/40">
                                    {clip.video ? (
                                        <video src={clip.video} className="size-full object-cover" muted loop playsInline controls />
                                    ) : (
                                        <img src={clip.image} alt={clip.code} className="size-full object-cover" />
                                    )}
                                    <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-stone-200">镜 {clip.code}</span>
                                </div>
                                <div className="flex items-center gap-2 px-3 py-2 text-[10px] text-stone-400">
                                    {clip.video ? <Video className="size-3 text-sky-400" /> : <Film className="size-3 text-stone-500" />}
                                    {clip.video ? "已生成视频" : "只有静帧（拼接时会跳过）"}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <footer className="flex shrink-0 items-center gap-3 border-t border-white/10 px-6 py-3">
                <button type="button" onClick={onBack} className="rounded-lg border border-white/15 px-4 py-2 text-xs text-stone-300 hover:bg-white/10">
                    返回分镜
                </button>
                <span className="text-[11px] text-stone-500">拼接按镜号顺序，只拼已生成的视频片段；静帧会被跳过。</span>
            </footer>
        </div>
    );
}
