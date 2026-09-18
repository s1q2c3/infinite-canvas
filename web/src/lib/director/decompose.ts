/**
 * 导演台拆解编排。
 *
 * 两步走：
 *   ① 提取人物 —— 长篇分章提取后合并去重，短篇一次到位
 *   ② 拆解场景与分镜 —— 逐章调用，读用户改过的人物表作为上下文
 *
 * 为什么逐章拆：整本一次喂会超上下文，质量也会明显掉；而且逐章拆可以只重拆某一章。
 */

import type { RawChapter } from "@/lib/director/novel-split";
import { parseCharacters, parseScenesAndShots, type ParsedCharacter, type ParsedScene } from "@/lib/director/parse";
import { buildCharacterExtractPrompt, buildCharacterMergePrompt, buildSceneShotPrompt, DIRECTOR_SYSTEM_PROMPT } from "@/lib/director/prompts";

export type GenerateText = (prompt: string, options?: { system?: string; model?: string; signal?: AbortSignal }) => Promise<string>;

export type DirectorProgress = { current: number; total: number; label: string };

/** 低于这个字数就一次提取人物，不必分章再合并。 */
const SINGLE_PASS_CHARS = 12000;

export type ExtractCharactersOptions = {
    model: string;
    onProgress?: (event: DirectorProgress) => void;
    signal?: AbortSignal;
};

/**
 * 第一步：提取人物。
 *
 * 短篇（总量 < SINGLE_PASS_CHARS）一次到位；长篇分章提取，再跑一次合并去重
 * —— 同一个人在不同章可能写成「小满」「林小满」，不合并就会被拆成两个人。
 */
export async function extractCharacters(chapters: RawChapter[], generateText: GenerateText, options: ExtractCharactersOptions): Promise<ParsedCharacter[]> {
    const { model, onProgress, signal } = options;
    if (!chapters.length) return [];

    const totalChars = chapters.reduce((sum, chapter) => sum + chapter.body.length, 0);
    const call = (prompt: string) => generateText(prompt, { system: DIRECTOR_SYSTEM_PROMPT, model, signal });

    if (totalChars <= SINGLE_PASS_CHARS || chapters.length === 1) {
        onProgress?.({ current: 0, total: 1, label: "提取人物" });
        const characters = parseCharacters(await call(buildCharacterExtractPrompt("全文", chapters.map((chapter) => `${chapter.title}\n${chapter.body}`).join("\n\n"))));
        onProgress?.({ current: 1, total: 1, label: "提取人物" });
        return characters;
    }

    const partials: string[] = [];
    for (let index = 0; index < chapters.length; index += 1) {
        const chapter = chapters[index];
        onProgress?.({ current: index, total: chapters.length + 1, label: `提取人物 · ${chapter.title}` });
        const text = await call(buildCharacterExtractPrompt(chapter.title, chapter.body));
        if (text.trim()) partials.push(text);
    }

    if (partials.length <= 1) return parseCharacters(partials[0] || "");

    onProgress?.({ current: chapters.length, total: chapters.length + 1, label: "合并人物去重" });
    const merged = parseCharacters(await call(buildCharacterMergePrompt(partials)));
    onProgress?.({ current: chapters.length + 1, total: chapters.length + 1, label: "合并人物去重" });

    // 合并结果为空（模型没按格式回）时退回未合并版本，至少不让用户白跑
    return merged.length ? merged : parseCharacters(partials.join("\n\n---\n\n"));
}

export type ChapterScenes = {
    title: string;
    text: string;
    scenes: ParsedScene[];
};

export type DecomposeScenesOptions = {
    model: string;
    /** 人物表文本（用节点上的当前内容，用户可能改过）。 */
    roster: string;
    shotsPerChapter: number;
    onProgress?: (event: DirectorProgress) => void;
    signal?: AbortSignal;
    /** 只拆指定章节（下标）；不传则全部。 */
    only?: number[];
};

/** 第二步：逐章拆解场景与分镜。 */
export async function decomposeScenes(chapters: RawChapter[], generateText: GenerateText, options: DecomposeScenesOptions): Promise<ChapterScenes[]> {
    const { model, roster, shotsPerChapter, onProgress, signal, only } = options;
    const targets = only?.length ? chapters.filter((_, index) => only.includes(index)) : chapters;
    const results: ChapterScenes[] = [];

    for (let index = 0; index < targets.length; index += 1) {
        const chapter = targets[index];
        onProgress?.({ current: index, total: targets.length, label: chapter.title });
        const text = await generateText(buildSceneShotPrompt({ chapterTitle: chapter.title, chapterText: chapter.body, roster, shotsPerChapter }), {
            system: DIRECTOR_SYSTEM_PROMPT,
            model,
            signal,
        });
        results.push({ title: chapter.title, text: chapter.body, scenes: parseScenesAndShots(text) });
        onProgress?.({ current: index + 1, total: targets.length, label: chapter.title });
    }

    return results;
}

/** 把人物节点上的当前文字拼成人物表，供第二步作为上下文。 */
export function buildRoster(entries: { name: string; text: string }[]): string {
    return entries
        .filter((entry) => entry.text.trim())
        .map((entry) => entry.text.trim())
        .join("\n---\n");
}
