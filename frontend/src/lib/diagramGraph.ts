import type { CSSProperties } from "react";
import type { Edge, Node } from "@xyflow/react";

export type DiagramRow = { a: string; b: string; points: number };

/** 中心人物以外同士のエッジを除く（関連者間リンク非表示用） */
export const filterDiagramRowsForDisplay = (
  rows: readonly DiagramRow[],
  centerTitles: readonly string[],
  includePeerLinks: boolean,
): DiagramRow[] => {
  if (includePeerLinks) return [...rows];
  const centers = new Set(centerTitles);
  return rows.filter((r) => centers.has(r.a) || centers.has(r.b));
};

/** 中心人物がちょうど 2 名のときのコアノード配置（縦: 上・下 / 横: 左・右） */
export type TwoCoreLayout = "vertical" | "horizontal";

/** React Flow の描画順（値が大きいほど手前） */
export const DIAGRAM_Z_INDEX = {
  edge: 0,
  person: 1,
  core: 10,
} as const;

const collectPeople = (
  rows: DiagramRow[],
  members: readonly string[],
): Set<string> => {
  const s = new Set<string>();
  for (const r of rows) {
    s.add(r.a);
    s.add(r.b);
  }
  for (const c of members) s.add(c);
  return s;
};

const buildGraph = (
  rows: DiagramRow[],
  coreSet: Set<string>,
  members: readonly string[],
) => {
  const people = collectPeople(rows, members);
  const weightToCore = new Map<string, Map<string, number>>();

  const addToCore = (person: string, core: string, w: number) => {
    if (!weightToCore.has(person)) weightToCore.set(person, new Map());
    const m = weightToCore.get(person)!;
    m.set(core, (m.get(core) ?? 0) + w);
  };

  for (const { a, b, points } of rows) {
    const aCore = coreSet.has(a);
    const bCore = coreSet.has(b);
    if (aCore && !bCore) addToCore(b, a, points);
    else if (!aCore && bCore) addToCore(a, b, points);
  }

  const coreTieStrength = new Map<string, number>();
  for (const { a, b, points } of rows) {
    const aCore = coreSet.has(a);
    const bCore = coreSet.has(b);
    if (aCore && !bCore) {
      coreTieStrength.set(b, (coreTieStrength.get(b) ?? 0) + points);
    } else if (!aCore && bCore) {
      coreTieStrength.set(a, (coreTieStrength.get(a) ?? 0) + points);
    }
  }

  const primaryCore = new Map<string, string>();
  for (const name of people) {
    if (coreSet.has(name)) continue;
    const m = weightToCore.get(name);
    if (!m || m.size === 0) continue;
    let best = "";
    let bestW = -1;
    for (const [c, w] of m) {
      if (w > bestW) {
        bestW = w;
        best = c;
      }
    }
    if (best) primaryCore.set(name, best);
  }

  const coreDistinctCount = new Map<string, number>();
  for (const [person, m] of weightToCore) {
    coreDistinctCount.set(person, m.size);
  }

  return { people, primaryCore, rows, coreTieStrength, coreDistinctCount };
};

/** おおよその当たり判定半径（CSS のノードサイズに合わせた概算） */
export const NODE_RADIUS = { core: 58, person: 48 } as const;

const layoutCoreRing = (
  centerX: number,
  centerY: number,
  coreRingR: number,
  members: readonly string[],
  twoCoreLayout?: TwoCoreLayout,
): Map<string, { x: number; y: number }> => {
  const pos = new Map<string, { x: number; y: number }>();
  if (members.length === 2 && twoCoreLayout === "horizontal") {
    const [a, b] = members;
    pos.set(a, {
      x: centerX + coreRingR * Math.cos(Math.PI),
      y: centerY + coreRingR * Math.sin(Math.PI),
    });
    pos.set(b, {
      x: centerX + coreRingR * Math.cos(0),
      y: centerY + coreRingR * Math.sin(0),
    });
    return pos;
  }
  members.forEach((name, i) => {
    const angle = (i / members.length) * Math.PI * 2 - Math.PI / 2;
    pos.set(name, {
      x: centerX + coreRingR * Math.cos(angle),
      y: centerY + coreRingR * Math.sin(angle),
    });
  });
  return pos;
};

