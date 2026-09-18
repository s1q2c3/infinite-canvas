import { AlertCircle, ChevronDown, ChevronRight, Clapperboard, Loader2, Package, Star } from "lucide-react";

import { readDirectorMeta, readDirectorState } from "@/lib/director/meta";
import type { DirectorNodeMeta, DirectorSceneMeta } from "@/types/canvas";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

/** 节点正文：统一的可滚动文本区。 */
function NodeText({ text, color }: { text: string; color: string }) {
    return (
        <div className="thin-scrollbar h-full w-full overflow-y-auto whitespace-pre-wrap break-words px-3 py-2.5 text-[11px] leading-[1.7]" style={{ color }}>
            {text}
        </div>
    );
}

/**
 * 「生图 / 生视频」标记。
 * 一眼看出这个框该产出图片还是视频 —— 分镜的生成类型由拆解时判定。
 */
function OutputBadge({ kind, color }: { kind: "image" | "video"; color: string }) {
    const video = kind === "video";
    return (
        <span
            className="shrink-0 rounded px-1.5 py-[1px] text-[9px] font-semibold"
            style={{ background: video ? "rgba(249,115,22,.18)" : "rgba(16,185,129,.16)", color: video ? "#fb923c" : "#34d399" }}
            title={video ? "这一框生成视频" : "这一框生成图片"}
        >
            {video ? "生视频" : "生图"}
            <span style={{ color }} />
        </span>
    );
}

/** 导演台节点本体：只显示阶段摘要，操作都在下方面板里。 */
export function DirectorNodeContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { theme } = ctx;
    const state = readDirectorState(ctx.node);
    const nodes = ctx.getNodes();
    const count = (kind: DirectorNodeMeta["kind"]) => nodes.filter((node) => readDirectorMeta(node)?.kind === kind).length;
    const characters = count("character");
    const props = count("prop");
    const scenes = count("scene");
    const shots = count("shot");
    const busy = state?.step === "extracting" || state?.step === "decomposing";

    return (
        <div className="flex h-full w-full select-none flex-col items-center justify-center gap-2 px-5 text-center">
            <Clapperboard className="size-7" style={{ color: busy ? theme.node.activeStroke : theme.node.faint }} />
            {busy ? (
                <>
                    <div className="flex items-center gap-2 text-sm font-medium" style={{ color: theme.node.text }}>
                        <Loader2 className="size-4 animate-spin" />
                        {state?.step === "extracting" ? "正在提取人物 / 场景 / 物品…" : "正在拆分镜…"}
                    </div>
                    <div className="text-[11px] leading-5" style={{ color: theme.node.muted }}>
                        {state?.progress ? `${state.progress.current}/${state.progress.total} · ${state.progress.label}` : ""}
                    </div>
                </>
            ) : state?.step === "error" ? (
                <>
                    <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "#ef4444" }}>
                        <AlertCircle className="size-4" />
                        拆解失败
                    </div>
                    <div className="line-clamp-3 text-[11px] leading-5" style={{ color: theme.node.muted }}>
                        {state.error}
                    </div>
                </>
            ) : scenes || shots ? (
                <>
                    <div className="text-sm font-semibold" style={{ color: theme.node.text }}>
                        {characters} 人物 · {props} 物品 · {scenes} 场景 · {shots} 分镜
                    </div>
                    <div className="text-[11px]" style={{ color: theme.node.muted }}>
                        单击打开导演台
                    </div>
                </>
            ) : (
                <>
                    <div className="text-sm font-medium" style={{ color: theme.node.text }}>
                        导演台
                    </div>
                    <div className="text-[11px] leading-5" style={{ color: theme.node.muted }}>
                        单击打开，粘贴小说
                        <br />
                        先拆人物 / 场景 / 物品，再拆分镜
                    </div>
                </>
            )}
        </div>
    );
}

/** 人物节点：显示设定正文，顶部标出主角 / 配角与生成类型。 */
export function CharacterNodeContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { node, theme } = ctx;
    const meta = readDirectorMeta(node);
    const tier = meta?.kind === "character" ? meta.tier : "support";

    return (
        <div className="flex h-full w-full flex-col">
            <div className="flex shrink-0 items-center gap-1.5 px-3 pt-2 text-[10px] font-medium" style={{ color: tier === "main" ? "#c4b5fd" : theme.node.faint }}>
                {tier === "main" ? <Star className="size-3 fill-current" /> : null}
                {tier === "main" ? "主角" : "配角"}
                <OutputBadge kind="image" color={theme.node.faint} />
                <span className="ml-auto truncate opacity-60">{node.title}</span>
            </div>
            <div className="min-h-0 flex-1">
                <NodeText text={node.metadata?.content || ""} color={theme.node.text} />
            </div>
        </div>
    );
}

/** 重要物品节点：外观设定 + 生成类型标记。 */
export function PropNodeContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { node, theme } = ctx;
    return (
        <div className="flex h-full w-full flex-col">
            <div className="flex shrink-0 items-center gap-1.5 px-3 pt-2 text-[10px] font-medium" style={{ color: "#fcd34d" }}>
                <Package className="size-3" />
                重要物品
                <OutputBadge kind="image" color={theme.node.faint} />
                <span className="ml-auto truncate opacity-60">{node.title}</span>
            </div>
            <div className="min-h-0 flex-1">
                <NodeText text={node.metadata?.content || ""} color={theme.node.text} />
            </div>
        </div>
    );
}

/** 场景节点：正文之外，「出场人物 / 出现物品」按节点当前名字动态渲染。 */
export function SceneNodeContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { node, theme } = ctx;
    const meta = readDirectorMeta(node);
    const characterIds = meta?.kind === "scene" ? meta.characterIds : [];
    const propIds = meta?.kind === "scene" ? meta.propIds || [] : [];
    // 取节点当前标题，所以改人名 / 改物品名会自动跟着变
    const resolve = (ids: string[]) => ids.map((id) => ctx.getNode(id)?.title).filter((name): name is string => Boolean(name));
    const names = resolve(characterIds);
    const propNames = resolve(propIds);

    return (
        <div className="flex h-full w-full flex-col">
            <div className="flex shrink-0 items-center gap-1.5 px-3 pt-2 text-[10px] font-medium" style={{ color: theme.node.faint }}>
                <OutputBadge kind="image" color={theme.node.faint} />
                <span className="ml-auto truncate opacity-60">{node.title}</span>
            </div>
            <div className="min-h-0 flex-1">
                <NodeText text={node.metadata?.content || ""} color={theme.node.text} />
            </div>
            <div className="shrink-0 border-t px-3 py-2 text-[10px] leading-4" style={{ borderColor: theme.node.stroke, color: names.length ? "#8ab4d8" : theme.node.faint }}>
                出场人物：{names.length ? names.join("、") : "（无）"}
            </div>
            <div className="shrink-0 border-t px-3 py-2 text-[10px] leading-4" style={{ borderColor: theme.node.stroke, color: propNames.length ? "#fcd34d" : theme.node.faint }}>
                出现物品：{propNames.length ? propNames.join("、") : "（无）"}
            </div>
        </div>
    );
}

/** 章节节点：标题 + 本章场 / 镜统计 + 一键折叠。 */
export function ChapterNodeContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { node, theme } = ctx;
    const meta = readDirectorMeta(node);
    const chapterMeta = meta?.kind === "chapter" ? meta : null;
    const collapsed = Boolean(chapterMeta?.collapsed);

    const all = ctx.getNodes();
    const scenes = all.filter((item) => {
        const sceneMeta = readDirectorMeta(item);
        return sceneMeta?.kind === "scene" && (sceneMeta as DirectorSceneMeta).chapterNodeId === node.id;
    });
    const sceneIds = new Set(scenes.map((item) => item.id));
    const shots = all.filter((item) => {
        const shotMeta = readDirectorMeta(item);
        return shotMeta?.kind === "shot" && sceneIds.has(shotMeta.sceneNodeId);
    });

    const toggle = () => {
        if (!chapterMeta) return;
        const next = !collapsed;
        ctx.applyOps([
            { type: "update_node", id: node.id, metadata: { directorMeta: { ...chapterMeta, collapsed: next } } },
            ...[...scenes, ...shots].map((item) => ({ type: "update_node" as const, id: item.id, metadata: { hidden: next } })),
        ]);
    };

    return (
        <div className="flex h-full w-full select-none flex-col justify-between p-3.5">
            <div className="min-w-0">
                <div className="text-[10px] font-medium uppercase tracking-wider" style={{ color: theme.node.faint }}>
                    第 {chapterMeta?.order ?? "?"} 章
                </div>
                <div className="mt-1 line-clamp-3 text-[14px] font-semibold leading-6" style={{ color: theme.node.text }}>
                    {node.title}
                </div>
                <div className="mt-1.5 text-[10px]" style={{ color: theme.node.muted }}>
                    {scenes.length} 场 · {shots.length} 镜
                </div>
            </div>
            <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                    event.stopPropagation();
                    toggle();
                }}
                disabled={!scenes.length}
                className="mt-2 flex items-center gap-1.5 self-start rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition hover:scale-[1.02] disabled:opacity-50"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            >
                {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                {collapsed ? "展开本章" : "折叠本章"}
            </button>
        </div>
    );
}
