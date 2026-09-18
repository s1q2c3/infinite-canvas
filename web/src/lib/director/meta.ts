/**
 * 导演台节点元信息读取。
 *
 * 放在 lib 而不是组件里：collect / wiring / self-check 都要用，
 * 让 lib 反向依赖组件会拖进 React 和图标库。
 */

import type { CanvasNodeData, DirectorNodeMeta, DirectorState } from "@/types/canvas";

export function readDirectorMeta(node: CanvasNodeData): DirectorNodeMeta | null {
    return (node.metadata?.directorMeta as DirectorNodeMeta | undefined) || null;
}

export function readDirectorState(node: CanvasNodeData): DirectorState | null {
    return (node.metadata?.director as DirectorState | undefined) || null;
}

/** 这个节点是不是导演台拆出来的分镜。 */
export function isDirectorShot(node: CanvasNodeData | undefined | null): boolean {
    return readDirectorMeta(node || ({} as CanvasNodeData))?.kind === "shot";
}