const compareByLayoutPriority = (
  a: string,
  b: string,
  coreDistinctCount: Map<string, number>,
  coreTieStrength: Map<string, number>,
): number => {
  const da = coreDistinctCount.get(a) ?? 0;
  const db = coreDistinctCount.get(b) ?? 0;
  if (db !== da) return db - da;
  const sa = coreTieStrength.get(a) ?? 0;
  const sb = coreTieStrength.get(b) ?? 0;
  if (sb !== sa) return sb - sa;
  return a.localeCompare(b, "ja");
};

/** 中心 1 名: 主体値＋関連値（中心—関連者エッジの total_point）が大きいほど近くに配置 */
const layoutSingleCoreSatellites = (
  pos: Map<string, { x: number; y: number }>,
  satellites: string[],
  coreTieStrength: Map<string, number>,
  centerX: number,
  centerY: number,
) => {
  const rInner = 140;
  const rOuter = 640;
  const n = satellites.length;
  if (n === 0) return;

  let minT = Infinity;
  let maxT = -Infinity;
  for (const name of satellites) {
    const t = coreTieStrength.get(name) ?? 0;
    minT = Math.min(minT, t);
    maxT = Math.max(maxT, t);
  }
  if (!Number.isFinite(minT)) minT = 0;
  if (!Number.isFinite(maxT)) maxT = minT;

  const radialFromTie = (t: number): number => {
    if (maxT <= minT) return (rInner + rOuter) * 0.5;
    const u = (t - minT) / (maxT - minT);
    return rOuter - u * (rOuter - rInner);
  };

  const ordered = [...satellites].sort((a, b) => {
    const ta = coreTieStrength.get(a) ?? 0;
    const tb = coreTieStrength.get(b) ?? 0;
    if (tb !== ta) return tb - ta;
    return a.localeCompare(b, "ja");
  });

  ordered.forEach((name, i) => {
    const theta = (n <= 1 ? 0 : i / n) * Math.PI * 2 - Math.PI / 2;
    const r = radialFromTie(coreTieStrength.get(name) ?? 0);
    pos.set(name, {
      x: centerX + r * Math.cos(theta),
      y: centerY + r * Math.sin(theta),
    });
  });
};

