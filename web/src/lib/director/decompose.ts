/**
 * 导演台拆解服务：逐章调用文本模型，把小说章节转成镜头脚本。
 *
 * 逐章调用而不是整本一次喂进去，原因：超长上下文会显著掉质量，
 * 而且逐章拆可以只重拆某一章。
 */

import { newDirectorId } from "@/lib/director/layout";
import type { RawChapter } from "@/lib/director/novel-split";
import { buildChapterPrompt, DIRECTOR_SYSTEM_PROMPT, parseShots } from "@/lib/director/prompts";
import type { DirectorChapter } from "@/types/canvas";

export type DirectorProgressEvent = { current: number; total: number; label: string };

export type DecomposeOptions = {
    /** 导演台独立指定的模型。 */
    model: string;
    /** 每章期望镜头数，0 表示交给模型自己判断。 */
    shotsPerChapter: number;
    onProgress?: (event: DirectorProgressEvent) => void;
    signal?: AbortSignal;
};

export type GenerateText = (prompt: string, options?: { system?: string; model?: string; signal?: AbortSignal }) => Promise<string>;

export async function decomposeChapters(raw: RawChapter[], generateText: GenerateText, options: DecomposeOptions): Promise<DirectorChapter[]> {
    const chapters: DirectorChapter[] = [];
    const shotHint = options.shotsPerChapter > 0 ? `每章大约 ${options.shotsPerChapter} 个镜头` : "一般 5-15 个镜头，视内容而定";

    for (let index = 0; index < raw.length; index += 1) {
        const item = raw[index];
        options.onProgress?.({ current: index, total: raw.length, label: item.title });
        const text = await generateText(buildChapterPrompt(item.title, item.body, shotHint), {
            system: DIRECTOR_SYSTEM_PROMPT,
            model: options.model,
            signal: options.signal,
        });
        const shots = parseShots(text);
        chapters.push({
            id: newDirectorId("ch"),
            title: item.title,
            order: index + 1,
            shots: shots.map((content, shotIndex) => ({ id: newDirectorId("shot"), index: shotIndex + 1, content })),
            collapsed: false,
        });
        options.onProgress?.({ current: index + 1, total: raw.length, label: item.title });
    }

    return chapters;
}

/** 单独重拆一章。 */
export async function decomposeOneChapter(raw: RawChapter, generateText: GenerateText, options: DecomposeOptions): Promise<DirectorChapter> {
    const shotHint = options.shotsPerChapter > 0 ? `每章大约 ${options.shotsPerChapter} 个镜头` : "一般 5-15 个镜头，视内容而定";
    const text = await generateText(buildChapterPrompt(raw.title, raw.body, shotHint), {
        system: DIRECTOR_SYSTEM_PROMPT,
        model: options.model,
        signal: options.signal,
    });
    return {
        id: newDirectorId("ch"),
        title: raw.title,
        order: 1,
        shots: parseShots(text).map((content, shotIndex) => ({ id: newDirectorId("shot"), index: shotIndex + 1, content })),
        collapsed: false,
    };
}
