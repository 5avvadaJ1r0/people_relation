import { memo } from "react";
import {
  BaseEdge,
  type EdgeProps,
  getSmoothStepPath,
  Position,
} from "@xyflow/react";

/**
 * smoothstep 経路に、紫→赤系の線形グラデーション（AIトーン）と影・ハイライトを重ねる。
 */
export const DimensionalSmoothStepEdge = memo((props: EdgeProps) => {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition = Position.Bottom,
    targetPosition = Position.Top,
    pathOptions,
    style,
    markerEnd,
    markerStart,
    interactionWidth,
    label,
    labelStyle,
    labelShowBg,
    labelBgStyle,
    labelBgPadding,
    labelBgBorderRadius,
  } = props;

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: pathOptions?.borderRadius,
    offset: pathOptions?.offset,
    stepPosition: pathOptions?.stepPosition,
  });

  const w =
    typeof style?.strokeWidth === "number" ? Number(style.strokeWidth) : 3;
  const shadowPad = Math.max(2, w * 0.42);
  const rim = Math.max(0.75, w * 0.26);

  const gradId = `ai-edge-${String(id).replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  const { stroke: _ignoredStroke, ...restStyle } = style ?? {};

  return (
    <>
      <defs>
        <linearGradient
          id={gradId}
          gradientUnits="userSpaceOnUse"
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
        >
          <stop offset="0%" stopColor="#5b21b6" />
          <stop offset="38%" stopColor="#9333ea" />
          <stop offset="72%" stopColor="#db2777" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>
      <path
        d={path}
        fill="none"
        stroke="rgba(15, 23, 42, 0.28)"
        strokeWidth={w + shadowPad * 2}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(2.5, 3.5)"
        style={{ pointerEvents: "none" }}
      />
      <path
        d={path}
        fill="none"
        stroke="rgba(244, 114, 182, 0.45)"
        strokeWidth={rim}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(-1.1, -1.1)"
        style={{ pointerEvents: "none" }}
      />
      <BaseEdge
        id={id}
        path={path}
        labelX={labelX}
        labelY={labelY}
        label={label}
        labelStyle={labelStyle}
        labelShowBg={labelShowBg}
        labelBgStyle={labelBgStyle}
        labelBgPadding={labelBgPadding}
        labelBgBorderRadius={labelBgBorderRadius}
        markerEnd={markerEnd}
        markerStart={markerStart}
        interactionWidth={interactionWidth}
        style={{
          ...restStyle,
          stroke: `url(#${gradId})`,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          filter:
            "drop-shadow(0 0 3px rgba(168, 85, 247, 0.35)) drop-shadow(0 1px 0 rgba(255,255,255,0.12))",
        }}
      />
    </>
  );
});

DimensionalSmoothStepEdge.displayName = "DimensionalSmoothStepEdge";
