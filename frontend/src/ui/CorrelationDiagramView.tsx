import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  memo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  type NodeProps,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  buildDiagramNodesAndEdges,
  LAYOUT_FRAME_ASPECT_DEFAULT,
  resolveLayoutFrameAspect,
  tieHeatStyle,
  type DiagramRow,
  type TwoCoreLayout,
} from "../lib/diagramGraph";
import {
  captureCorrelationDiagramPngBlob,
  captureDiagramShareOgPngBlob,
  shareCorrelationDiagram,
} from "../lib/correlationDiagramExport";
import { DimensionalSmoothStepEdge } from "./DimensionalSmoothStepEdge";

const CORRELATION_FLOW_DOM_ID = "correlation-diagram-rf";
/** fitView アニメ後にノードが落ち着いてから PNG を切る */
const SHARE_PREFETCH_DEBOUNCE_MS = 480;

/** 初回レイアウト・手動「表示サイズ最適化」と共通 */
const CORRELATION_DIAGRAM_FIT_VIEW_OPTIONS = {
  padding: 0.2,
  duration: 400,
} as const;

type InnerShareApi = {
  /** プリフェッチ済み Blob で共有（`navigator.share` は同期的に呼ぶ） */
  shareFromPrefetched: () => Promise<void>;
  getPrefetchedBlob: () => Blob | null;
};

/** 親（ヘッダー等）から `navigator.share` で画像共有するときに使う ref。 */
export type CorrelationDiagramViewHandle = {
  shareAsImage: () => Promise<void>;
  /** 共有・OG 用の PNG（プリフェッチ済み Blob を優先） */
  capturePngBlob: () => Promise<Blob>;
  /** URL 共有の OGP 用（2MB 未満・高解像度プリフェッチは使わない） */
  captureOgPngBlob: () => Promise<Blob>;
  /** ズーム・パンを調整し、ノード全体が表示領域に収まるようにする */
  fitDisplayToViewport: () => void;
};

const CorrelationDiagramShareBind = ({
  members,
  rows,
  twoCoreLayout,
  layoutFrameAspect,
  innerShareApiRef,
  onDiagramShareReadyChange,
}: {
  members: readonly string[];
  rows: DiagramRow[];
  twoCoreLayout: TwoCoreLayout;
  layoutFrameAspect: number;
  innerShareApiRef: MutableRefObject<InnerShareApi | null>;
  onDiagramShareReadyChange?: (ready: boolean) => void;
}) => {
  const rf = useReactFlow();
  const nodesReady = useNodesInitialized();
  const prefetchedBlobRef = useRef<Blob | null>(null);
  const prefetchGenRef = useRef(0);

  useEffect(() => {
    innerShareApiRef.current = {
      shareFromPrefetched: () => {
        const blob = prefetchedBlobRef.current;
        if (!blob) {
          throw new Error(
            "共有用の画像をまだ用意できていません。少し待ってから再度お試しください。",
          );
        }
        return shareCorrelationDiagram(blob);
      },
      getPrefetchedBlob: () => prefetchedBlobRef.current,
    };
    return () => {
      innerShareApiRef.current = null;
    };
  }, [innerShareApiRef]);

  useEffect(() => {
    if (!nodesReady) {
      prefetchedBlobRef.current = null;
      onDiagramShareReadyChange?.(false);
      return;
    }

    prefetchedBlobRef.current = null;
    onDiagramShareReadyChange?.(false);

    const gen = ++prefetchGenRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        if (prefetchGenRef.current !== gen) return;
        const viewportEl = document.querySelector(
          `#${CORRELATION_FLOW_DOM_ID} .react-flow__viewport`,
        ) as HTMLElement | null;
        if (!viewportEl) {
          onDiagramShareReadyChange?.(false);
          return;
        }
        try {
          const blob = await captureCorrelationDiagramPngBlob(viewportEl, rf);
          if (prefetchGenRef.current !== gen) return;
          prefetchedBlobRef.current = blob;
          onDiagramShareReadyChange?.(true);
        } catch {
          if (prefetchGenRef.current !== gen) return;
          prefetchedBlobRef.current = null;
          onDiagramShareReadyChange?.(false);
        }
      })();
    }, SHARE_PREFETCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      prefetchGenRef.current += 1;
    };
  }, [
    nodesReady,
    members,
    rows,
    twoCoreLayout,
    layoutFrameAspect,
    rf,
    onDiagramShareReadyChange,
  ]);

  return null;
};

