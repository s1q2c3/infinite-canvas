/**
 * 导演台导出：JSON / 分镜表 CSV / 剧本格式。
 * 拆完的结果经常要拿去别的工具（剪辑软件、表格、给协作者看），所以三种都给。
 */

import type { DirectorCollection } from "@/lib/director/collect";

function csvCell(value: string) {
    const text = (value || "").replace(/\r?\n/g, " ");
    return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 结构化 JSON：三层完整数据，方便程序处理。 */
export function toDirectorJson(collection: DirectorCollection) {
    return JSON.stringify(
        {
            app: "sqc-infinite-canvas-director",
            version: 1,
            exportedAt: new Date().toISOString(),
            characters: collection.characters.map((character) => ({ name: character.name, tier: character.tier, ...character.values })),
            chapters: collection.chapters.map((chapter) => ({
                order: chapter.order,
                title: chapter.title,
                scenes: chapter.scenes.map((scene) => ({
                    order: scene.order,
                    characters: scene.characterNames,
                    ...scene.values,
                    shots: scene.shots.map((shot) => ({ index: shot.index, ...shot.values })),
                })),
            })),
        },
        null,
        2,
    );
}

/** 分镜表 CSV：一行一镜，可以直接用表格软件打开。 */
export function toShotCsv(collection: DirectorCollection) {
    const header = ["章节", "场景", "镜号", "时长", "景别", "机位高度", "机位角度", "运镜", "构图", "画面", "情绪", "台词", "旁白", "音效", "配乐", "节奏", "转场", "出场人物", "生图提示词"];
    const rows: string[] = [header.map(csvCell).join(",")];

    collection.chapters.forEach((chapter) => {
        chapter.scenes.forEach((scene) => {
            scene.shots.forEach((shot) => {
                const v = shot.values;
                rows.push(
                    [
                        `第${chapter.order}章 ${chapter.title}`,
                        scene.name,
                        shot.code,
                        v.duration || "",
                        v.shotSize || "",
                        v.cameraHeight || "",
                        v.cameraAngle || "",
                        v.cameraMove || "",
                        v.composition || "",
                        v.visual || "",
                        v.emotion || "",
                        v.dialogue || "",
                        v.narration || "",
                        v.sfx || "",
                        v.music || "",
                        v.pace || "",
                        v.transition || "",
                        scene.characterNames.join("、"),
                        v.imagePrompt || "",
                    ]
                        .map(csvCell)
                        .join(","),
                );
            });
        });
    });

    return rows.join("\n");
}

/** 剧本格式：给人读的，按场分块、按镜缩进。 */
export function toScript(collection: DirectorCollection) {
    const lines: string[] = [];

    if (collection.characters.length) {
        lines.push("人物表", "=".repeat(40));
        collection.characters.forEach((character) => {
            lines.push(`【${character.name}】${character.tier === "main" ? "（主角）" : "（配角）"}`);
            lines.push(character.text.trim());
            lines.push("");
        });
    }

    collection.chapters.forEach((chapter) => {
        lines.push(`第${chapter.order}章  ${chapter.title}`, "=".repeat(40), "");
        chapter.scenes.forEach((scene) => {
            const v = scene.values;
            lines.push(`【场景${scene.order}】${scene.name}`);
            lines.push(`地点：${v.location || "—"}　时间：${v.time || "—"}　${v.space || ""}　${v.weather || ""}`);
            lines.push(`氛围：${v.mood || "—"}　光线：${v.lighting || "—"}　色调：${v.palette || "—"}`);
            if (v.props) lines.push(`关键道具：${v.props}`);
            lines.push(`出场人物：${scene.characterNames.length ? scene.characterNames.join("、") : "—"}`);
            if (v.goal) lines.push(`场景目标：${v.goal}`);
            if (v.conflict) lines.push(`冲突：${v.conflict}`);
            lines.push("");

            scene.shots.forEach((shot) => {
                const s = shot.values;
                lines.push(`  ${shot.code}　${s.shotSize || ""}　${s.duration || ""}　${[s.cameraHeight, s.cameraAngle, s.cameraMove].filter(Boolean).join(" · ")}`);
                lines.push(`        画面：${s.visual || "—"}`);
                if (s.dialogue && s.dialogue !== "无") lines.push(`        台词：${s.dialogue}`);
                if (s.narration && s.narration !== "无") lines.push(`        旁白：${s.narration}`);
                lines.push(`        音效：${s.sfx || "—"}　配乐：${s.music || "—"}　转场：${s.transition || "—"}`);
                if (s.imagePrompt) lines.push(`        生图提示词：${s.imagePrompt}`);
                lines.push("");
            });
        });
    });

    return lines.join("\n");
}
