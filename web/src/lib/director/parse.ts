/**
 * 导演台输出解析。
 *
 * 第一步输出三个区块（### 人物 / ### 场景 / ### 物品），区块内条目用 --- 分隔。
 * 第二步输出按场景分组的镜头（=== 场景名，场景内用 --- 分镜）。
 *
 * 对模型的格式抖动尽量宽容（多余空行、代码块围栏、字段顺序错乱都能吃下），
 * 因为字段多、模型偶尔会漏字段或改顺序。
 */

import { CHARACTER_FIELDS, parseFields, PROP_FIELDS, SCENE_FIELDS, SCENE_CHARACTERS_LABEL, SCENE_PROPS_LABEL, SHOT_FIELDS } from "@/lib/director/spec";
import type { DirectorCharacterTier } from "@/types/canvas";

export type ParsedCharacter = {
    tier: DirectorCharacterTier;
    name: string;
    values: Record<string, string>;
};

export type ParsedProp = {
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
    /** 该场出现的重要物品名（回连物品节点用）。 */
    propNames: string[];
    /** 本场造型。 */
    look: string;
    /** 第二步才填：该场的分镜。 */
    shots: ParsedShot[];
};

export type ParsedAssets = {
    characters: ParsedCharacter[];
    scenes: ParsedScene[];
    props: ParsedProp[];
};

const TIER_LABEL = "分级";
const FENCE = /^[ \t]*```[a-z]*[ \t]*$/gim;

// 分隔符允许后面跟说明文字：模型按提示词输出的是「--- 分镜」「=== 场景」这种带标题的形式。
const ITEM_SEPARATOR = /^[ \t]*-{3,}.*$/m;
const SECTION_SEPARATOR = /^[ \t]*#{2,}[ \t]*(.+?)[ \t]*$/m;
const SCENE_SEPARATOR = /^[ \t]*={3,}[ \t]*(.*)$/m;

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

/** 解析「出场人物」这类用「、」分隔的名单。 */
export function parseNameList(value: string): string[] {
    return (value || "")
        .split(/[、,，\/]/)
        .map((name) => name.trim())
        .filter((name) => name && name !== "无");
}

function parseCharacterSection(text: string): ParsedCharacter[] {
    return splitBlocks(text, ITEM_SEPARATOR)
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

function parsePropSection(text: string): ParsedProp[] {
    return splitBlocks(text, ITEM_SEPARATOR)
        .map((block): ParsedProp | null => {
            const values = parseFields(PROP_FIELDS, block);
            const name = (values.name || "").trim();
            return name ? { name, values } : null;
        })
        .filter((item): item is ParsedProp => Boolean(item));
}

function parseSceneSection(text: string): ParsedScene[] {
    return splitBlocks(text, ITEM_SEPARATOR)
        .map((block): ParsedScene | null => {
            const characterMatch = block.match(new RegExp(`^[ \\t]*${SCENE_CHARACTERS_LABEL}[：:]\\s*(.*)$`, "m"));
            const propMatch = block.match(new RegExp(`^[ \\t]*${SCENE_PROPS_LABEL}[：:]\\s*(.*)$`, "m"));
            const characterNames = characterMatch ? parseNameList(characterMatch[1]) : [];
            const propNames = propMatch ? parseNameList(propMatch[1]) : [];
            const body = block.replace(characterMatch?.[0] || "", "").replace(propMatch?.[0] || "", "");
            const values = parseFields(SCENE_FIELDS, body);
            if (!values.name && !values.location) return null;
            return { values, characterNames, propNames, look: (values.look || "").trim(), shots: [] };
        })
        .filter((item): item is ParsedScene => Boolean(item));
}

/** 第一步：解析「人物 / 场景 / 物品」三类资产。 */
export function parseAssets(raw: string): ParsedAssets {
    const text = normalize(raw);
    if (!text) return { characters: [], scenes: [], props: [] };

    const parts = text.split(SECTION_SEPARATOR);
    const sections: Array<{ title: string; body: string }> = [];
    for (let index = 1; index < parts.length; index += 2) {
        sections.push({ title: (parts[index] || "").trim(), body: (parts[index + 1] || "").trim() });
    }

    // 模型没按区块标记输出时的兜底：整段当人物表解析，至少不让用户白跑一次
    if (!sections.length) return { characters: parseCharacterSection(text), scenes: [], props: [] };

    const assets: ParsedAssets = { characters: [], scenes: [], props: [] };
    sections.forEach((section) => {
        if (/人物/.test(section.title)) assets.characters.push(...parseCharacterSection(section.body));
        else if (/场景/.test(section.title)) assets.scenes.push(...parseSceneSection(section.body));
        else if (/物品|道具/.test(section.title)) assets.props.push(...parsePropSection(section.body));
    });

    return assets;
}

export type ParsedShotGroup = { sceneName: string; shots: ParsedShot[] };

/** 第二步：解析按场景分组的镜头。 */
export function parseShotsByScene(raw: string): ParsedShotGroup[] {
    const text = normalize(raw);
    if (!text) return [];

    const parts = text.split(SCENE_SEPARATOR);
    const groups: ParsedShotGroup[] = [];

    for (let index = 1; index < parts.length; index += 2) {
        // 「=== 场景：便利店门口」这种写法要把前缀去掉，只留名字
        const sceneName = (parts[index] || "").replace(/^[ \t]*场景[：:]?[ \t]*/, "").trim();
        const body = parts[index + 1] || "";
        const shots = splitBlocks(body, ITEM_SEPARATOR)
            .map((block): ParsedShot | null => {
                const values = parseFields(SHOT_FIELDS, block);
                // 画面和景别都没有，基本是模型多吐的空块，丢掉
                return values.visual || values.shotSize ? { values } : null;
            })
            .filter((item): item is ParsedShot => Boolean(item));
        if (sceneName || shots.length) groups.push({ sceneName, shots });
    }

    return groups;
}