const layoutSatelliteInitial = (
  pos: Map<string, { x: number; y: number }>,
  people: Set<string>,
  primaryCore: Map<string, string>,
  coreTieStrength: Map<string, number>,
  coreDistinctCount: Map<string, number>,
  centerX: number,
  centerY: number,
  coreSet: Set<string>,
  members: readonly string[],
) => {
  const satellites: string[] = [];
  for (const name of people) {
    if (coreSet.has(name)) continue;
    if (!primaryCore.has(name)) continue;
    satellites.push(name);
  }

  satellites.sort((a, b) =>
    compareByLayoutPriority(a, b, coreDistinctCount, coreTieStrength),
  );

  const byCore = new Map<string, string[]>();
  for (const name of satellites) {
    const core = primaryCore.get(name)!;
    if (!byCore.has(core)) byCore.set(core, []);
    byCore.get(core)!.push(name);
  }
  for (const list of byCore.values()) {
    list.sort((a, b) =>
      compareByLayoutPriority(a, b, coreDistinctCount, coreTieStrength),
    );
  }

  if (members.length === 1) {
    const coreSatellites = satellites.filter(
      (name) => primaryCore.get(name) === members[0],
    );
    layoutSingleCoreSatellites(
      pos,
      coreSatellites,
      coreTieStrength,
      centerX,
      centerY,
    );
    const placed = new Set(coreSatellites);
    const orphans: string[] = [];
    for (const name of people) {
      if (coreSet.has(name) || placed.has(name)) continue;
      orphans.push(name);
    }
    orphans.sort((a, b) =>
      compareByLayoutPriority(a, b, coreDistinctCount, coreTieStrength),
    );
    const no = orphans.length;
    let maxT = 1;
    for (const id of orphans) maxT = Math.max(maxT, coreTieStrength.get(id) ?? 0);
    orphans.forEach((name, i) => {
      let h = 0;
      for (let j = 0; j < name.length; j++) h = (h * 31 + name.charCodeAt(j)) | 0;
      const ang = ((Math.abs(h) % 360) * Math.PI) / 180;
      const t = coreTieStrength.get(name) ?? 0;
      const inner = 360;
      const outer = 680;
      const radial = outer - (t / maxT) * (outer - inner);
      const frac = no <= 1 ? 0 : i / (no - 1);
      const jitter = (frac - 0.5) * 40;
      pos.set(name, {
        x: centerX + (radial + jitter) * Math.cos(ang),
        y: centerY + (radial + jitter) * Math.sin(ang),
      });
    });
    return;
  }

  const n = satellites.length;
  const rHub = 140;
  const rOuter = 640;
  const sectorHalfWidth = 0.52;

  for (let rank = 0; rank < n; rank++) {
    const name = satellites[rank];
    const core = primaryCore.get(name)!;
    const corePos = pos.get(core);
    if (!corePos) continue;

    const frac = n <= 1 ? 0 : rank / (n - 1);
    const r = rHub + frac * (rOuter - rHub);

    const baseAng = Math.atan2(corePos.y - centerY, corePos.x - centerX);
    const cohort = byCore.get(core)!;
    const idx = cohort.indexOf(name);
    const m = cohort.length;
    const delta = m <= 1 ? 0 : (idx / (m - 1) - 0.5) * 2 * sectorHalfWidth;
    const theta = baseAng + delta;

    pos.set(name, {
      x: centerX + r * Math.cos(theta),
      y: centerY + r * Math.sin(theta),
    });
  }

  const orphans: string[] = [];
  for (const name of people) {
    if (coreSet.has(name) || pos.has(name)) continue;
    orphans.push(name);
  }
  orphans.sort((a, b) =>
    compareByLayoutPriority(a, b, coreDistinctCount, coreTieStrength),
  );
  const no = orphans.length;
  let maxT = 1;
  for (const id of orphans) maxT = Math.max(maxT, coreTieStrength.get(id) ?? 0);
  orphans.forEach((name, i) => {
    let h = 0;
    for (let j = 0; j < name.length; j++) h = (h * 31 + name.charCodeAt(j)) | 0;
    const ang = ((Math.abs(h) % 360) * Math.PI) / 180;
    const t = coreTieStrength.get(name) ?? 0;
    const inner = 360;
    const outer = 680;
    const radial = outer - (t / maxT) * (outer - inner);
    const frac = no <= 1 ? 0 : i / (no - 1);
    const jitter = (frac - 0.5) * 40;
    pos.set(name, {
      x: centerX + (radial + jitter) * Math.cos(ang),
      y: centerY + (radial + jitter) * Math.sin(ang),
    });
  });
};

const relaxNodePositions = (
  initial: Map<string, { x: number; y: number }>,
  people: Set<string>,
  coreSet: Set<string>,
  coreDistinctCount?: Map<string, number>,
): Map<string, { x: number; y: number }> => {
  type Body = {
    id: string;
    x: number;
    y: number;
    r: number;
    fixed: boolean;
    ax: number;
    ay: number;
  };

  const padding = 16;
  const bodies: Body[] = [];
  for (const id of people) {
    const p = initial.get(id);
    if (!p) continue;
    const isCore = coreSet.has(id);
    bodies.push({
      id,
      x: p.x,
      y: p.y,
      r: (isCore ? NODE_RADIUS.core : NODE_RADIUS.person) + padding,
      fixed: isCore,
      ax: p.x,
      ay: p.y,
    });
  }

  const iterations = 110;
  const repulsion = 0.72;
  const anchor = 0.028;

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const minD = a.r + b.r;
        if (d < minD) {
          const push = (minD - d) * repulsion * 0.5;
          const nx = dx / d;
          const ny = dy / d;
          if (!a.fixed) {
            a.x -= nx * push;
            a.y -= ny * push;
          }
          if (!b.fixed) {
            b.x += nx * push;
            b.y += ny * push;
          }
        }
      }
    }
    for (const b of bodies) {
      if (b.fixed) continue;
      const dc = coreDistinctCount?.get(b.id) ?? 0;
      const pull = anchor + Math.min(0.026, dc * 0.007);
      b.x += (b.ax - b.x) * pull;
      b.y += (b.ay - b.y) * pull;
    }
  }

  const out = new Map<string, { x: number; y: number }>();
  for (const b of bodies) out.set(b.id, { x: b.x, y: b.y });
  return out;
};