const handleStyle = {
  opacity: 0,
  width: 10,
  height: 10,
  border: "none",
  background: "transparent",
} as const;

const CoreNode = memo(({ data }: NodeProps) => (
  <div className="diagramNodeCore">
    <Handle
      type="target"
      position={Position.Top}
      id="in"
      style={handleStyle}
      isConnectable={false}
    />
    <Handle
      type="source"
      position={Position.Bottom}
      id="out"
      style={handleStyle}
      isConnectable={false}
    />
    {String(data.label)}
  </div>
));

CoreNode.displayName = "CoreNode";

const PersonNode = memo(({ data }: NodeProps) => {
  const heat =
    typeof data.tieHeat === "number" && Number.isFinite(data.tieHeat)
      ? data.tieHeat
      : 0.5;
  const sum = data.tieSum;
  const mc =
    typeof data.memberCount === "number" && Number.isFinite(data.memberCount)
      ? data.memberCount
      : null;
  const title =
    typeof sum === "number" && mc !== null
      ? `メンバー${mc}名との関連ポイント合計: ${sum}`
      : typeof sum === "number"
        ? `関連ポイント合計: ${sum}`
        : undefined;

  return (
    <div
      className="diagramNodePerson"
      style={tieHeatStyle(heat)}
      title={title}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="in"
        style={handleStyle}
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="out"
        style={handleStyle}
        isConnectable={false}
      />
      {String(data.label)}
    </div>
  );
});

PersonNode.displayName = "PersonNode";

const FitViewOnReady = ({
  fitTrigger,
}: {
  /** レイアウト切り替えなどノード座標が変わったあと再フィットするためのキー */
  fitTrigger?: string;
}) => {
  const { fitView } = useReactFlow();
  const nodesReady = useNodesInitialized();

  useEffect(() => {
    if (!nodesReady) return;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        fitView(CORRELATION_DIAGRAM_FIT_VIEW_OPTIONS);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [fitView, fitTrigger, nodesReady]);
  return null;
};

/** React Flow 内の `fitView` を親の `useImperativeHandle` から呼ぶ */
const FitViewActionBind = ({
  actionRef,
}: {
  actionRef: MutableRefObject<(() => void) | null>;
}) => {
  const { fitView } = useReactFlow();
  useLayoutEffect(() => {
    actionRef.current = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fitView(CORRELATION_DIAGRAM_FIT_VIEW_OPTIONS);
        });
      });
    };
    return () => {
      actionRef.current = null;
    };
  }, [actionRef, fitView]);
  return null;
};

export type CorrelationDiagramViewProps = {
  members: readonly string[];
  rows: DiagramRow[];
  /** 中心が 2 名のときのみ有効。コアノードを縦（上・下）または横（左・右）に並べる */
  twoCoreLayout?: TwoCoreLayout;
  /** 共有ボタン活性用。ノード計測完了で `true` */
  onDiagramShareReadyChange?: (ready: boolean) => void;
};

export const CorrelationDiagramView = forwardRef<
  CorrelationDiagramViewHandle,
  CorrelationDiagramViewProps
