import { Clapperboard, ListTree, MapPin, Sparkles, UserRound } from "lucide-react";

import { ChapterNodeContent, CharacterNodeContent, DirectorNodeContent, SceneNodeContent } from "@/components/canvas/nodes/director-node";
import { DirectorPanel } from "@/components/canvas/nodes/director-panel";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import { DIRECTOR_CHAPTER_TYPE, DIRECTOR_CHARACTER_TYPE, DIRECTOR_LAYOUT, DIRECTOR_NODE_TYPE, DIRECTOR_SCENE_TYPE } from "@/lib/director/layout";
import { CHARACTER_FIELDS, parseFields, SCENE_FIELDS } from "@/lib/director/spec";
import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeContext, CanvasNodeDefinition, CanvasNodeResource, CanvasNodeToolbarItem } from "@/types/canvas-plugin";

const iconClass = "size-5";

/**
 * 人物 / 场景节点把正文暴露成生成输入。
 * 带上名字前缀，模型同时收到多段上游文本时才分得清哪段是谁的设定。
 */
const characterResource = (node: CanvasNodeData): CanvasNodeResource | null => {
    const text = (node.metadata?.content || "").trim();
    return text ? { kind: "text", text: `人物：${node.title}\n${text}` } : null;
};

const sceneResource = (node: CanvasNodeData): CanvasNodeResource | null => {
    const text = (node.metadata?.content || "").trim();
    return text ? { kind: "text", text: `场景：${node.title}\n${text}` } : null;
};

/**
 * 人物 / 场景节点的「生成形象图 / 生成场景图」按钮。
 *
 * 按节点里的「生图提示词」建一个生成配置节点、连上主体节点、打开配置面板。
 * 配置节点带 directorPhoto 标记（含造型标签），分镜生图时据此匹配参考图。
 */
const makePhotoToolbar = (kind: "character" | "scene") => (ctx: CanvasNodeContext): CanvasNodeToolbarItem[] => [
    {
        id: `director-${kind}-photo`,
        title: kind === "character" ? "按「生图提示词」生成人物照片，供分镜作参考图" : "按「生图提示词」生成场景照片，供分镜作参考图",
        label: kind === "character" ? "生成形象图" : "生成场景图",
        icon: <Sparkles className="size-4" />,
        onClick: () => {
            const values = parseFields(kind === "character" ? CHARACTER_FIELDS : SCENE_FIELDS, ctx.node.metadata?.content || "");
            const prompt = (values.imagePrompt || "").trim();
            if (!prompt) {
                window.alert("这个节点还没有填「生图提示词」字段，请先补上再生成。");
                return;
            }
            const configId = `director-photo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
            ctx.applyOps([
                {
                    type: "add_node",
                    id: configId,
                    nodeType: "config",
                    title: kind === "character" ? `${ctx.node.title} · 形象图` : `${ctx.node.title} · 场景图`,
                    x: ctx.node.position.x + ctx.node.width + 96,
                    y: ctx.node.position.y,
                    metadata: {
                        prompt,
                        generationMode: "image",
                        status: "idle",
                        directorPhoto: { ownerId: ctx.node.id, kind, look: (values.look || "").trim() || undefined },
                    },
                },
                { type: "connect_nodes", fromNodeId: ctx.node.id, toNodeId: configId },
            ]);
            ctx.openPanel();
        },
    },
];

/**
 * 导演台相关节点定义。
 *
 * 都走 node-registry 的 Content / Panel 渲染路径，不改 canvas-node 的内部渲染分派，
 * 以后合并上游更新时冲突面最小。
 */
const DEFINITIONS: CanvasNodeDefinition[] = [
    {
        type: DIRECTOR_NODE_TYPE,
        title: "导演台",
        icon: <Clapperboard className={iconClass} />,
        description: "粘贴小说，先提人物，再拆场景与分镜",
        defaultSize: { width: 320, height: 220 },
        defaultMetadata: { content: "", status: "idle" },
        minimapColor: "#8b5cf6",
        hasSourceHandle: false,
        autoOpenPanel: true,
        Content: DirectorNodeContent,
        Panel: DirectorPanel,
    },
    {
        type: DIRECTOR_CHARACTER_TYPE,
        title: "人物",
        icon: <UserRound className={iconClass} />,
        description: "导演台提取的人物设定；可直接编辑",
        defaultSize: { width: DIRECTOR_LAYOUT.charWidth, height: DIRECTOR_LAYOUT.charHeight },
        defaultMetadata: { content: "", status: "idle" },
        minimapColor: "#7c5cff",
        showInCreateMenu: false,
        Content: CharacterNodeContent,
        resource: characterResource,
        toolbar: makePhotoToolbar("character"),
    },
    {
        type: DIRECTOR_SCENE_TYPE,
        title: "场景",
        icon: <MapPin className={iconClass} />,
        description: "导演台拆解出的场景；出场人物从连线自动取",
        defaultSize: { width: DIRECTOR_LAYOUT.sceneWidth, height: DIRECTOR_LAYOUT.sceneHeight },
        defaultMetadata: { content: "", status: "idle" },
        minimapColor: "#38bdf8",
        showInCreateMenu: false,
        Content: SceneNodeContent,
        resource: sceneResource,
        toolbar: makePhotoToolbar("scene"),
    },
    {
        type: DIRECTOR_CHAPTER_TYPE,
        title: "章节",
        icon: <ListTree className={iconClass} />,
        description: "章节分组标题，同时承载该章原文",
        defaultSize: { width: DIRECTOR_LAYOUT.chapterWidth, height: DIRECTOR_LAYOUT.chapterHeight },
        defaultMetadata: { content: "", status: "idle" },
        minimapColor: "#7fbf7f",
        showInCreateMenu: false,
        hasSourceHandle: false,
        Content: ChapterNodeContent,
    },
];

let registered = false;

export function registerDirectorNodes() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions(DEFINITIONS, "sqc-director");
}
