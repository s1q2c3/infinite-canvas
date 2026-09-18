/**
 * 导演台字段规格。
 *
 * 设计前提：**节点文字是唯一真相**。用户会直接在画布上改节点文字，
 * 所以结构化数据不单独存一份（会不同步），而是统一以「标签：值」的可读文本存在节点 content 里，
 * 导出、一致性自检时再按这里的字段名解析回结构化数据。
 */

export type FieldSpec = {
    key: string;
    label: string;
    /** 必填字段缺失时，一致性自检会报出来。 */
    required?: boolean;
};

/** 人物节点：14 字段。 */
export const CHARACTER_FIELDS: FieldSpec[] = [
    { key: "name", label: "姓名", required: true },
    { key: "aliases", label: "称呼" },
    { key: "identity", label: "身份", required: true },
    { key: "age", label: "年龄" },
    { key: "appearance", label: "外貌", required: true },
    { key: "wardrobe", label: "服饰" },
    { key: "marker", label: "标志特征" },
    { key: "voice", label: "音色语气" },
    { key: "personality", label: "性格" },
    { key: "backstory", label: "前史" },
    { key: "motivation", label: "动机" },
    { key: "relations", label: "关系" },
    { key: "arc", label: "弧光" },
    { key: "imagePrompt", label: "生图提示词", required: true },
];

/**
 * 场景节点：16 字段，其中「出场人物」不写进文本。
 *
 * 出场人物存的是人物节点 id（见 metadata.directorMeta.characterIds），
 * 显示时才去取当前名字 —— 这样改人名会自动同步，也不会和用户手改的文字冲突。
 */
export const SCENE_FIELDS: FieldSpec[] = [
    { key: "name", label: "场景名", required: true },
    { key: "code", label: "编号" },
    { key: "location", label: "地点", required: true },
    { key: "time", label: "时间" },
    { key: "space", label: "内外景" },
    { key: "weather", label: "季节天气" },
    { key: "mood", label: "氛围" },
    { key: "lighting", label: "光线" },
    { key: "palette", label: "色调" },
    { key: "props", label: "关键道具" },
    { key: "look", label: "本场造型" },
    { key: "goal", label: "场景目标" },
    { key: "conflict", label: "冲突" },
    { key: "outcome", label: "结果" },
    { key: "imagePrompt", label: "生图提示词", required: true },
];

/** 出场人物：单独渲染，不进文本。 */
export const SCENE_CHARACTERS_LABEL = "出场人物";

/** 分镜节点：16 字段。 */
export const SHOT_FIELDS: FieldSpec[] = [
    { key: "code", label: "镜号", required: true },
    { key: "output", label: "生成类型", required: true },
    { key: "duration", label: "时长" },
    { key: "shotSize", label: "景别", required: true },
    { key: "cameraHeight", label: "机位高度" },
    { key: "cameraAngle", label: "机位角度" },
    { key: "cameraMove", label: "运镜" },
    { key: "composition", label: "构图" },
    { key: "visual", label: "画面", required: true },
    { key: "emotion", label: "情绪" },
    { key: "dialogue", label: "台词" },
    { key: "narration", label: "旁白" },
    { key: "sfx", label: "音效" },
    { key: "music", label: "配乐" },
    { key: "pace", label: "节奏" },
    { key: "transition", label: "转场" },
    { key: "imagePrompt", label: "生图提示词", required: true },
];

/** 重要物品 / 道具：9 字段。它和人物一样是跨场景的资产，所以也在第一步拆出来。 */
export const PROP_FIELDS: FieldSpec[] = [
    { key: "name", label: "名称", required: true },
    { key: "category", label: "类别" },
    { key: "appearance", label: "外观", required: true },
    { key: "material", label: "材质" },
    { key: "owner", label: "关联人物" },
    { key: "scenes", label: "出现场景" },
    { key: "role", label: "剧情作用" },
    { key: "firstSeen", label: "首次出现" },
    { key: "imagePrompt", label: "生图提示词", required: true },
];

/** 场景里出现的物品，和「出场人物」一样单独渲染、不进正文。 */
export const SCENE_PROPS_LABEL = "出现物品";

export const FIELD_SETS = {
    character: CHARACTER_FIELDS,
    scene: SCENE_FIELDS,
    shot: SHOT_FIELDS,
    prop: PROP_FIELDS,
} as const;

/** 分镜的生成类型：这一镜该生图还是生视频。 */
export type ShotOutputKind = "image" | "video";

/** 从分镜文字里读出生成类型；识别不到按生图处理。 */
export function readShotOutputKind(text: string): ShotOutputKind {
    const value = parseFields(SHOT_FIELDS, text).output || "";
    return /视频|video/i.test(value) ? "video" : "image";
}

/** 生成类型的中文短标签，用来标在节点标题上。 */
export function shotOutputLabel(kind: ShotOutputKind) {
    return kind === "video" ? "视频" : "图";
}


/** 把字段值渲染成节点文字：每行「标签：值」，空值跳过。 */
export function formatFields(fields: FieldSpec[], values: Record<string, string | undefined>): string {
    return fields
        .map((field) => {
            const value = (values[field.key] || "").trim();
            return value ? `${field.label}：${value}` : "";
        })
        .filter(Boolean)
        .join("\n");
}

/** 从节点文字解析回字段值。只认已声明的标签，其余行忽略。 */
export function parseFields(fields: FieldSpec[], text: string): Record<string, string> {
    const byLabel = new Map(fields.map((field) => [field.label, field.key]));
    const values: Record<string, string> = {};
    let currentKey: string | null = null;

    for (const rawLine of (text || "").replace(/\r\n/g, "\n").split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;
        const match = line.match(/^([^：:]{1,12})[：:]\s*(.*)$/);
        const key = match ? byLabel.get(match[1].trim()) : undefined;
        if (match && key) {
            currentKey = key;
            values[key] = match[2].trim();
            continue;
        }
        // 续行：并到上一个字段里（用户手改时常常换行）。
        if (currentKey) values[currentKey] = `${values[currentKey]}\n${line}`.trim();
    }

    return values;
}

/** 取某个字段的单行值，用于节点标题。 */
export function fieldValue(fields: FieldSpec[], text: string, key: string): string {
    return parseFields(fields, text)[key] || "";
}
