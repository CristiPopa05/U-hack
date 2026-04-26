/**
 * Goal DNA Network panel — renders the pass-network graph on a pitch
 * and displays the identified buildup pattern.
 *
 * Receives a `GoalDNAPanel` from the API. Lifted from Analysis.tsx +
 * Pitch.tsx network-layer rendering.
 *
 * Phase 5 of `ui_schema_design.md`.
 */
import { useMemo } from "react";
import type { GoalDNAPanel as GoalDNAPanelData, PassEdge } from "@/lib/api/types";
import { Network } from "lucide-react";

interface Props {
  data: GoalDNAPanelData;
}

const W = 1050;
const H = 680;
const GRID_COLS = 16;
const GRID_ROWS = 12;

/** Convert a zone_id (0..191) to pitch SVG coordinates (x, y). */
function zoneToPitch(zoneId: number): { x: number; y: number } {
  const col = zoneId % GRID_COLS;
  const row = Math.floor(zoneId / GRID_COLS);
  return {
    x: ((col + 0.5) / GRID_COLS) * W,
    y: ((row + 0.5) / GRID_ROWS) * H,
  };
}

/** Deduplicate player nodes from edges. */
function uniqueNodes(edges: PassEdge[]) {
  const seen = new Map<number, { id: number; name: string; x: number; y: number }>();
  for (const e of edges) {
    if (!seen.has(e.from_player_id)) {
      const pos = zoneToPitch(e.from_zone_id);
      seen.set(e.from_player_id, { id: e.from_player_id, name: e.from_player_name, ...pos });
    }
    if (!seen.has(e.to_player_id)) {
      const pos = zoneToPitch(e.to_zone_id);
      seen.set(e.to_player_id, { id: e.to_player_id, name: e.to_player_name, ...pos });
    }
  }
  return Array.from(seen.values());
}

const PATTERN_LABELS: Record<string, string> = {
  wide_overload_to_central_finish: "Wide Overload → Central Finish",
  central_progression_through_halfspace: "Central Progression (Half-space)",
  fast_transition_counter: "Fast Transition Counter",
  set_piece_secondary: "Set Piece (Secondary)",
  deep_buildup_long_switch: "Deep Build-up + Long Switch",
  individual_dribble_initiated: "Individual Dribble Initiated",
  mixed_inconclusive: "Mixed / Inconclusive",
};

export function GoalDNAPanel({ data }: Props) {
  const { graph, pattern } = data;
  const nodes = useMemo(() => uniqueNodes(graph.edges), [graph.edges]);

  return (
    <div className="panel p-5 col-span-12 xl:col-span-8" id="panel-goal-dna">
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            {data.title}
          </p>
          <h2 className="font-display text-lg font-semibold tracking-tight mt-1">
            Goal DNA · Pass Network
          </h2>
        </div>
        <div className="w-9 h-9 rounded-md bg-secondary/60 border border-border/60 flex items-center justify-center">
          <Network className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>

      {/* Pitch + pass network */}
      <div className="relative w-full overflow-hidden rounded-lg border border-border/80 bg-[hsl(var(--pitch-base))] shadow-[var(--shadow-glow)]">
        <div className="absolute inset-0 grain" />
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto" preserveAspectRatio="xMidYMid meet">
          <defs>
            <radialGradient id="dnaVignette" cx="50%" cy="50%" r="70%">
              <stop offset="0%" stopColor="hsl(0 0% 10%)" />
              <stop offset="100%" stopColor="hsl(0 0% 5%)" />
            </radialGradient>
            <marker id="arrowDNA" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(0 0% 95%)" />
            </marker>
          </defs>
          <rect x={0} y={0} width={W} height={H} fill="url(#dnaVignette)" />

          {/* Pitch lines (simplified) */}
          <g stroke="hsl(var(--pitch-line) / 0.7)" strokeWidth={2} fill="none" strokeLinejoin="round">
            <rect x={20} y={20} width={W - 40} height={H - 40} />
            <line x1={W / 2} y1={20} x2={W / 2} y2={H - 20} />
            <circle cx={W / 2} cy={H / 2} r={75} />
            <circle cx={W / 2} cy={H / 2} r={3} fill="hsl(var(--pitch-line) / 0.9)" />
            <rect x={20} y={H / 2 - 130} width={150} height={260} />
            <rect x={W - 170} y={H / 2 - 130} width={150} height={260} />
            <rect x={20} y={H / 2 - 55} width={55} height={110} />
            <rect x={W - 75} y={H / 2 - 55} width={55} height={110} />
          </g>

          {/* Pass edges */}
          {graph.edges.map((e, i) => {
            const from = zoneToPitch(e.from_zone_id);
            const to = zoneToPitch(e.to_zone_id);
            const w = Math.max(e.weight, 1);
            const sw = 1.5 + w * 2.5;
            const opacity = 0.4 + Math.min(w, 3) * 0.2;
            return (
              <line
                key={i}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={`hsl(0 0% 80% / ${opacity})`}
                strokeWidth={sw}
                markerEnd="url(#arrowDNA)"
                strokeLinecap="round"
              />
            );
          })}

          {/* Player nodes */}
          {nodes.map((n) => (
            <g key={n.id}>
              <circle cx={n.x} cy={n.y} r={20} fill="hsl(0 0% 8%)" stroke="hsl(0 0% 95%)" strokeWidth={1.5} />
              <text
                x={n.x}
                y={n.y + 38}
                textAnchor="middle"
                fill="hsl(0 0% 70%)"
                fontSize={11}
                fontFamily="Inter"
              >
                {n.name.length > 12 ? n.name.slice(0, 11) + "…" : n.name}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* Pattern info */}
      <div className="mt-4 rounded-lg border border-border/60 bg-secondary/20 p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              Identified pattern
            </p>
            <p className="font-semibold text-sm mt-0.5">
              {PATTERN_LABELS[pattern.pattern_signature] ?? pattern.pattern_signature}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              Confidence
            </p>
            <p className="font-display text-lg font-semibold mt-0.5">
              {(pattern.confidence * 100).toFixed(0)}%
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{pattern.description}</p>
        {pattern.is_based_on_synthesised_input && (
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mt-2">
            ⚠ Based on synthesised (no-goal) data — treat as hypothesis
          </p>
        )}
      </div>
    </div>
  );
}
