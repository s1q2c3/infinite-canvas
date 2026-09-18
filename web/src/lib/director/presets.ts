/**
 * 镜头预设：把分镜里「怎么拍」的那部分字段抽出来，做成可复用的组合。
 *
 * 设计原因：分镜原本 17 个字段全写在卡片上，卡片变成小作文，审阅成本极高。
 * 实际上景别 / 机位 / 运镜 / 构图这几项在整部片子里高度重复，
 * 所以抽成预设 —— 卡片上只留「画面描述 + 台词 + 时长 + 生成类型」，其余点开弹窗看。
 *
 * 预设存在导演台节点的 metadata.director.presets 里（项目级，不跨项目）。
 */

import type { ShotPreset, ShotPresetValues } from "@/types/canvas";

/** 预设覆盖的字段 key，与 spec.ts 的 SHOT_FIELDS 对应。 */
export const SHOT_PRESET_KEYS = ["shotSize", "cameraHeight", "cameraAngle", "cameraMove", "composition"] as const;

/** 预设字段的中文标签，编辑弹窗里显示。 */
export const SHOT_PRESET_LABELS: Record<(typeof SHOT_PRESET_KEYS)[number], string> = {
    shotSize: "景别",
    cameraHeight: "机位高度",
    cameraAngle: "机位角度",
    cameraMove: "运镜",
    composition: "构图",
};

export const SHOT_SIZE_OPTIONS = ["大远景", "远景", "全景", "中景", "中近景", "近景", "特写", "大特写"];
export const CAMERA_HEIGHT_OPTIONS = ["平视", "俯视", "仰视", "高机位", "低机位", "地面视角"];
export const CAMERA_ANGLE_OPTIONS = ["正面", "侧 3/4", "正侧", "背面", "过肩"];
export const CAMERA_MOVE_OPTIONS = ["固定", "推", "拉", "摇", "移", "跟拍", "升降", "环绕"];
export const COMPOSITION_OPTIONS = ["中心构图", "三分构图", "对称构图", "对角线构图", "框架构图", "留白构图"];

/** 默认预设：覆盖短剧 / 漫剧里最常见的几种镜头。 */
export const DEFAULT_SHOT_PRESETS: ShotPreset[] = [
    {
        id: "preset-establish",
        name: "全景交代",
        values: { shotSize: "全景", cameraHeight: "平视", cameraAngle: "正面", cameraMove: "固定", composition: "中心构图" },
    },
    {
        id: "preset-dialogue",
        name: "中景对话",
        values: { shotSize: "中景", cameraHeight: "平视", cameraAngle: "侧 3/4", cameraMove: "固定", composition: "三分构图" },
    },
    {
        id: "preset-emotion",
        name: "近景情绪",
        values: { shotSize: "近景", cameraHeight: "平视", cameraAngle: "侧 3/4", cameraMove: "固定", composition: "中心构图" },
    },
    {
        id: "preset-closeup",
        name: "特写强调",
        values: { shotSize: "特写", cameraHeight: "平视", cameraAngle: "正面", cameraMove: "固定", composition: "中心构图" },
    },
    {
        id: "preset-follow",
        name: "跟拍移动",
        values: { shotSize: "中景", cameraHeight: "平视", cameraAngle: "侧 3/4", cameraMove: "跟拍", composition: "三分构图" },
    },
    {
        id: "preset-overhead",
        name: "俯视压迫",
        values: { shotSize: "全景", cameraHeight: "俯视", cameraAngle: "正面", cameraMove: "固定", composition: "中心构图" },
    },
    {
        id: "preset-lowangle",
        name: "仰视威严",
        values: { shotSize: "中景", cameraHeight: "仰视", cameraAngle: "正面", cameraMove: "固定", composition: "中心构图" },
    },
];

/** 读取项目预设；没配过就用默认那套。 */
export function readPresets(value: unknown): ShotPreset[] {
    const list = Array.isArray(value) ? (value as ShotPreset[]) : [];
    const valid = list.filter((item) => item && typeof item.id === "string" && typeof item.name === "string" && item.values && typeof item.values === "object");
    return valid.length ? valid : DEFAULT_SHOT_PRESETS;
}

/** 预设值渲染成一行摘要，卡片上显示。 */
export function presetSummary(values: ShotPresetValues): string {
    return SHOT_PRESET_KEYS.map((key) => values[key])
        .filter(Boolean)
        .join(" · ");
}
