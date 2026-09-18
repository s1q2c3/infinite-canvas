/**
 * 工作台数据层。
 *
 * 工作台是「导演台节点 + 它生成的资产节点」的另一种画法：**数据仍然是画布节点**，
 * 只是不再用画布渲染。这样生成流程、导出、自检、画布编辑全都能复用同一份数据，
 * 不会出现两套状态不同步的问题。
 *
 * 节点操作走 applyCanvasAgentOps（和画布同一套指令集），AI 生成走 host 注入的
 * CanvasPluginAi（同一套模型与凭据配置）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { DIRECTOR_NODE_TYPE } from "@/lib/director/layout";
import { requestEdit, requestGeneration, requestImageQuestion, type AiTextMessage } from "@/services/api/image";
import { requestVideoGeneration, storeGeneratedVideo } from "@/services/api/video";
import { imageToDataUrl } from "@/services/image-storage";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { decodeChannelModel, selectableModelsByCapability, useEffectiveConfig, type ModelCapability } from "@/stores/use-config-store";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import type { CanvasPluginAi } from "@/types/canvas-plugin";
import type { ReferenceImage } from "@/types/image";

export type StudioData = {
    /** 项目节点已经读进内存。 */
    ready: boolean;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    /** 本项目的导演台节点（一个画布 = 一个项目，取第一个）。 */
    directorNode: CanvasNodeData | null;
    projectTitle: string;
    applyOps: (ops: CanvasAgentOp[]) => void;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    ai: CanvasPluginAi;
};

export function useStudio(projectId: string): StudioData {
    const hydrated = useCanvasStore((state) => state.hydrated);
    const openProject = useCanvasStore((state) => state.openProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const projectTitle = useCanvasStore((state) => state.projects.find((item) => item.id === projectId)?.title || "");
    const effectiveConfig = useEffectiveConfig();

    const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [ready, setReady] = useState(false);
    // applyOps 要基于「最新」节点算，不能依赖 state 的闭包快照，所以额外存一份 ref 镜像
    const stateRef = useRef<{ nodes: CanvasNodeData[]; connections: CanvasConnection[] }>({ nodes: [], connections: [] });

    useEffect(() => {
        if (!hydrated) return;
        setReady(false);
        const project = openProject(projectId);
        if (!project) return;
        stateRef.current = { nodes: project.nodes, connections: project.connections };
        setNodes(project.nodes);
        setConnections(project.connections);
        setReady(true);
    }, [hydrated, openProject, projectId]);

    // 改完写回项目（工作台和画布共享同一份数据）
    useEffect(() => {
        if (!ready) return;
        updateProject(projectId, { nodes, connections });
    }, [connections, nodes, projectId, ready, updateProject]);

    const applyOps = useCallback(
        (ops: CanvasAgentOp[]) => {
            if (!ops.length) return;
            const snapshot: CanvasAgentSnapshot = {
                projectId,
                title: projectTitle,
                nodes: stateRef.current.nodes,
                connections: stateRef.current.connections,
                selectedNodeIds: [],
                viewport: { x: 0, y: 0, k: 1 },
            };
            const next = applyCanvasAgentOps(snapshot, ops);
            stateRef.current = { nodes: next.nodes, connections: next.connections };
            setNodes(next.nodes);
            setConnections(next.connections);
        },
        [projectId, projectTitle],
    );

    const ai = useMemo<CanvasPluginAi>(() => {
        const toReferences = (refs?: string[]): ReferenceImage[] =>
            (refs || []).filter(Boolean).map((src, index) => ({ id: `studio-ref-${index}`, name: `ref-${index}.png`, type: "image/png", dataUrl: src }));

        return {
            generateImage: async (prompt, options) => {
                const config = {
                    ...buildGenerationConfig(effectiveConfig, undefined, "image"),
                    count: String(options?.count || 1),
                    ...(options?.model ? { model: options.model } : {}),
                    ...(options?.size ? { size: options.size } : {}),
                };
                const references = toReferences(options?.references);
                const items = references.length ? await requestEdit(config, prompt, references, { signal: options?.signal }) : await requestGeneration(config, prompt, { signal: options?.signal });
                const images = await Promise.all(
                    items.map(async (item) => {
                        try {
                            return await imageToDataUrl({ dataUrl: item.dataUrl }, { signal: options?.signal });
                        } catch (error) {
                            if (options?.signal?.aborted) throw error;
                            return item.dataUrl;
                        }
                    }),
                );
                return { images };
            },
            generateVideo: async (prompt, options) => {
                const config = {
                    ...buildGenerationConfig(effectiveConfig, undefined, "video"),
                    ...(options?.model ? { model: options.model } : {}),
                    ...(options?.size ? { size: options.size } : {}),
                    ...(options?.seconds ? { videoSeconds: options.seconds } : {}),
                };
                const file = await storeGeneratedVideo(await requestVideoGeneration(config, prompt, toReferences(options?.references), { signal: options?.signal }));
                return { url: file.url, mimeType: file.mimeType, width: file.width, height: file.height, durationMs: file.durationMs };
            },
            generateText: async (prompt, options) => {
                const config = { ...buildGenerationConfig(effectiveConfig, undefined, "text"), ...(options?.model ? { model: options.model } : {}) };
                const messages: AiTextMessage[] = [...(options?.system ? [{ role: "system" as const, content: options.system }] : []), { role: "user" as const, content: prompt }];
                const text = await requestImageQuestion(config, messages, (delta) => options?.onDelta?.(delta), { signal: options?.signal });
                return { text };
            },
            listModels: (capability) => selectableModelsByCapability(effectiveConfig, capability as ModelCapability | undefined).map((value) => ({ value, label: decodeChannelModel(value)?.model || value })),
            defaultModel: (capability) => buildGenerationConfig(effectiveConfig, undefined, capability).model,
        };
    }, [effectiveConfig]);

    const directorNode = useMemo(() => nodes.find((node) => node.type === DIRECTOR_NODE_TYPE) || null, [nodes]);

    return { ready, nodes, connections, directorNode, projectTitle, applyOps, setNodes, ai };
}