const layoutNodes = (
  people: Set<string>,
  primaryCore: Map<string, string>,
  coreTieStrength: Map<string, number>,
  coreDistinctCount: Map<string, number>,
  members: readonly string[],
  coreSet: Set<string>,
  twoCoreLayout?: TwoCoreLayout,
): Map<string, { x: number; y: number }> => {
  const centerX = 520;
  const centerY = 400;
  const coreRingR = 215;

  const pos = new Map<string, { x: number; y: number }>();
  if (members.length === 1) {
    pos.set(members[0], { x: centerX, y: centerY });
  } else {
    layoutCoreRing(
      centerX,
      centerY,
      coreRingR,
      members,
      members.length === 2 ? twoCoreLayout : undefined,
    ).forEach((p, id) => pos.set(id, p));
  }
  layoutSatelliteInitial(
    pos,
    people,
    primaryCore,
    coreTieStrength,
    coreDistinctCount,
    centerX,
    centerY,
    coreSet,
    members,
  );

  const initial = new Map(pos);
  return relaxNodePositions(initial, people, coreSet, coreDistinctCount);
};

const buildEdgeOffsetMaps = (rows: DiagramRow[]) => {
  const rankFromSource = new Map<string, number[]>();
  const rankFromTarget = new Map<string, number[]>();
  rows.forEach((r, i) => {
    if (!rankFromSource.has(r.a)) rankFromSource.set(r.a, []);
    rankFromSource.get(r.a)!.push(i);
    if (!rankFromTarget.has(r.b)) rankFromTarget.set(r.b, []);
    rankFromTarget.get(r.b)!.push(i);
  });

  const offsetByIndex = new Map<number, number>();
  const step = 9;

  const assignRanks = (map: Map<string, number[]>) => {
    for (const indices of map.values()) {
      const m = indices.length;
      indices.forEach((edgeIdx, k) => {
        const off = (k - (m - 1) / 2) * step;
        offsetByIndex.set(
          edgeIdx,
          (offsetByIndex.get(edgeIdx) ?? 0) + off * 0.5,
        );
      });
    }
  };

  assignRanks(rankFromSource);
  assignRanks(rankFromTarget);

  return offsetByIndex;
};

const rowsToEdges = (
  rows: DiagramRow[],
  maxP: number,
  offsetByIndex: Map<number, number>,
): Edge[] =>
  rows.map((r, i) => {
    const t = maxP > 0 ? r.points / maxP : 0;
    const stroke = 1.5 + t * 8;
    const width = Math.max(1.2, stroke);

    const rawOff = offsetByIndex.get(i) ?? 0;
    const pathOffset = Math.max(-42, Math.min(42, rawOff));

    return {
      id: `e-${i}-${r.a}-${r.b}`,
      source: r.a,
      target: r.b,
      sourceHandle: "out",
      targetHandle: "in",
      type: "dimensionalSmoothstep",
      pathOptions: { offset: pathOffset, borderRadius: 14 },
      zIndex: DIAGRAM_Z_INDEX.edge,
      label: String(r.points),
      style: { strokeWidth: width },
      labelStyle: { fill: "#4c1d95", fontSize: 10, fontWeight: 600 },
      labelBgStyle: {
        fill: "#faf5ff",
        fillOpacity: 0.96,
      },
      labelBgPadding: [3, 2] as [number, number],
      labelBgBorderRadius: 4,
    };
  });

