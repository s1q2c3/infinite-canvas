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
    /** 该图片节点是某个人物 / 场景 / 物品的照片。 */
    directorPhoto?: DirectorPhotoMeta;
    /**
     * 导演台建的生成配置节点：生成结果（图片 / 视频）要落在它**正下方**而不是右侧。
     * 布局给每个框都留了下方空间，链条竖着排才能让一行分镜保持成一条横线、一眼看全。
     */
    directorStack?: boolean;
    /** 该生成配置节点属于哪个分镜（分镜生图 / 生视频时打上）。 */
    directorShotConfig?: string;

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
export type DirectorNodeKind = "character" | "scene" | "prop" | "chapter" | "shot" | "group";
/** 人物分级：主角（完整字段）/ 配角（精简）。龙套不建节点，只写进场景文本。 */
export type DirectorCharacterTier = "main" | "support";

/** 导演台生成的节点共有的归属信息。 */
type DirectorOwned = {
    /** 所属导演台节点 id。 */
    directorNodeId: string;
};

/** 人物节点。 */
/** 角色的一套服饰（变体）。主形象之外，同一角色在不同场次可能换装。 */
export type DirectorCostume = {
    id: string;
    name: string;
    /** 服饰描述：穿搭、颜色、材质等可见信息。 */
    prompt: string;
};

/** 人物节点。 */
export type DirectorCharacterMeta = DirectorOwned & {
    kind: "character";
    characterId: string;
    tier: DirectorCharacterTier;
    /**
     * 服饰变体。第一套是主形象（id = "main"），其余按剧情需要添加。
     * 每套服饰对应一张生成图（image 节点的 metadata.directorPhoto.look = 服饰名）。
     */
    costumes?: DirectorCostume[];
};

/** 场景节点。 */
export type DirectorSceneMeta = DirectorOwned & {
    kind: "scene";
    sceneId: string;
    /** 场景序号，全篇从 1 开始。 */
    order: number;
    /**
     * 所属章节标题。工作台改成「场次」主轴后，「章」降级成场次上的分组属性，不再单独建章节节点。
     */
    chapterTitle?: string;
    /** 该场正文（从剧本里切出来的这一场）。 */
    script?: string;
    /** @deprecated 旧数据的章节节点 id，仅用于兼容读取。 */
    chapterNodeId?: string;
    /** 出场人物节点 id 列表；显示时取当前名字，所以改人名会自动同步。 */
    characterIds: string[];
    /** 出现的重要物品节点 id 列表，同样存 id 不存名字。 */
    propIds: string[];
};

/** 重要物品 / 道具节点。和人物一样是跨场景资产，所以也在第一步拆出来。 */
export type DirectorPropMeta = DirectorOwned & { kind: "prop"; propId: string };

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
    /**
     * 关联素材（角色 / 场景 / 道具节点 id）。这是「连线」的替代品：
     * 生成时按这份列表去取设定文本与参考图，不再依赖画布拓扑。
     */
    assetIds?: string[];
    /** 本镜选用的镜头预设 id；预设值已合进节点文字，这里只记来源。 */
    presetId?: string;
};

export type DirectorNodeMeta = DirectorCharacterMeta | DirectorSceneMeta | DirectorChapterMeta | DirectorShotMeta | DirectorPropMeta | DirectorGroupMeta;

/** 组节点：只用来在侧边栏把一场的分镜收成树，不参与生成。 */
export type DirectorGroupMeta = DirectorOwned & { kind: "group" };

/** 人物 / 场景 / 物品照片节点：记录归属，供分镜生成时匹配参考图。 */
export type DirectorPhotoMeta = {
    /** 照片主体：人物 / 场景 / 物品节点 id。 */
    ownerId: string;
    kind: "character" | "scene" | "prop";
    /** 造型标签；人物有多套造型时用于匹配场景的「本场造型」。 */
    look?: string;
};

/** 工作台的四步。 */
export type DirectorStage = "script" | "art" | "storyboard" | "film";

/** 镜头预设的值：只覆盖「怎么拍」那几个字段。 */
export type ShotPresetValues = Partial<Record<"shotSize" | "cameraHeight" | "cameraAngle" | "cameraMove" | "composition", string>>;

/** 镜头预设：一组可复用的「怎么拍」组合，存在项目里。 */
export type ShotPreset = {
    id: string;
    name: string;
    values: ShotPresetValues;
};

/** 输入判定：粘贴进来的是小说还是剧本。 */
export type DirectorScriptKind = "novel" | "script";

/** 导演台流程的当前阶段。 */
export type DirectorStep = "idle" | "extracting" | "extracted" | "decomposing" | "done" | "error";

/**
 * 导演台节点的持久化状态。
 * 只存流程状态、模型选择与项目级配置；人物 / 场景 / 分镜的结构一律以画布节点为准，避免两份数据不同步。
 */
export type DirectorState = {
    /** 拆解模型，独立于全局默认模型。 */
    model: string;
    step: DirectorStep;
    /** 工作台当前停在哪一步。 */
    stage?: DirectorStage;
    /**
     * 剧本 / 小说原文。工作台是整页应用，不再把原文分散到章节节点上，所以这里长期保留 ——
     * 「重新提取」时要能回到原文。
     */
    sourceText?: string;
    /** 输入判定结果，由模型给出。 */
    scriptKind?: DirectorScriptKind;
    /** 全局画风：一次设定，所有生图提示词都会带上。 */
    style?: string;
    /** 项目级镜头预设。 */
    presets?: ShotPreset[];
    /** 每场期望分镜数（0 = 交给模型判断）。 */
    shotsPerChapter?: number;
    /** @deprecated 旧数据的章节数。 */
    chapterCount?: number;
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
