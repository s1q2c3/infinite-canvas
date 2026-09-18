import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Clapperboard } from "lucide-react";

import { collectDirectorData } from "@/lib/director/collect";
import { readDirectorState } from "@/lib/director/meta";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

/**
 * 画布上的导演台节点面板。
 *
 * 导演台的主界面已经搬到工作台（整页四步流水线：剧本 → 设定 → 分镜 → 短片），
 * 这里只留一个入口和进度概览 —— 画布编辑视图不再承载拆解流程。
 */
export function DirectorPanel({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const navigate = useNavigate();
    const { id: projectId } = useParams<{ id: string }>();
    const state = readDirectorState(ctx.node);
    const collection = collectDirectorData(ctx.getNodes(), ctx.node.id);

    const panelStyle = { background: ctx.theme.toolbar.panel, borderColor: ctx.theme.toolbar.border, color: ctx.theme.node.text };
    const inputStyle = { background: ctx.theme.node.panel, borderColor: ctx.theme.node.stroke, color: ctx.theme.node.text };

    const stages: { label: string; done: boolean; hint: string }[] = [
        { label: "① 剧本", done: Boolean(state?.sourceText), hint: state?.scriptKind === "script" ? "剧本" : "小说" },
        { label: "② 设定", done: collection.characters.length + collection.props.length + collection.scenes.length > 0, hint: `${collection.characters.length} 角色 · ${collection.scenes.length} 场次 · ${collection.props.length} 道具` },
        { label: "③ 分镜", done: collection.shots.length > 0, hint: `${collection.shots.length} 镜` },
        { label: "④ 短片", done: false, hint: "在短片页拼接成片" },
    ];

    return (
        <div className="w-[320px] rounded-2xl border p-4 shadow-2xl backdrop-blur-md" style={panelStyle} onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                    <Clapperboard className="size-4" />
                    导演台
                </div>
                <button type="button" onClick={onClose} className="rounded-lg border px-2.5 py-1 text-xs" style={inputStyle}>
                    收起
                </button>
            </div>

            <div className="flex flex-col gap-2 text-[11px]">
                {stages.map((stage) => (
                    <div key={stage.label} className="flex items-center gap-2">
                        <span className={`size-1.5 rounded-full ${stage.done ? "bg-emerald-400" : "bg-stone-600"}`} />
                        <span style={{ color: ctx.theme.node.text }}>{stage.label}</span>
                        <span className="ml-auto" style={{ color: ctx.theme.node.faint }}>
                            {stage.hint}
                        </span>
                    </div>
                ))}
            </div>

            <button
                type="button"
                onClick={() => {
                    onClose();
                    navigate(`/canvas/${projectId}/studio`);
                }}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold"
                style={{ ...inputStyle, borderColor: "#7c5cff", color: "#c4b5fd" }}
            >
                打开导演台工作台
                <ArrowRight className="size-3.5" />
            </button>

            <p className="mt-2 text-[10px] leading-4" style={{ color: ctx.theme.node.faint }}>
                拆解、审核、生成、拼成片都在工作台里做；这里的节点和画布共享同一份数据。
            </p>
        </div>
    );
}
