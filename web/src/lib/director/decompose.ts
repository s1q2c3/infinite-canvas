/**
 * 导演台拆解编排。
 *
 * 两步走：
 *   ① 提取资产 —— 逐章拆出「人物 / 场景 / 重要物品」，长篇小说再把人物与物品合并去重
 *   ② 拆分镜 —— 场景已经定好，逐章只为这些场景写分镜
 *
 * 为什么逐章：整本一次喂会超上下文、质量明显掉；而且逐章拆可以只重拆某一章。
 * 为什么场景放在第一步：场景和人物、物品一样是跨场景的资产，先定下来用户才好审；
 * 而且第二步不用再重新判定场景，避免两次拆解切出来的场景对不上。
 */

import type { RawChapter } from "@/lib/director/novel-split";
import { parseAssets, parseShotsByScene, type ParsedAssets, type ParsedScene, type ParsedShotGroup } from "@/lib/director/parse";
import { buildAssetExtractPrompt, buildAssetMergePrompt, buildShotPrompt, DIRECTOR_SYSTEM_PROMPT } from "@/lib/director/prompts";
import type { AssetBundle, AssetChapter } from "@/lib/director/layout";

export type GenerateText = (prompt: string, options?: { system?: string; model?: string; signal?: AbortSignal }) => Promise<string>;

export type DirectorProgress = { current: number; total: number; label: string };

export type ExtractAssetsOptions = {
    model: string;
    onProgress?: (event: DirectorProgress) => void;
    signal?: AbortSignal;
};

/**
 * 第一步：逐章拆出人物 / 场景 / 重要物品。
 *
 * 场景按章归属、按剧情顺序拼接，不做跨章合并 —— 同一地点在不同时间是不同场景。
 * 人物和物品是跨章资产，多章时要再跑一次合并去重（「小满 / 林小满」得合成一个人）。
 */
export async function extractAssets(chapters: RawChapter[], generateText: GenerateText, options: ExtractAssetsOptions): Promise<AssetBundle> {
    const { model, onProgress, signal } = options;
    if (!chapters.length) return { characters: [], props: [], chapters: [] };

    const call = (prompt: string) => generateText(prompt, { system: DIRECTOR_SYSTEM_PROMPT, model, signal });
    const rawOutputs: string[] = [];
    const perChapter: Array<{ title: string; text: string; assets: ParsedAssets }> = [];

    for (let index = 0; index < chapters.length; index += 1) {
        const chapter = chapters[index];
        onProgress?.({ current: index, total: chapters.length + 1, label: `提取资产 · ${chapter.title}` });
        const raw = await call(buildAssetExtractPrompt(chapter.title, chapter.body));
        rawOutputs.push(raw);
        perChapter.push({ title: chapter.title, text: chapter.body, assets: parseAssets(raw) });
    }

    let characters = perChapter.flatMap((chapter) => chapter.assets.characters);
    let props = perChapter.flatMap((chapter) => chapter.assets.props);

    // 多章时合并人物与物品；单章没有重复，不用多花一次调用
    if (perChapter.length > 1 && (characters.length || props.length)) {
        onProgress?.({ current: chapters.length, total: chapters.length + 1, label: "合并人物与物品去重" });
        const merged = parseAssets(await call(buildAssetMergePrompt(rawOutputs)));
        // 合并结果为空（模型没按格式回）时保留未合并版本，至少不让用户白跑
        if (merged.characters.length) characters = merged.characters;
        if (merged.props.length) props = merged.props;
        // 场景不采用合并结果：逐章解析出来的顺序和章节归属更可靠
    }

    const chapterList: AssetChapter[] = perChapter.map((chapter) => ({ title: chapter.title, text: chapter.text, scenes: chapter.assets.scenes }));
    onProgress?.({ current: chapters.length + 1, total: chapters.length + 1, label: "提取完成" });

    return { characters, props, chapters: chapterList };
}

export type ShotDecomposeOptions = {
    model: string;
    /** 人物表文本（用节点上的当前内容，用户可能改过）。 */
    roster: string;
    /** 每章的场景（来自第一步），用来告诉模型这场已经定好了。 */
    scenesByChapter: ParsedScene[][];
    shotsPerScene: number;
    onProgress?: (event: DirectorProgress) => void;
    signal?: AbortSignal;
    /** 只拆指定章节（下标）；不传则全部。 */
    only?: number[];
};

export type ChapterShotGroups = { chapterIndex: number; chapterTitle: string; groups: ParsedShotGroup[] };

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
export async function decomposeShots(chapters: RawChapter[], generateText: GenerateText, options: ShotDecomposeOptions): Promise<ChapterShotGroups[]> {
    const { model, roster, scenesByChapter, shotsPerScene, onProgress, signal, only } = options;
    const targets = chapters.map((chapter, index) => ({ chapter, index })).filter((item) => !only?.length || only.includes(item.index));
    const results: ChapterShotGroups[] = [];

    for (let order = 0; order < targets.length; order += 1) {
        const { chapter, index } = targets[order];
        const scenes = scenesByChapter[index] || [];
        onProgress?.({ current: order, total: targets.length, label: chapter.title });

        if (!scenes.length) {
            results.push({ chapterIndex: index, chapterTitle: chapter.title, groups: [] });
            onProgress?.({ current: order + 1, total: targets.length, label: chapter.title });
            continue;
        }

        const raw = await generateText(
            buildShotPrompt({ chapterTitle: chapter.title, chapterText: chapter.body, sceneList: formatSceneList(scenes), roster, shotsPerScene }),
            { system: DIRECTOR_SYSTEM_PROMPT, model, signal },
        );
        results.push({ chapterIndex: index, chapterTitle: chapter.title, groups: parseShotsByScene(raw) });
        onProgress?.({ current: order + 1, total: targets.length, label: chapter.title });
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
