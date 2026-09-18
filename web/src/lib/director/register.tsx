import { Clapperboard, ListTree } from "lucide-react";

import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import { DIRECTOR_CHAPTER_TYPE, DIRECTOR_LAYOUT, DIRECTOR_NODE_TYPE } from "@/lib/director/layout";
import type { CanvasNodeDefinition } from "@/types/canvas-plugin";

import { ChapterNodeContent, DirectorNodeContent } from "@/components/canvas/nodes/director-node";
import { DirectorPanel } from "@/components/canvas/nodes/director-panel";

const iconClass = "size-5";

/**
 * 导演台内置节点定义。
 *
 * 走 node-registry 的插件渲染路径（提供 Content / Panel），因此不需要改动
 * canvas-node 的内部渲染分派，后续合并上游更新时冲突面最小。
 */
const DEFINITIONS: CanvasNodeDefinition[] = [
    {
        type: DIRECTOR_NODE_TYPE,
        title: "导演台",
        icon: <Clapperboard className={iconClass} />,
        description: "粘贴小说，自动拆成镜头铺到画布",
        defaultSize: { width: 320, height: 220 },
        defaultMetadata: { content: "", status: "idle" },
        minimapColor: "#8b5cf6",
        hasSourceHandle: false,
        autoOpenPanel: true,
        Content: DirectorNodeContent,
        Panel: DirectorPanel,
    },
    {
        type: DIRECTOR_CHAPTER_TYPE,
        title: "章节",
        icon: <ListTree className={iconClass} />,
        description: "导演台拆解出的章节分组",
        defaultSize: { width: DIRECTOR_LAYOUT.labelWidth, height: DIRECTOR_LAYOUT.labelHeight },
        defaultMetadata: { content: "", status: "idle" },
        minimapColor: "#38bdf8",
        showInCreateMenu: false,
        Content: ChapterNodeContent,
    },
];

let registered = false;

export function registerDirectorNodes() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions(DEFINITIONS, "sqc-director");
}
