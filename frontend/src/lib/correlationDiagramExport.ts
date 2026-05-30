import { toBlob } from "html-to-image";
import { getNodesBounds, getViewportForBounds, type Node } from "@xyflow/react";

const IMAGE_BG = "#0a0f1a";
const EXPORT_MAX_SIDE = 1400;
/** API `PUT .../og-image` の上限 2MB より少し小さく（ヘッダ・誤差の余裕） */
export const DIAGRAM_SHARE_OG_MAX_BYTES = 1_900_000;
const EXPORT_OG_MAX_SIDE = 1000;

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

export type DiagramPngCaptureOptions = {
  /** 長辺のピクセル数（既定 1400） */
  maxSide?: number;
  /** html-to-image の pixelRatio（既定 2） */
  pixelRatio?: number;
};

const canvasToPngBlob = (
  source: ImageBitmap,
  width: number,
  height: number,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(width, height)
        : document.createElement("canvas");
    if (!(canvas instanceof OffscreenCanvas)) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    if (!ctx) {
      reject(new Error("画像の縮小に失敗しました。"));
      return;
    }
    ctx.drawImage(source, 0, 0, width, height);
    if (canvas instanceof OffscreenCanvas) {
      canvas
        .convertToBlob({ type: "image/png" })
        .then((blob) => {
          if (!blob) {
            reject(new Error("画像の縮小に失敗しました。"));
            return;
          }
          resolve(blob);
        })
        .catch(reject);
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("画像の縮小に失敗しました。"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });

/** OGP 保存用に PNG を API 上限以下へ縮小する（既に十分小さい場合はそのまま返す） */
export const shrinkPngBlobToMaxBytes = async (
  blob: Blob,
  maxBytes: number = DIAGRAM_SHARE_OG_MAX_BYTES,
): Promise<Blob> => {
  if (blob.size <= maxBytes) {
    return blob;
  }
  const bitmap = await createImageBitmap(blob);
  try {
    let scale = Math.sqrt(maxBytes / blob.size) * 0.92;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const shrunk = await canvasToPngBlob(bitmap, width, height);
      if (shrunk.size <= maxBytes) {
        return shrunk;
      }
      scale *= 0.85;
    }
    throw new Error("OG用画像を2MB以下にできませんでした。");
  } finally {
    bitmap.close();
  }
};

/**
 * PNG 用のビュー変換だけを html-to-image のクローンに適用する。
 * 画面上の `setViewport` は呼ばない（共有後も相関図の表示が崩れないようにする）。
 */
export const captureCorrelationDiagramPngBlob = async (
  viewportElement: HTMLElement,
  rf: DiagramExportFlow,
  options?: DiagramPngCaptureOptions,
): Promise<Blob> => {
  const maxSide = options?.maxSide ?? EXPORT_MAX_SIDE;
  const pixelRatio = options?.pixelRatio ?? 2;
  const nodes = rf.getNodes();
  const nodesBounds = getNodesBounds(nodes);
  const bw = Math.max(nodesBounds.width, 1);
  const bh = Math.max(nodesBounds.height, 1);

  let imageWidth: number;
  let imageHeight: number;
  if (bw >= bh) {
    imageWidth = maxSide;
    imageHeight = Math.round((bh / bw) * maxSide);
  } else {
    imageHeight = maxSide;
    imageWidth = Math.round((bw / bh) * maxSide);
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
    pixelRatio,
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

/** URL 共有の OGP 用 PNG（解像度を抑え、必要なら 2MB 未満へ縮小） */
export const captureDiagramShareOgPngBlob = async (
  viewportElement: HTMLElement,
  rf: DiagramExportFlow,
): Promise<Blob> => {
  const blob = await captureCorrelationDiagramPngBlob(viewportElement, rf, {
    maxSide: EXPORT_OG_MAX_SIDE,
    pixelRatio: 1,
  });
  return shrinkPngBlobToMaxBytes(blob);
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
