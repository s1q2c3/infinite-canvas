/**
 * 导演台提示词：把小说章节拆成可直接用于拍摄 / 生成视频的镜头脚本。
 */

export const DIRECTOR_SYSTEM_PROMPT = [
    "你是一位专业的影视分镜师，擅长把小说文本转化成可以直接执行的镜头脚本。",
    "你的输出必须严格遵守用户给定的格式，不要添加任何解释、前言、总结或 Markdown 代码块。",
].join("\n");

export function buildChapterPrompt(title: string, body: string, shotHint: string) {
    return [
        `请把下面这段小说拆解成可以直接用于拍摄或生成视频的镜头脚本。`,
        "",
        "要求：",
        "1. 按时间顺序拆解，每个镜头是一个独立、可执行的画面单元。",
        `2. 镜头数量根据内容自然决定，${shotHint}，不要为了凑数硬拆。`,
        "3. 每个镜头严格使用下面的格式（字段名和【】不要改）：",
        "",
        "镜号 N · 约 X 秒",
        "【画面】景别 + 场景 + 人物动作 + 光线氛围",
        "【台词】对白或独白，没有就写「无」",
        "【音效】环境音或配乐提示",
        "【转场】硬切 / 淡入 / 叠化",
        "",
        "4. 多个镜头之间用单独一行 --- 分隔。",
        "5. 只输出镜头内容本身，不要输出任何其它文字。",
        "",
        `章节标题：${title}`,
        "章节原文：",
        '"""',
        body,
        '"""',
    ].join("\n");
}

/** 把模型返回的文本切成一条条镜头脚本。 */
export function parseShots(raw: string): string[] {
    const text = (raw || "").replace(/\r\n/g, "\n").replace(/```[a-z]*\n?/gi, "").trim();
    if (!text) return [];

    const byDivider = text
        .split(/^[ \t]*---[ \t]*$/m)
        .map((item) => item.trim())
        .filter(Boolean);
    if (byDivider.length > 1) return byDivider;

    // 模型没按分隔符输出时，退回按「镜号」开头切分。
    const byShot = text
        .split(/\n(?=[ \t]*镜号[ \t]*\d)/)
        .map((item) => item.trim())
        .filter(Boolean);
    return byShot.length ? byShot : [text];
}
