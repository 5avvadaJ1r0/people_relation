import { useEffect, useMemo, memo } from "react";
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
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  buildDiagramNodesAndEdges,
  tieHeatStyle,
  type DiagramRow,
  type TwoCoreLayout,
} from "../lib/diagramGraph";
import { DimensionalSmoothStepEdge } from "./DimensionalSmoothStepEdge";

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
  useEffect(() => {
    const t = requestAnimationFrame(() => {
      fitView({ padding: 0.2, duration: 400 });
    });
    return () => cancelAnimationFrame(t);
  }, [fitView, fitTrigger]);
  return null;
};

export type CorrelationDiagramViewProps = {
  members: readonly string[];
  rows: DiagramRow[];
  /** 中心が 2 名のときのみ有効。コアノードを縦（上・下）または横（左・右）に並べる */
  twoCoreLayout?: TwoCoreLayout;
};

export const CorrelationDiagramView = ({
  members,
  rows,
  twoCoreLayout = "vertical",
}: CorrelationDiagramViewProps) => {
  const layoutOpt = useMemo(
    () =>
      members.length === 2
        ? { twoCoreLayout: twoCoreLayout }
        : undefined,
    [members.length, twoCoreLayout],
  );

  const built = useMemo(
    () => buildDiagramNodesAndEdges(members, rows, layoutOpt),
    [members, rows, layoutOpt],
  );

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>(built.nodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>(built.edges);

  useEffect(() => {
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
  const fitTrigger =
    members.length === 2
      ? `${twoCoreLayout}:${members.join("\u0001")}:${rows.length}`
      : `${members.length}:${rows.length}`;

  return (
    <div className="diagramFlowWrap">
      {empty ? (
        <div className="diagramFlowEmpty">相関図はまだありません。</div>
      ) : (
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          colorMode="dark"
          minZoom={0.15}
          maxZoom={1.8}
          fitView
          proOptions={{ hideAttribution: true }}
        >
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
};
