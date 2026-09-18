/**
 * 导演台拆解编排。
 *
 * 两步走：
 *   ① 提取资产 —— 逐段拆出「人物 / 场景 / 重要物品」，长篇再把人物与物品合并去重
 *   ② 拆分镜 —— 场景已经定好，逐段只为这些场景写分镜
 *
 * 为什么逐段：整本一次喂会超上下文、质量明显掉；而且逐段拆可以只重拆某一段。
 * 「段」的含义由输入类型决定：小说按章，剧本按场。
 * 为什么场景放在第一步：场景和人物、物品一样是跨场景的资产，先定下来用户才好审；
 * 而且第二步不用再重新判定场景，避免两次拆解切出来的场景对不上。
 */

import { parseAssets, parseShotsByScene, type ParsedAssets, type ParsedScene, type ParsedShotGroup } from "@/lib/director/parse";
import { buildAssetExtractPrompt, buildAssetMergePrompt, buildShotPrompt, DIRECTOR_SYSTEM_PROMPT } from "@/lib/director/prompts";
import type { RawSegment } from "@/lib/director/script-parse";
import type { AssetBundle, AssetSegment } from "@/lib/director/layout";
import type { DirectorScriptKind } from "@/types/canvas";

export type GenerateText = (prompt: string, options?: { system?: string; model?: string; signal?: AbortSignal }) => Promise<string>;

export type DirectorProgress = { current: number; total: number; label: string };

export type ExtractAssetsOptions = {
    model: string;
    /** 输入是小说还是剧本，决定提示词与场次切法。 */
    kind?: DirectorScriptKind;
    onProgress?: (event: DirectorProgress) => void;
    signal?: AbortSignal;
};

/**
 * 第一步：逐段拆出人物 / 场景 / 重要物品。
 *
 * 场景按段归属、按剧情顺序拼接，不做跨段合并 —— 同一地点在不同时间是不同场景。
 * 人物和物品是跨段资产，多段时要再跑一次合并去重（「小满 / 林小满」得合成一个人）。
 */
export async function extractAssets(segments: RawSegment[], generateText: GenerateText, options: ExtractAssetsOptions): Promise<AssetBundle> {
    const { model, kind = "novel", onProgress, signal } = options;
    if (!segments.length) return { characters: [], props: [], segments: [] };

    const call = (prompt: string) => generateText(prompt, { system: DIRECTOR_SYSTEM_PROMPT, model, signal });
    const rawOutputs: string[] = [];
    const perSegment: Array<{ title: string; text: string; assets: ParsedAssets }> = [];

    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        onProgress?.({ current: index, total: segments.length + 1, label: `提取资产 · ${segment.title}` });
        const raw = await call(buildAssetExtractPrompt(segment.title, segment.body, kind));
        rawOutputs.push(raw);
        perSegment.push({ title: segment.title, text: segment.body, assets: parseAssets(raw) });
    }

    let characters = perSegment.flatMap((segment) => segment.assets.characters);
    let props = perSegment.flatMap((segment) => segment.assets.props);

    // 多段时合并人物与物品；单段没有重复，不用多花一次调用
    if (perSegment.length > 1 && (characters.length || props.length)) {
        onProgress?.({ current: segments.length, total: segments.length + 1, label: "合并人物与物品去重" });
        const merged = parseAssets(await call(buildAssetMergePrompt(rawOutputs)));
        // 合并结果为空（模型没按格式回）时保留未合并版本，至少不让用户白跑
        if (merged.characters.length) characters = merged.characters;
        if (merged.props.length) props = merged.props;
        // 场景不采用合并结果：逐段解析出来的顺序和归属更可靠
    }

    const list: AssetSegment[] = perSegment.map((segment) => ({ title: segment.title, text: segment.text, scenes: segment.assets.scenes }));
    onProgress?.({ current: segments.length + 1, total: segments.length + 1, label: "提取完成" });

    return { characters, props, segments: list };
}

export type ShotDecomposeOptions = {
    model: string;
    /** 人物表文本（用节点上的当前内容，用户可能改过）。 */
    roster: string;
    /** 每段的场景（来自第一步），用来告诉模型这场已经定好了。 */
    scenesBySegment: ParsedScene[][];
    shotsPerScene: number;
    onProgress?: (event: DirectorProgress) => void;
    signal?: AbortSignal;
    /** 只拆指定段（下标）；不传则全部。 */
    only?: number[];
};

export type SegmentShotGroups = { segmentIndex: number; segmentTitle: string; groups: ParsedShotGroup[] };

/** 把场景列表压成给模型看的清单（带上关键信息，模型才知道这场是什么）。 */
export function formatSceneList(scenes: ParsedScene[]) {
    return scenes
        .map((scene, index) => {
            const v = scene.values;
            const bits = [v.location && `地点：${v.location}`, v.time && `时间：${v.time}`, scene.characterNames.length && `出场：${scene.characterNames.join("、")}`].filter(Boolean);
            return `${index + 1}. ${v.name || `场景${index + 1}`}${bits.length ? ` —— ${bits.join("；")}` : ""}`;
        })
        .join("\n");
}

/** 第二步：为已定下来的场景写分镜。 */
export async function decomposeShots(segments: RawSegment[], generateText: GenerateText, options: ShotDecomposeOptions): Promise<SegmentShotGroups[]> {
    const { model, roster, scenesBySegment, shotsPerScene, onProgress, signal, only } = options;
    const targets = segments.map((segment, index) => ({ segment, index })).filter((item) => !only?.length || only.includes(item.index));
    const results: SegmentShotGroups[] = [];

    for (let order = 0; order < targets.length; order += 1) {
        const { segment, index } = targets[order];
        const scenes = scenesBySegment[index] || [];
        onProgress?.({ current: order, total: targets.length, label: segment.title });

        if (!scenes.length) {
            results.push({ segmentIndex: index, segmentTitle: segment.title, groups: [] });
            onProgress?.({ current: order + 1, total: targets.length, label: segment.title });
            continue;
        }

        const raw = await generateText(
            buildShotPrompt({ sourceTitle: segment.title, sourceText: segment.body, sceneList: formatSceneList(scenes), roster, shotsPerScene }),
            { system: DIRECTOR_SYSTEM_PROMPT, model, signal },
        );
        results.push({ segmentIndex: index, segmentTitle: segment.title, groups: parseShotsByScene(raw) });
        onProgress?.({ current: order + 1, total: targets.length, label: segment.title });
    }

    return results;
}

/** 把人物 / 物品节点上的当前文字拼成资产表，供第二步作为上下文。 */
export function buildRoster(entries: { name: string; text: string }[]): string {
    return entries
        .filter((entry) => entry.text.trim())
        .map((entry) => entry.text.trim())
        .join("\n---\n");
}
