/**
 * 导演台输出解析。
 *
 * 模型输出的是「标签：值」的纯文本，这里解析回结构化数据。
 * 设计上对模型的格式抖动尽量宽容（多余空行、代码块围栏、字段顺序错乱都能吃下），
 * 因为字段多、模型偶尔会漏字段或改顺序。
 */

import { CHARACTER_FIELDS, parseFields, SCENE_FIELDS, SCENE_CHARACTERS_LABEL, SHOT_FIELDS } from "@/lib/director/spec";
import type { DirectorCharacterTier } from "@/types/canvas";

export type ParsedCharacter = {
    tier: DirectorCharacterTier;
    name: string;
    values: Record<string, string>;
};

export type ParsedShot = {
    values: Record<string, string>;
};

export type ParsedScene = {
    values: Record<string, string>;
    /** 该场出场人物名（回连人物节点用）。 */
    characterNames: string[];
    /** 本场造型。 */
    look: string;
    shots: ParsedShot[];
};

const TIER_LABEL = "分级";
const FENCE = /^[ \t]*```[a-z]*[ \t]*$/gim;

function normalize(raw: string) {
    return (raw || "").replace(/\r\n/g, "\n").replace(FENCE, "").trim();
}

/** 按整行的分隔符切块。 */
function splitBlocks(text: string, marker: RegExp) {
    return text
        .split(marker)
        .map((block) => block.trim())
        .filter(Boolean);
}

// 分隔符允许后面跟说明文字：模型按提示词输出的是「--- 分镜」「=== 场景」这种带标题的形式。
const BLOCK_SEPARATOR = /^[ \t]*-{3,}.*$/m;
const SCENE_SEPARATOR = /^[ \t]*={3,}.*$/m;

/** 解析人物表。 */
export function parseCharacters(raw: string): ParsedCharacter[] {
    const text = normalize(raw);
    if (!text) return [];

    return splitBlocks(text, BLOCK_SEPARATOR)
        .map((block): ParsedCharacter | null => {
            const tierMatch = block.match(/^[ \t]*分级[：:]\s*(.*)$/m);
            const tierText = tierMatch ? tierMatch[1].trim() : "";
            const tier: DirectorCharacterTier = /主角/.test(tierText) ? "main" : "support";
            const body = tierMatch ? block.replace(tierMatch[0], "") : block;
            const values = parseFields(CHARACTER_FIELDS, body);
            const name = (values.name || "").trim();
            return name ? { tier, name, values } : null;
        })
        .filter((item): item is ParsedCharacter => Boolean(item));
}

/**
 * 解析场景与分镜。
 *
 * 结构：`===` 分隔场景；场景块内 `---` 分隔——第一段是场景字段，其余每段是一个分镜。
 */
export function parseScenesAndShots(raw: string): ParsedScene[] {
    const text = normalize(raw);
    if (!text) return [];

    return splitBlocks(text, SCENE_SEPARATOR)
        .map((sceneBlock): ParsedScene | null => {
            const parts = splitBlocks(sceneBlock, BLOCK_SEPARATOR);
            if (!parts.length) return null;

            const [scenePart, ...shotParts] = parts;
            const characterMatch = scenePart.match(new RegExp(`^[ \\t]*${SCENE_CHARACTERS_LABEL}[：:]\\s*(.*)$`, "m"));
            const characterNames = characterMatch
                ? characterMatch[1]
                      .split(/[、,，\/]/)
                      .map((name) => name.trim())
                      .filter((name) => name && name !== "无")
                : [];
            const sceneBody = characterMatch ? scenePart.replace(characterMatch[0], "") : scenePart;
            const values = parseFields(SCENE_FIELDS, sceneBody);

            const shots = shotParts
                .map((shotPart): ParsedShot | null => {
                    const shotValues = parseFields(SHOT_FIELDS, shotPart);
                    // 画面和景别都没有，基本是模型多吐的空块，丢掉
                    return shotValues.visual || shotValues.shotSize ? { values: shotValues } : null;
                })
                .filter((item): item is ParsedShot => Boolean(item));

            if (!values.name && !shots.length) return null;
            return { values, characterNames, look: (values.look || "").trim(), shots };
        })
        .filter((item): item is ParsedScene => Boolean(item));
}

/** 解析「出场人物」这类用「、」分隔的名单。 */
export function parseNameList(value: string): string[] {
    return (value || "")
        .split(/[、,，\/]/)
        .map((name) => name.trim())
        .filter((name) => name && name !== "无");
}