>(function CorrelationDiagramView(
  {
    members,
    rows,
    twoCoreLayout = "vertical",
    onDiagramShareReadyChange,
  },
  ref,
) {
  const innerShareApiRef = useRef<InnerShareApi | null>(null);
  const fitViewActionRef = useRef<(() => void) | null>(null);
  const diagramFlowWrapRef = useRef<HTMLDivElement | null>(null);
  const [layoutFrameAspect, setLayoutFrameAspect] = useState(
    LAYOUT_FRAME_ASPECT_DEFAULT,
  );

  useLayoutEffect(() => {
    const el = diagramFlowWrapRef.current;
    if (!el) return;

    const updateAspect = () => {
      const { width, height } = el.getBoundingClientRect();
      setLayoutFrameAspect(resolveLayoutFrameAspect(width, height));
    };

    updateAspect();
    const ro = new ResizeObserver(updateAspect);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layoutOpt = useMemo(
    () => ({
      layoutFrameAspect,
      ...(members.length === 2 ? { twoCoreLayout } : {}),
    }),
    [members.length, twoCoreLayout, layoutFrameAspect],
  );

  const built = useMemo(
    () => buildDiagramNodesAndEdges(members, rows, layoutOpt),
    [members, rows, layoutOpt],
  );

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>(built.nodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>(built.edges);

  /** 親の passive effect より後に確実にノードを差し替え、子の fitView が古い座標を見ないようにする */
  useLayoutEffect(() => {
    const next = buildDiagramNodesAndEdges(members, rows, layoutOpt);
    setRfNodes(next.nodes);
    setRfEdges(next.edges);
  }, [members, rows, layoutOpt, setRfEdges, setRfNodes]);

  const nodeTypes = useMemo(
    () => ({
      core: CoreNode,
      person: PersonNode,
    }),
    [],
  );

  const edgeTypes = useMemo(
    () => ({
      dimensionalSmoothstep: DimensionalSmoothStepEdge,
    }),
    [],
  );

  const empty = members.length === 0 && rows.length === 0;

  useImperativeHandle(
    ref,
    () => ({
      shareAsImage: () => {
        if (empty) {
          throw new Error("相関図がありません。");
        }
        const share = innerShareApiRef.current?.shareFromPrefetched;
        if (!share) {
          throw new Error(
            "描画の準備中です。少し待ってから再度お試しください。",
          );
        }
        return share();
      },
      capturePngBlob: async () => {
        if (empty) {
          throw new Error("相関図がありません。");
        }
        const cached = innerShareApiRef.current?.getPrefetchedBlob();
        if (cached) return cached;
        const viewportEl = document.querySelector(
          `#${CORRELATION_FLOW_DOM_ID} .react-flow__viewport`,
        ) as HTMLElement | null;
        if (!viewportEl) {
          throw new Error("相関図の描画領域が見つかりません。");
        }
        return captureCorrelationDiagramPngBlob(viewportEl, {
          getNodes: () => rfNodes,
        });
      },
      captureOgPngBlob: async () => {
        if (empty) {
          throw new Error("相関図がありません。");
        }
        const viewportEl = document.querySelector(
          `#${CORRELATION_FLOW_DOM_ID} .react-flow__viewport`,
        ) as HTMLElement | null;
        if (!viewportEl) {
          throw new Error("相関図の描画領域が見つかりません。");
        }
        return captureDiagramShareOgPngBlob(viewportEl, {
          getNodes: () => rfNodes,
        });
      },
      fitDisplayToViewport: () => {
        if (empty) return;
        fitViewActionRef.current?.();
      },
    }),
    [empty, rfNodes],
  );

  useEffect(() => {
    if (empty) {
      onDiagramShareReadyChange?.(false);
    }
  }, [empty, onDiagramShareReadyChange]);

  const fitTrigger = useMemo(() => {
    const rowSig = rows
      .map((r) => `${r.a}\u001f${r.b}\u001f${r.points}`)
      .join("\u001e");
    return `${twoCoreLayout}\u0000${layoutFrameAspect}\u0000${members.join("\u0001")}\u0000${rowSig}`;
  }, [members, rows, twoCoreLayout, layoutFrameAspect]);

  return (
    <div className="diagramFlowWrap" ref={diagramFlowWrapRef}>
      {empty ? (
        <div className="diagramFlowEmpty">相関図はまだありません。</div>
      ) : (
        <ReactFlow
          id={CORRELATION_FLOW_DOM_ID}
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          colorMode="dark"
          minZoom={0.15}
          maxZoom={1.8}
          elevateNodesOnSelect={false}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <CorrelationDiagramShareBind
            members={members}
            rows={rows}
            twoCoreLayout={twoCoreLayout}
            layoutFrameAspect={layoutFrameAspect}
            innerShareApiRef={innerShareApiRef}
            onDiagramShareReadyChange={onDiagramShareReadyChange}
          />
          <FitViewActionBind actionRef={fitViewActionRef} />
          <Background gap={20} color="#1e293b" size={1.15} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeStrokeWidth={2}
            zoomable
            pannable
            maskColor="rgba(2, 6, 23, 0.55)"
            style={{ backgroundColor: "#0f172a" }}
          />
          <FitViewOnReady fitTrigger={fitTrigger} />
        </ReactFlow>
      )}
    </div>
  );
});

CorrelationDiagramView.displayName = "CorrelationDiagramView";
