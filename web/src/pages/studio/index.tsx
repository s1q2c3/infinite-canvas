import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Clapperboard, Film, LayoutGrid, PenLine, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";

import { StepArt } from "@/components/studio/step-art";
import { StepFilm } from "@/components/studio/step-film";
import { StepScript } from "@/components/studio/step-script";
import { StepStoryboard } from "@/components/studio/step-storyboard";
import { DIRECTOR_NODE_TYPE } from "@/lib/director/layout";
import { runSelfCheck, summarizeIssues } from "@/lib/director/self-check";
import { useDirectorFlow } from "@/pages/studio/use-director-flow";
import { useStudio } from "@/pages/studio/use-studio";
import type { DirectorStage } from "@/types/canvas";

const STEPS: { key: DirectorStage; label: string; icon: typeof PenLine }[] = [
    { key: "script", label: "剧本", icon: PenLine },
    { key: "art", label: "设定", icon: LayoutGrid },
    { key: "storyboard", label: "分镜", icon: Clapperboard },
    { key: "film", label: "短片", icon: Film },
];

/**
 * 导演台工作台。
 *
 * 主界面不再是画布：四步流水线（剧本 → 设定 → 分镜 → 短片），每步一个整页。
 * 数据仍然是画布节点 —— 「画布编辑」按钮切回无限画布看同一份数据。
 */
export default function StudioPage() {
    const { id = "" } = useParams();
    const navigate = useNavigate();
    const studio = useStudio(id);
    const flow = useDirectorFlow(studio);
    const [stage, setStage] = useState<DirectorStage>("script");
    const [issues, setIssues] = useState<string>("");
    const seededRef = useRef(false);
    const stageSeededRef = useRef(false);

    // 一个画布 = 一个项目：没有导演台节点就自动建一个
    useEffect(() => {
        if (!studio.ready || studio.directorNode || seededRef.current) return;
        seededRef.current = true;
        studio.applyOps([
            {
                type: "add_node",
                nodeType: DIRECTOR_NODE_TYPE,
                title: "导演台",
                x: 0,
                y: 0,
                metadata: { content: "", status: "idle", director: { model: studio.ai.defaultModel("text"), step: "idle", stage: "script" } },
            },
        ]);
    }, [studio]);

    // 从项目里恢复上次停在哪一步（只做一次，之后以用户点击为准）
    useEffect(() => {
        const saved = flow.state?.stage;
        if (!saved || stageSeededRef.current) return;
        stageSeededRef.current = true;
        setStage(saved);
    }, [flow.state?.stage]);

    const goto = (next: DirectorStage) => {
        setStage(next);
        flow.save({ stage: next });
    };

    const check = () => {
        const result = runSelfCheck(flow.collection);
        setIssues(result.length ? `${summarizeIssues(result)}　${result.slice(0, 3).map((issue) => `[${issue.scope}] ${issue.message}`).join("；")}` : "没有发现问题。");
    };

    if (!studio.ready) {
        return <main className="grid h-full place-items-center bg-[#0b0b0e] text-sm text-stone-400">正在加载工作台…</main>;
    }

    return (
        <main className="flex h-full min-h-0 flex-col bg-[#0b0b0e] text-stone-100">
            <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-5 py-3">
                <button type="button" onClick={() => navigate("/canvas")} className="grid size-8 place-items-center rounded-lg text-stone-400 hover:bg-white/10 hover:text-stone-100" title="返回项目列表">
                    <ChevronLeft className="size-4" />
                </button>
                <span className="text-sm font-semibold">{studio.projectTitle || "未命名项目"}</span>
                <span className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-stone-400">导演台</span>

                <nav className="mx-auto flex items-center gap-1">
                    {STEPS.map((step, index) => {
                        const Icon = step.icon;
                        const active = stage === step.key;
                        return (
                            <div key={step.key} className="flex items-center">
                                {index ? <span className="mx-1 h-px w-5 bg-white/15" /> : null}
                                <button
                                    type="button"
                                    onClick={() => goto(step.key)}
                                    className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition ${active ? "bg-white text-stone-900" : "text-stone-400 hover:bg-white/10 hover:text-stone-100"}`}
                                >
                                    <Icon className="size-3.5" />
                                    {step.label}
                                </button>
                            </div>
                        );
                    })}
                </nav>

                <div className="flex items-center gap-2">
                    <button type="button" onClick={check} className="flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] text-stone-300 hover:bg-white/10" title="一致性自检">
                        <ShieldCheck className="size-3.5" />
                        自检
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            if (window.confirm("将删除所有导演台生成的节点（角色 / 场次 / 物品 / 分镜）。你自己建的节点不受影响。确定继续吗？")) flow.clearAll();
                        }}
                        className="grid size-8 place-items-center rounded-lg border border-white/15 text-stone-400 hover:bg-white/10 hover:text-red-400"
                        title="清空拆解结果"
                    >
                        <Trash2 className="size-3.5" />
                    </button>
                    <button type="button" onClick={() => navigate(`/canvas/${id}`)} className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-stone-300 hover:bg-white/10">
                        画布编辑
                    </button>
                </div>
            </header>

            {flow.busy && flow.progress ? (
                <div className="shrink-0 border-b border-white/10 px-5 py-2">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-stone-400">
                        <span>{flow.progress.label}</span>
                        <button type="button" onClick={flow.abort} className="text-stone-400 hover:text-red-400">
                            中止
                        </button>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${flow.progress.total ? (flow.progress.current / flow.progress.total) * 100 : 0}%` }} />
                    </div>
                </div>
            ) : null}

            {issues ? (
                <div className="shrink-0 border-b border-white/10 bg-white/5 px-5 py-2 text-[11px] text-stone-300">
                    <span className="mr-2 text-stone-400">自检：</span>
                    {issues}
                    <button type="button" onClick={() => setIssues("")} className="ml-3 text-stone-500 hover:text-stone-300">
                        关闭
                    </button>
                </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-auto">
                {stage === "script" ? <StepScript studio={studio} flow={flow} onDone={() => goto("art")} /> : null}
                {stage === "art" ? <StepArt studio={studio} flow={flow} onNext={() => goto("storyboard")} onBack={() => goto("script")} /> : null}
                {stage === "storyboard" ? <StepStoryboard studio={studio} flow={flow} onNext={() => goto("film")} onBack={() => goto("art")} /> : null}
                {stage === "film" ? <StepFilm studio={studio} flow={flow} onBack={() => goto("storyboard")} /> : null}
            </div>
        </main>
    );
}
