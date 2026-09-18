export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    Config = "config",
    Video = "video",
    Audio = "audio",
    Group = "group",
}

// Node types are open strings: built-ins use CanvasNodeType and plugins use "<pluginId>:<name>".
export type CanvasNodeTypeId = CanvasNodeType | (string & {});

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasImageGenerationType = "generation" | "edit";

export type CanvasNodeImage = {
    id: string;
    status: CanvasNodeStatus;
    errorDetails?: string;
    content: string;
    storageKey?: string;
    naturalWidth: number;
    naturalHeight: number;
    bytes: number;
    mimeType: string;
};

export type CanvasNodeText = {
    id: string;
    status: CanvasNodeStatus;
    errorDetails?: string;
    content: string;
};

export type CanvasNodeMetadata = {
    content?: string;
    composerContent?: string;
    prompt?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    reasoningEffort?: "auto" | "low" | "medium" | "high" | "xhigh";
    size?: string;
    quality?: string;
    background?: string;
    count?: number;
    textCount?: number;
    texts?: CanvasNodeText[];
    primaryTextId?: string;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    watermark?: string;
    videoMode?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    references?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    images?: CanvasNodeImage[];
    primaryImageId?: string;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    videoTaskId?: string;
    videoTaskProvider?: "openai" | "gemini";
    groupId?: string;
    interactive?: boolean; // Plugin node interaction/move state; see CanvasNodeDefinition.interactionToggle.
    /** 折叠隐藏：渲染时跳过该节点（导演台折叠场景 / 章节用）。 */
    hidden?: boolean;
    /** 导演台节点的持久化状态。 */
    director?: DirectorState;
    /** 导演台生成的节点（人物 / 场景 / 章节 / 分镜）的归属与结构化信息。 */
    directorMeta?: DirectorNodeMeta;
    /** 该图片节点是某个人物 / 场景的照片。 */
    directorPhoto?: DirectorPhotoMeta;

    // ── 以下为 v1 导演台遗留字段，仅用于识别并清理旧版拆解结果 ──
    /** @deprecated v1 章节节点：所属导演台节点 id。 */
    directorNodeId?: string;
    /** @deprecated v1 章节节点：章节序号。 */
    chapterOrder?: number;
    /** @deprecated v1 镜头节点：所属章节节点 id。 */
    chapterNodeId?: string;
    /** @deprecated v1 章节节点：该章镜头是否已折叠。 */
    chapterCollapsed?: boolean;
};

/** 导演台节点类型。 */
export type DirectorNodeKind = "character" | "scene" | "chapter" | "shot" | "group";
/** 人物分级：主角（完整字段）/ 配角（精简）。龙套不建节点，只写进场景文本。 */
export type DirectorCharacterTier = "main" | "support";

/** 导演台生成的节点共有的归属信息。 */
type DirectorOwned = {
    /** 所属导演台节点 id。 */
    directorNodeId: string;
};

/** 人物节点。 */
export type DirectorCharacterMeta = DirectorOwned & { kind: "character"; characterId: string; tier: DirectorCharacterTier };

/** 场景节点。 */
export type DirectorSceneMeta = DirectorOwned & {
    kind: "scene";
    sceneId: string;
    /** 场景序号，全篇从 1 开始。 */
    order: number;
    /** 所属章节节点 id（章节折叠时用它找齐本章场景）。 */
    chapterNodeId?: string;
    /** 出场人物节点 id 列表；显示时取当前名字，所以改人名会自动同步。 */
    characterIds: string[];
};

/** 章节节点：同时承载该章原文。 */
export type DirectorChapterMeta = DirectorOwned & {
    kind: "chapter";
    chapterId: string;
    order: number;
    /** 该章原文（按章分散存，避免导演台节点承载全文导致画布变慢）。 */
    chapterText: string;
    /** 该章的场与分镜是否已折叠。 */
    collapsed?: boolean;
};

/** 分镜节点（用内置文本节点）。 */
export type DirectorShotMeta = DirectorOwned & {
    kind: "shot";
    shotId: string;
    /** 所属场景节点 id。 */
    sceneNodeId: string;
    /** 镜号，场景内从 1 开始。 */
    index: number;
};

export type DirectorNodeMeta = DirectorCharacterMeta | DirectorSceneMeta | DirectorChapterMeta | DirectorShotMeta | DirectorGroupMeta;

/** 组节点：只用来在侧边栏把一场的分镜收成树，不参与生成。 */
export type DirectorGroupMeta = DirectorOwned & { kind: "group" };

/** 人物 / 场景照片节点：记录归属，供分镜生图时匹配参考图。 */
export type DirectorPhotoMeta = {
    /** 照片主体：人物节点或场景节点 id。 */
    ownerId: string;
    kind: "character" | "scene";
    /** 造型标签；人物有多套造型时用于匹配场景的「本场造型」。 */
    look?: string;
};

/** 导演台两步流程的当前阶段。 */
export type DirectorStep = "idle" | "extracting" | "extracted" | "decomposing" | "done" | "error";

/**
 * 导演台节点的持久化状态。
 * 只存流程状态与模型选择；人物 / 场景 / 分镜的结构一律以画布节点为准，避免两份数据不同步。
 */
export type DirectorState = {
    /** 拆解模型，独立于全局默认模型。 */
    model: string;
    step: DirectorStep;
    /**
     * 待拆解的小说原文 —— 「输入态」的临时存放，此时还没有章节节点可放。
     * 第二步跑完后每章原文会写进对应章节节点，这里清空，
     * 避免几十万字长期挂在单个节点上（拖动节点会反复序列化整个画布）。
     */
    sourceText?: string;
    /** 已切分的章节数。 */
    chapterCount?: number;
    /** 每章期望分镜数（0 = 交给模型判断）。 */
    shotsPerChapter?: number;
    progress?: { current: number; total: number; label: string };
    error?: string;
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };
