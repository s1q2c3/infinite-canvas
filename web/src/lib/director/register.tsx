import { Clapperboard, ListTree, MapPin, Package, Sparkles, UserRound } from "lucide-react";

import { ChapterNodeContent, CharacterNodeContent, DirectorNodeContent, PropNodeContent, SceneNodeContent } from "@/components/canvas/nodes/director-node";
import { DirectorPanel } from "@/components/canvas/nodes/director-panel";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import { DIRECTOR_CHAPTER_TYPE, DIRECTOR_CHARACTER_TYPE, DIRECTOR_LAYOUT, DIRECTOR_NODE_TYPE, DIRECTOR_PROP_TYPE, DIRECTOR_SCENE_TYPE, GENERATED_STACK_GAP } from "@/lib/director/layout";
import { CHARACTER_FIELDS, parseFields, PROP_FIELDS, SCENE_FIELDS } from "@/lib/director/spec";
import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeContext, CanvasNodeDefinition, CanvasNodeResource, CanvasNodeToolbarItem } from "@/types/canvas-plugin";

const iconClass = "size-5";

/**
 * 人物 / 场景 / 物品节点把正文暴露成生成输入。
 * 带上名字前缀，模型同时收到多段上游文本时才分得清哪段是谁的设定。
 */
const makeResource = (prefix: string) => (node: CanvasNodeData): CanvasNodeResource | null => {
    const text = (node.metadata?.content || "").trim();
    return text ? { kind: "text", text: `${prefix}：${node.title}\n${text}` } : null;
};

const characterResource = makeResource("人物");
const sceneResource = makeResource("场景");
const propResource = makeResource("物品");

/** 人物 / 场景 / 物品节点的「生成形象图」按钮：按节点里的「生图提示词」建配置节点。 */
const PHOTO_TOOLBAR_LABEL = {
    character: { label: "生成形象图", suffix: "形象图", fields: CHARACTER_FIELDS, hint: "按「生图提示词」生成人物照片，供分镜作参考图" },
    scene: { label: "生成场景图", suffix: "场景图", fields: SCENE_FIELDS, hint: "按「生图提示词」生成场景照片，供分镜作参考图" },
    prop: { label: "生成物品图", suffix: "物品图", fields: PROP_FIELDS, hint: "按「生图提示词」生成物品照片，供分镜作参考图" },
} as const;

const makePhotoToolbar = (kind: "character" | "scene" | "prop") => (ctx: CanvasNodeContext): CanvasNodeToolbarItem[] => [
    {
        id: `director-${kind}-photo`,
        title: PHOTO_TOOLBAR_LABEL[kind].hint,
        label: PHOTO_TOOLBAR_LABEL[kind].label,
        icon: <Sparkles className="size-4" />,
        onClick: () => {
            const config = PHOTO_TOOLBAR_LABEL[kind];
            const values = parseFields(config.fields, ctx.node.metadata?.content || "");
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
                    title: `${ctx.node.title} · ${config.suffix}`,
                    // 生成结果落在正下方：布局给每个框都预留了下方空间
                    x: ctx.node.position.x,
                    y: ctx.node.position.y + ctx.node.height + GENERATED_STACK_GAP,
                    metadata: {
                        prompt,
                        generationMode: "image",
                        status: "idle",
                        directorStack: true,
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
        type: DIRECTOR_PROP_TYPE,
        title: "重要物品",
        icon: <Package className={iconClass} />,
        description: "导演台拆解出的重要物品 / 道具；出现场景从连线自动取",
        defaultSize: { width: DIRECTOR_LAYOUT.propWidth, height: DIRECTOR_LAYOUT.propHeight },
        defaultMetadata: { content: "", status: "idle" },
        minimapColor: "#fcd34d",
        showInCreateMenu: false,
        Content: PropNodeContent,
        resource: propResource,
        toolbar: makePhotoToolbar("prop"),
    },
    {
        // 旧数据的章节节点：工作台改成场次主轴后不再新建，但保留定义以便画布编辑里能正常渲染与清理
        type: DIRECTOR_CHAPTER_TYPE,
        title: "章节",
        icon: <ListTree className={iconClass} />,
        description: "旧版章节分组标题（不再新建）",
        defaultSize: { width: 220, height: 160 },
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
