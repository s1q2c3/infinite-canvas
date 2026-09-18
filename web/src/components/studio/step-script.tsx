import { useEffect, useMemo, useState } from "react";
import { ArrowRight, FileUp, Loader2, Wand2 } from "lucide-react";

import { detectScriptKind, splitScriptSegments } from "@/lib/director/script-parse";
import type { DirectorFlow } from "@/pages/studio/use-director-flow";
import type { StudioData } from "@/pages/studio/use-studio";
import type { DirectorScriptKind } from "@/types/canvas";

/** STEP 01 · 剧本：粘贴文本 → 自动判断小说 / 剧本 → 切段 → 拆资产。 */
export function StepScript({ studio, flow, onDone }: { studio: StudioData; flow: DirectorFlow; onDone: () => void }) {
    const [text, setText] = useState(flow.state?.sourceText || "");
    const [kind, setKind] = useState<DirectorScriptKind>(flow.state?.scriptKind || "novel");
    const [kindTouched, setKindTouched] = useState(Boolean(flow.state?.scriptKind));
    const [model, setModel] = useState(flow.state?.model || studio.ai.defaultModel("text"));
    const models = useMemo(() => studio.ai.listModels("text"), [studio.ai]);

    useEffect(() => {
        if (flow.state?.sourceText) setText(flow.state.sourceText);
    }, [flow.state?.sourceText]);

    // 用户没手动改过类型时，跟着文本自动判断
    const detected = text.trim() ? detectScriptKind(text) : "novel";
    const effectiveKind: DirectorScriptKind = kindTouched ? kind : detected;
    const segments = useMemo(() => (text.trim() ? splitScriptSegments(text, effectiveKind) : []), [effectiveKind, text]);
    const extracted = flow.collection.characters.length + flow.collection.props.length + flow.collection.scenes.length > 0;

    return (
        <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-4 px-6 py-6">
            <header>
                <h2 className="text-base font-semibold">STEP 01 · 剧本</h2>
                <p className="mt-1 text-xs text-stone-400">粘贴小说或剧本，系统自动判断类型并按章 / 按场切分，然后一次拆出角色、场次与重要物品。</p>
            </header>

            <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="text-stone-400">判定为</span>
                <div className="flex rounded-lg border border-white/15 p-0.5">
                    {(["novel", "script"] as const).map((item) => (
                        <button
                            key={item}
                            type="button"
                            onClick={() => {
                                setKind(item);
                                setKindTouched(true);
                            }}
                            className={`rounded-md px-3 py-1 text-[11px] font-medium transition ${effectiveKind === item ? "bg-white text-stone-900" : "text-stone-400 hover:text-stone-100"}`}
                        >
                            {item === "novel" ? "小说" : "剧本"}
                        </button>
                    ))}
                </div>
                <span className="text-stone-500">切出 {segments.length} 段{segments.length ? `：${segments.slice(0, 3).map((segment) => segment.title).join("、")}${segments.length > 3 ? " …" : ""}` : ""}</span>

                <span className="ml-auto text-stone-400">模型</span>
                <select value={model} onChange={(event) => setModel(event.target.value)} className="max-w-52 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-[11px] text-stone-100 outline-none">
                    {!model ? <option value="">（未配置文本模型）</option> : null}
                    {models.map((item) => (
                        <option key={item.value} value={item.value} className="bg-stone-900">
                            {item.label}
                        </option>
                    ))}
                </select>
            </div>

            <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="在这里粘贴小说或剧本全文。可以是一章、一场，也可以整本贴进来 —— 系统会按「第 X 章」或剧本的场次标记自动切段。"
                className="thin-scrollbar min-h-64 flex-1 resize-none rounded-xl border border-white/15 bg-white/5 p-4 text-[12px] leading-6 text-stone-100 outline-none placeholder:text-stone-600"
            />

            <div className="flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    disabled={flow.busy || !text.trim()}
                    onClick={() => void flow.runExtract(text, effectiveKind, model)}
                    className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
                >
                    {flow.busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
                    {extracted ? "重新拆解资产" : "拆解资产"}
                </button>
                <button
                    type="button"
                    disabled={!extracted}
                    onClick={onDone}
                    className="flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-xs text-stone-200 hover:bg-white/10 disabled:opacity-40"
                >
                    进入下一步
                    <ArrowRight className="size-3.5" />
                </button>
                <span className="text-[11px] text-stone-500">重新拆解会清掉上一次的角色 / 场次 / 物品 / 分镜</span>
            </div>

            {flow.error ? <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">{flow.error}</div> : null}
        </div>
    );
}
