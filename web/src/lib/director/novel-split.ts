/**
 * 小说章节切分。
 *
 * 优先按「第X章 / Chapter X / 1、」这类标题行切分；识别不到标题时按字数兜底，
 * 尽量在段落边界断开。切分只是为了分批喂给模型，不改动原文。
 */

export type RawChapter = { title: string; body: string };

const CHAPTER_TITLE = /^[ \t　]*(第[零一二三四五六七八九十百千0-9]+[章回节卷][^\n]{0,40}|Chapter\s+[0-9]+[^\n]{0,40}|[0-9]{1,3}[、.][^\n]{0,30})[ \t]*$/gim;

/** 没有章节标题时，每段大约多少字切一刀。 */
const FALLBACK_CHARS = 3000;

export function splitNovelChapters(text: string): RawChapter[] {
    const source = (text || "").replace(/\r\n/g, "\n").trim();
    if (!source) return [];

    const marks: { index: number; title: string; headLength: number }[] = [];
    CHAPTER_TITLE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CHAPTER_TITLE.exec(source))) {
        marks.push({ index: match.index, title: match[1].trim(), headLength: match[0].length });
        if (marks.length > 500) break;
        if (match.index === CHAPTER_TITLE.lastIndex) CHAPTER_TITLE.lastIndex += 1;
    }

    if (marks.length >= 2) {
        const chapters: RawChapter[] = [];
        // 第一个标题之前的内容单独作为前言，避免丢字。
        const preface = source.slice(0, marks[0].index).trim();
        if (preface) chapters.push({ title: "前言", body: preface });
        marks.forEach((mark, index) => {
            const end = index + 1 < marks.length ? marks[index + 1].index : source.length;
            const body = source.slice(mark.index + mark.headLength, end).trim();
            if (body) chapters.push({ title: mark.title, body });
        });
        if (chapters.length) return chapters;
    }

    return splitByLength(source);
}

/** 没有章节标题时按字数切，尽量在段落边界断开。 */
function splitByLength(source: string): RawChapter[] {
    const paragraphs = source.split(/\n+/);
    const chapters: RawChapter[] = [];
    let buffer: string[] = [];
    let length = 0;
    let index = 1;

    const flush = () => {
        const body = buffer.join("\n").trim();
        if (body) chapters.push({ title: `第 ${index} 段`, body });
        index += 1;
        buffer = [];
        length = 0;
    };

    paragraphs.forEach((paragraph) => {
        buffer.push(paragraph);
        length += paragraph.length;
        if (length >= FALLBACK_CHARS) flush();
    });
    flush();
    return chapters;
}
