/**
 * 输入解析：判断粘进来的是小说还是剧本，再粗切成可以分批喂给模型的段落。
 *
 * 判断先用启发式（快、零成本），最终以模型返回的 scriptKind 为准 ——
 * 这里的结果只决定用哪套提示词、怎么粗切。切分不改动原文。
 */

import { splitNovelChapters } from "@/lib/director/novel-split";
import type { DirectorScriptKind } from "@/types/canvas";

export type RawSegment = { title: string; body: string };

/** 剧本的场次标题行：「第 3 场」「场景二」「12．内景 咖啡馆」「INT. CAFE - DAY」。 */
const SCRIPT_SCENE_TITLE =
    /^[ \t　]*(第[零一二三四五六七八九十百千0-9]+场[^\n]{0,40}|场景[零一二三四五六七八九十0-9]+[^\n]{0,40}|[0-9]{1,3}[、.．]?[ \t　]*(?:内景|外景)[^\n]{0,40}|(?:INT|EXT)\.[^\n]{0,60}|[0-9]{1,3}[、.．][ \t　]*(?:日|夜)[^\n]{0,40})[ \t]*$/gim;

/** 舞台指示：内景 / 外景 / 日 / 夜 打头，出现得多基本就是剧本。 */
const STAGE_DIRECTION = /(?:^|\n)[ \t　]*(?:内景|外景|日|夜|INT\.|EXT\.)[ \t　]*(?:[·—\-–]|[ \t])/g;

/** 对白行：「角色名：台词」。 */
const DIALOGUE_LINE = /(?:^|\n)[ \t　]*[\u4e00-\u9fa5A-Za-z0-9·]{1,12}[ \t　]*[：:][ \t　]*\S/g;

/** 章节标题：「第 X 章 / 回」。 */
const CHAPTER_TITLE = /第[零一二三四五六七八九十百千0-9]+[章回]/g;

/** 启发式判断输入类型。宁可判成小说（走更保守的提示词），也不要误判成剧本。 */
export function detectScriptKind(text: string): DirectorScriptKind {
    const source = (text || "").replace(/\r\n/g, "\n").slice(0, 20000).trim();
    if (!source) return "novel";

    const sceneMarks = (source.match(SCRIPT_SCENE_TITLE) || []).length;
    const directions = (source.match(STAGE_DIRECTION) || []).length;
    const lines = source.split("\n").filter((line) => line.trim().length);
    const dialogues = (source.match(DIALOGUE_LINE) || []).length;
    const chapters = (source.match(CHAPTER_TITLE) || []).length;

    // 场次标记或舞台指示密集 → 剧本
    if (sceneMarks >= 2 || directions >= 5) return "script";
    // 对白行占比高、又几乎没有章节标题 → 剧本
    if (lines.length >= 20 && dialogues / lines.length >= 0.15 && chapters < 2) return "script";
    return "novel";
}

/** 按标题行切分；标题少于两个就返回空数组，交给调用方兜底。 */
function splitByTitle(source: string, pattern: RegExp): RawSegment[] {
    const marks: { index: number; title: string; headLength: number }[] = [];
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
        marks.push({ index: match.index, title: match[1].trim(), headLength: match[0].length });
        if (marks.length > 500) break;
        if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
    }
    if (marks.length < 2) return [];

    const segments: RawSegment[] = [];
    // 第一个标题之前的内容单独作为前言，避免丢字。
    const preface = source.slice(0, marks[0].index).trim();
    if (preface) segments.push({ title: "前言", body: preface });
    marks.forEach((mark, index) => {
        const end = index + 1 < marks.length ? marks[index + 1].index : source.length;
        const body = source.slice(mark.index + mark.headLength, end).trim();
        if (body) segments.push({ title: mark.title, body });
    });
    return segments;
}

/**
 * 粗切成可以分批喂给模型的段落。
 * 剧本按场次切；小说按章节切；都识别不到就按字数兜底（在 novel-split 里）。
 */
export function splitScriptSegments(text: string, kind: DirectorScriptKind): RawSegment[] {
    const source = (text || "").replace(/\r\n/g, "\n").trim();
    if (!source) return [];

    if (kind === "script") {
        const scenes = splitByTitle(source, SCRIPT_SCENE_TITLE);
        if (scenes.length >= 2) return scenes;
    }

    return splitNovelChapters(source);
}
