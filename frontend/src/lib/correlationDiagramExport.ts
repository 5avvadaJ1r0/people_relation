import { toBlob } from "html-to-image";
import { getNodesBounds, getViewportForBounds, type Node } from "@xyflow/react";

const IMAGE_BG = "#0a0f1a";
const EXPORT_MAX_SIDE = 1400;

/** 共有ダイアログに渡す説明テキスト（ユーザーが編集してから投稿可能） */
export const buildDiagramShareText = (members: readonly string[]): string => {
  const centers = members.join("、");
  return `相関図（中心: ${centers}）`;
};

/** ファイル付き `navigator.share` が使えるか（厳密には画像 PNG の canShare） */
export const canShareDiagramImage = (): boolean => {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
    return false;
  }
  if (typeof navigator.canShare !== "function") {
    return true;
  }
  try {
    const probe = new File([new Uint8Array([137, 80])], "probe.png", {
      type: "image/png",
    });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
};

const shouldIncludeInExport = (node: HTMLElement): boolean => {
  const list = node.classList;
  if (!list) return true;
  if (list.contains("react-flow__minimap")) return false;
  if (list.contains("react-flow__controls")) return false;
  return true;
};

export type DiagramExportFlow = {
  getNodes: () => Node[];
};

/**
 * PNG 用のビュー変換だけを html-to-image のクローンに適用する。
 * 画面上の `setViewport` は呼ばない（共有後も相関図の表示が崩れないようにする）。
 */
export const captureCorrelationDiagramPngBlob = async (
  viewportElement: HTMLElement,
  rf: DiagramExportFlow,
): Promise<Blob> => {
  const nodes = rf.getNodes();
  const nodesBounds = getNodesBounds(nodes);
  const bw = Math.max(nodesBounds.width, 1);
  const bh = Math.max(nodesBounds.height, 1);

  let imageWidth: number;
  let imageHeight: number;
  if (bw >= bh) {
    imageWidth = EXPORT_MAX_SIDE;
    imageHeight = Math.round((bh / bw) * EXPORT_MAX_SIDE);
  } else {
    imageHeight = EXPORT_MAX_SIDE;
    imageWidth = Math.round((bw / bh) * EXPORT_MAX_SIDE);
  }

  const viewport = getViewportForBounds(
    nodesBounds,
    imageWidth,
    imageHeight,
    0.1,
    2,
    0.12,
  );

  const blob = await toBlob(viewportElement, {
    cacheBust: true,
    backgroundColor: IMAGE_BG,
    width: imageWidth,
    height: imageHeight,
    pixelRatio: 2,
    style: {
      width: `${imageWidth}px`,
      height: `${imageHeight}px`,
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
      transformOrigin: "0 0",
    },
    filter: (domNode) => shouldIncludeInExport(domNode as HTMLElement),
  });
  if (!blob) {
    throw new Error("画像データの生成に失敗しました。");
  }
  return blob;
};

/**
 * 相関図 PNG を共有する。
 * `text` / `title` と `files` を同時に渡すと、一部環境でクリップボードや
 * 貼り付け先に画像が複数入ることがあるため、画像ファイルのみ渡す。
 */
export const shareCorrelationDiagram = async (blob: Blob): Promise<void> => {
  const file = new File([blob], "correlation-diagram.png", {
    type: "image/png",
  });
  const data: ShareData = { files: [file] };
  if (navigator.canShare && !navigator.canShare(data)) {
    throw new Error("この環境では画像付きの共有を開始できません。");
  }
  await navigator.share(data);
};
