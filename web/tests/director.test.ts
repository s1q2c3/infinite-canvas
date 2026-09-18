import { expect, test } from "bun:test";

import { buildChapterOps, DIRECTOR_LAYOUT } from "../src/lib/director/layout";
import { splitNovelChapters } from "../src/lib/director/novel-split";
import { parseShots } from "../src/lib/director/prompts";
import type { DirectorChapter } from "../src/types/canvas";

const novel = [
    "书名页的一行简介",
    "",
    "第一章 雨夜重逢",
    "外面在下雨。她站在便利店门口。",
    "",
    "第二章 旧信",
    "信封已经泛黄。",
    "",
    "第三章 决定",
    "她合上笔记本。",
].join("\n");

test("按章节标题切分，并把标题前的内容单独作为前言", () => {
    const chapters = splitNovelChapters(novel);
    expect(chapters.map((item) => item.title)).toEqual(["前言", "第一章 雨夜重逢", "第二章 旧信", "第三章 决定"]);
    expect(chapters[0].body).toBe("书名页的一行简介");
    expect(chapters[1].body).toBe("外面在下雨。她站在便利店门口。");
    expect(chapters[3].body).toBe("她合上笔记本。");
});

test("识别不到章节标题时按字数兜底切分", () => {
    const plain = Array.from({ length: 40 }, (_, index) => `第${index}段内容` + "字".repeat(200)).join("\n");
    const chapters = splitNovelChapters(plain);
    expect(chapters.length).toBeGreaterThan(1);
    // 兜底切分不丢字：所有正文拼回去应等于原文（忽略换行差异）
    const joined = chapters.map((item) => item.body).join("\n");
    expect(joined.replace(/\s/g, "")).toBe(plain.replace(/\s/g, ""));
});

test("空输入返回空数组", () => {
    expect(splitNovelChapters("")).toEqual([]);
    expect(splitNovelChapters("   \n  ")).toEqual([]);
});

test("按 --- 分隔符切分镜头", () => {
    const raw = "镜号 1 · 约 3 秒\n【画面】全景\n---\n镜号 2 · 约 5 秒\n【画面】特写\n---\n镜号 3 · 约 2 秒\n【画面】远景";
    const shots = parseShots(raw);
    expect(shots).toHaveLength(3);
    expect(shots[0]).toContain("镜号 1");
    expect(shots[2]).toContain("镜号 3");
});

test("没有分隔符时按「镜号」开头切分，并去掉代码块围栏", () => {
    const raw = "```\n镜号 1 · 约 3 秒\n【画面】全景\n镜号 2 · 约 4 秒\n【画面】特写\n```";
    const shots = parseShots(raw);
    expect(shots).toHaveLength(2);
    expect(shots[0].startsWith("镜号 1")).toBe(true);
    expect(shots[0]).not.toContain("```");
});

test("布局：章节一行一个、镜头行内横排、章节连到每个镜头", () => {
    const chapters: DirectorChapter[] = [
        { id: "c1", title: "第一章", order: 1, shots: [{ id: "s1", index: 1, content: "a" }, { id: "s2", index: 2, content: "b" }] },
        { id: "c2", title: "第二章", order: 2, shots: [{ id: "s3", index: 1, content: "c" }] },
    ];
    const { ops, deployed } = buildChapterOps(chapters, "director-1", { originX: 100, originY: 200 });

    const added = ops.filter((op) => op.type === "add_node");
    expect(added).toHaveLength(5); // 2 章节 + 3 镜头

    const chapterNodes = added.filter((op) => op.nodeType === "sqc:chapter");
    expect(chapterNodes).toHaveLength(2);
    expect(chapterNodes[0].x).toBe(100);
    expect(chapterNodes[1].y).toBe(200 + DIRECTOR_LAYOUT.rowGapY);

    const shotNodes = added.filter((op) => op.nodeType === "text");
    expect(shotNodes).toHaveLength(3);
    // 同章两个镜头在同一行、x 递增
    const firstRow = shotNodes.filter((op) => op.y === 200);
    expect(firstRow).toHaveLength(2);
    expect(firstRow[1].x).toBeGreaterThan(firstRow[0].x);
    // 第二章的镜头落到下一行
    expect(shotNodes[2].y).toBe(200 + DIRECTOR_LAYOUT.rowGapY);

    // 每个镜头都有来自所属章节的连线
    const connections = ops.filter((op) => op.type === "connect_nodes");
    expect(connections).toHaveLength(3);
    expect(connections[0].fromNodeId).toBe(chapterNodes[0].id);
    expect(connections[2].fromNodeId).toBe(chapterNodes[1].id);

    // 部署结果把章节和镜头节点 id 回传，供面板记录
    expect(deployed).toHaveLength(2);
    expect(deployed[0].shotNodeIds).toHaveLength(2);
    expect(deployed[1].shotNodeIds).toHaveLength(1);
});

test("布局：追加章节时按 startRow 接着往下排", () => {
    const chapters: DirectorChapter[] = [{ id: "c1", title: "第三章", order: 3, shots: [{ id: "s1", index: 1, content: "a" }] }];
    const { ops } = buildChapterOps(chapters, "director-1", { originX: 0, originY: 0, row: 2 });
    const chapterNode = ops.find((op) => op.type === "add_node" && op.nodeType === "sqc:chapter");
    expect(chapterNode?.y).toBe(2 * DIRECTOR_LAYOUT.rowGapY);
});
