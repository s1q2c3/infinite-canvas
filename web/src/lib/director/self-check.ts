/**
 * 导演台一致性自检。
 *
 * 拆完几百个节点后靠人眼翻是不现实的，这里把常见的几类问题自动扫出来：
 * 字段缺失、空场、人物对不上、台词说话人不在本场。
 */

import type { DirectorCollection } from "@/lib/director/collect";
import { CHARACTER_FIELDS, PROP_FIELDS, SCENE_FIELDS, SHOT_FIELDS, type FieldSpec } from "@/lib/director/spec";

export type SelfCheckIssue = {
    level: "error" | "warn";
    /** 出问题的位置，例如「第1章 场景2 镜 2-1」。 */
    scope: string;
    message: string;
    nodeId?: string;
};

function missingRequired(fields: FieldSpec[], values: Record<string, string>) {
    return fields.filter((field) => field.required && !(values[field.key] || "").trim()).map((field) => field.label);
}

/** 扫一遍，返回按位置排序的问题清单。 */
export function runSelfCheck(collection: DirectorCollection): SelfCheckIssue[] {
    const issues: SelfCheckIssue[] = [];
    const characterNames = new Set(collection.characters.map((character) => character.name).filter(Boolean));

    collection.characters.forEach((character) => {
        const missing = missingRequired(CHARACTER_FIELDS, character.values);
        if (missing.length) {
            issues.push({ level: "error", scope: `人物「${character.name || "未命名"}」`, message: `缺必填字段：${missing.join("、")}`, nodeId: character.nodeId });
        }
    });

    collection.props.forEach((prop) => {
        const missing = missingRequired(PROP_FIELDS, prop.values);
        if (missing.length) {
            issues.push({ level: "error", scope: `物品「${prop.name || "未命名"}」`, message: `缺必填字段：${missing.join("、")}`, nodeId: prop.nodeId });
        }
    });

    collection.chapters.forEach((chapter) => {
        if (!chapter.scenes.length) {
            issues.push({ level: "error", scope: `第${chapter.order}章 ${chapter.title}`, message: "这一章没有拆出任何场景", nodeId: chapter.nodeId });
        }
    });

    collection.orphanScenes.forEach((scene) => {
        issues.push({ level: "warn", scope: `场景${scene.order} ${scene.name}`, message: "这个场景没有归属到任何章节", nodeId: scene.nodeId });
    });

    collection.scenes.forEach((scene) => {
        const scope = `场景${scene.order} ${scene.name}`;
        const missing = missingRequired(SCENE_FIELDS, scene.values);
        if (missing.length) {
            issues.push({ level: "error", scope, message: `缺必填字段：${missing.join("、")}`, nodeId: scene.nodeId });
        }
        if (!scene.shots.length) {
            issues.push({ level: "error", scope, message: "这一场一个分镜都没有", nodeId: scene.nodeId });
        }
        if (!scene.characterIds.length) {
            issues.push({ level: "warn", scope, message: "出场人物为空（或人物名和人物表对不上）", nodeId: scene.nodeId });
        }

        const inScene = new Set(scene.characterNames);
        scene.shots.forEach((shot) => {
            const shotScope = `${scope} · 镜 ${shot.code}`;
            const missingShot = missingRequired(SHOT_FIELDS, shot.values);
            if (missingShot.length) {
                issues.push({ level: "error", scope: shotScope, message: `缺必填字段：${missingShot.join("、")}`, nodeId: shot.nodeId });
            }

            // 台词说话人应该是本场出场人物
            const dialogue = shot.values.dialogue || "";
            if (dialogue && dialogue !== "无") {
                const speaker = dialogue.split(/[：:]/)[0]?.trim() || "";
                if (speaker && characterNames.has(speaker) && !inScene.has(speaker)) {
                    issues.push({ level: "warn", scope: shotScope, message: `台词说话人「${speaker}」不在本场出场人物里`, nodeId: shot.nodeId });
                }
            }

            // 画面里点名的人物，应该是本场出场人物
            const visual = shot.values.visual || "";
            const mentioned = [...characterNames].filter((name) => name && visual.includes(name) && !inScene.has(name));
            if (mentioned.length) {
                issues.push({ level: "warn", scope: shotScope, message: `画面提到「${mentioned.join("、")}」，但不在本场出场人物里`, nodeId: shot.nodeId });
            }
        });
    });

    return issues;
}

/** 自检结果的纯文本摘要，方便直接贴出来。 */
export function summarizeIssues(issues: SelfCheckIssue[]) {
    const errors = issues.filter((issue) => issue.level === "error").length;
    const warns = issues.length - errors;
    return `共 ${issues.length} 条：${errors} 个错误、${warns} 个提醒`;
}
