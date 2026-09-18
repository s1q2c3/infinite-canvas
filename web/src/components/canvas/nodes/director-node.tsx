import { AlertCircle, ChevronDown, ChevronRight, Clapperboard, Loader2 } from "lucide-react";

import type { DirectorState } from "@/types/canvas";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

export function readDirectorState(ctx: CanvasNodeContext): DirectorState | null {
    return (ctx.node.metadata?.director as DirectorState | undefined) || null;
}

/** 导演台节点本体：只显示状态摘要，操作都在下方面板里。 */
export function DirectorNodeContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { theme } = ctx;
    const state = readDirectorState(ctx);
    const chapters = state?.chapters || [];
    const shotCount = chapters.reduce((sum, chapter) => sum + chapter.shots.length, 0);
    const running = state?.status === "running";

    return (
        <div className="flex h-full w-full select-none flex-col items-center justify-center gap-2 px-5 text-center">
            <Clapperboard className="size-8" style={{ color: running ? theme.node.activeStroke : theme.node.faint }} />
            {running ? (
                <>
                    <div className="flex items-center gap-2 text-sm font-medium" style={{ color: theme.node.text }}>
                        <Loader2 className="size-4 animate-spin" />
                        正在拆解…
                    </div>
                    <div className="text-xs" style={{ color: theme.node.muted }}>
                        {state?.progress ? `${state.progress.current}/${state.progress.total} · ${state.progress.label}` : ""}
                    </div>
                </>
            ) : state?.status === "error" ? (
                <>
                    <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "#ef4444" }}>
                        <AlertCircle className="size-4" />
                        拆解失败
                    </div>
                    <div className="line-clamp-3 text-xs leading-5" style={{ color: theme.node.muted }}>
                        {state.error}
                    </div>
                </>
            ) : chapters.length ? (
                <>
                    <div className="text-sm font-semibold" style={{ color: theme.node.text }}>
                        {chapters.length} 章 · {shotCount} 个镜头
                    </div>
                    <div className="text-xs" style={{ color: theme.node.muted }}>
                        单击打开导演台
                    </div>
                </>
            ) : (
                <>
                    <div className="text-sm font-medium" style={{ color: theme.node.text }}>
                        导演台
                    </div>
                    <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
                        单击打开，粘贴小说
                        <br />
                        自动拆成镜头铺到画布
                    </div>
                </>
            )}
        </div>
    );
}

/** 章节节点：显示章节名与镜头数，并就地折叠 / 展开该章镜头。 */
export function ChapterNodeContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { theme, node } = ctx;
    const shots = ctx.getNodes().filter((item) => item.metadata?.chapterNodeId === node.id);
    const collapsed = Boolean(node.metadata?.chapterCollapsed);
    const title = node.title || node.metadata?.content || "章节";

    const toggle = () => {
        const next = !collapsed;
        ctx.applyOps([
            { type: "update_node", id: node.id, metadata: { chapterCollapsed: next } },
            ...shots.map((shot) => ({ type: "update_node" as const, id: shot.id, metadata: { hidden: next } })),
        ]);
    };

    return (
        <div className="flex h-full w-full select-none flex-col justify-between p-4">
            <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-wider" style={{ color: theme.node.faint }}>
                    第 {node.metadata?.chapterOrder ?? "?"} 章
                </div>
                <div className="mt-1.5 line-clamp-4 text-[15px] font-semibold leading-6" style={{ color: theme.node.text }}>
                    {title}
                </div>
            </div>
            <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                    event.stopPropagation();
                    toggle();
                }}
                disabled={!shots.length}
                className="flex items-center gap-1.5 self-start rounded-lg border px-2.5 py-1.5 text-xs font-medium transition hover:scale-[1.02] disabled:opacity-50"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            >
                {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                {collapsed ? `展开 ${shots.length} 个镜头` : `折叠 ${shots.length} 个镜头`}
            </button>
        </div>
    );
}