export const tieHeatStyle = (heat01: number): CSSProperties => {
  const t = Math.max(0, Math.min(1, heat01));
  const h1 = 230 * (1 - t) + 310 * t;
  const h2 = 255 * (1 - t) + 345 * t;
  const h3 = 265 * (1 - t) + 2 * t;
  const s1 = 58 + t * 32;
  const s2 = 62 + t * 28;
  const s3 = 55 + t * 38;
  const l1 = 94 - t * 14;
  const l2 = 88 - t * 18;
  const l3 = 82 - t * 22;
  const bdH = 268 * (1 - t) + 320 * t;
  const txL = 30 + t * 8;
  const fw = 520 + Math.round(t * 280);
  return {
    background: `linear-gradient(148deg, hsl(${h1}, ${s1}%, ${l1}%) 0%, hsl(${h2}, ${s2}%, ${l2}%) 48%, hsl(${h3}, ${s3}%, ${l3}%) 100%)`,
    borderColor: `hsla(${bdH}, 55%, ${52 - t * 12}%, 0.85)`,
    color: `hsl(${h2}, 38%, ${txL}%)`,
    fontWeight: fw,
    borderWidth: 1,
    borderStyle: "solid",
    boxShadow: `0 2px 10px hsla(${h2}, 65%, 40%, ${0.12 + t * 0.2}), inset 0 1px 0 rgba(255,255,255,0.35)`,
  };
};

export const buildDiagramNodesAndEdges = (
  members: readonly string[],
  rows: DiagramRow[],
  opts?: { twoCoreLayout?: TwoCoreLayout },
): { nodes: Node[]; edges: Edge[] } => {
  const coreSet = new Set(members);
  const { people, primaryCore, rows: graphRows, coreTieStrength, coreDistinctCount } =
    buildGraph(rows, coreSet, members);
  const positions = layoutNodes(
    people,
    primaryCore,
    coreTieStrength,
    coreDistinctCount,
    members,
    coreSet,
    opts?.twoCoreLayout,
  );
  const maxPoint = Math.max(1, ...rows.map((r) => r.points));

  /** 関連者（コア以外）の関連ポイント合計の分布: 平均・母標準偏差で z を取り、ヒートを付ける */
  const relatedTieValues: number[] = [];
  for (const id of people) {
    if (!coreSet.has(id)) relatedTieValues.push(coreTieStrength.get(id) ?? 0);
  }
  const nRel = relatedTieValues.length;
  let tieMean = 0;
  for (const x of relatedTieValues) tieMean += x;
  tieMean = nRel > 0 ? tieMean / nRel : 0;
  let tieVarSum = 0;
  for (const x of relatedTieValues) {
    const d = x - tieMean;
    tieVarSum += d * d;
  }
  const tieStd = nRel > 1 ? Math.sqrt(tieVarSum / nRel) : 0;

  const tieHeatFromSum = (sum: number): number => {
    if (nRel <= 1 || tieStd === 0) return 0.5;
    const z = (sum - tieMean) / tieStd;
    // 平均付近は中間色、±2σ 前後でグラデーション端に寄せる
    return Math.max(0, Math.min(1, 0.5 + z / 4));
  };

  const memberCount = members.length;
  const nextNodes: Node[] = [];
  for (const id of people) {
    const p = positions.get(id);
    if (!p) continue;
    const isCore = coreSet.has(id);
    if (isCore) {
      nextNodes.push({
        id,
        position: p,
        data: { label: id },
        type: "core",
        zIndex: DIAGRAM_Z_INDEX.core,
      });
    } else {
      const v = coreTieStrength.get(id) ?? 0;
      const tieHeat = tieHeatFromSum(v);
      nextNodes.push({
        id,
        position: p,
        data: { label: id, tieHeat, tieSum: v, memberCount },
        type: "person",
        zIndex: DIAGRAM_Z_INDEX.person,
      });
    }
  }

  const offsetByIndex = buildEdgeOffsetMaps(graphRows);
  const nextEdges = rowsToEdges(graphRows, maxPoint, offsetByIndex);
  return { nodes: nextNodes, edges: nextEdges };
};
