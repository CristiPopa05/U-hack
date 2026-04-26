import { useMemo } from "react";
import { generateXTGrid, generateHeatmap, PASS_NODES, PASS_LINKS, type MadePass } from "@/lib/mock-data";
import { type GoalSequence } from "@/lib/spatial-service";

type Layer = "xt" | "passes" | "network" | "leaders";

// Mock data for xT Leaders By Zone (8 cols x 6 rows = 48 zones)
const LEADER_ZONES_BASE: { name: string; xt: number; intensity: number }[] = [
  { name: "Ș. Târnovanu", xt: 0.018, intensity: 0.05 },
  { name: "R. Radunović", xt: 0.042, intensity: 0.18 },
  { name: "M. Popescu", xt: 0.038, intensity: 0.14 },
  { name: "S. Ngezana", xt: 0.041, intensity: 0.16 },
  { name: "V. Crețu", xt: 0.045, intensity: 0.2 },
  { name: "M. Popescu", xt: 0.022, intensity: 0.08 },
  { name: "R. Radunović", xt: 0.061, intensity: 0.28 },
  { name: "A. Șut", xt: 0.084, intensity: 0.42 },
  { name: "A. Șut", xt: 0.092, intensity: 0.48 },
  { name: "V. Crețu", xt: 0.068, intensity: 0.34 },
  { name: "S. Ngezana", xt: 0.031, intensity: 0.12 },
  { name: "V. Lixandru", xt: 0.078, intensity: 0.4 },
  { name: "D. Olaru", xt: 0.124, intensity: 0.62 },
  { name: "D. Olaru", xt: 0.142, intensity: 0.74 },
  { name: "M. Tavares", xt: 0.088, intensity: 0.46 },
  { name: "A. Șut", xt: 0.054, intensity: 0.24 },
  { name: "F. Coman", xt: 0.118, intensity: 0.6 },
  { name: "D. Olaru", xt: 0.168, intensity: 0.82 },
  { name: "D. Olaru", xt: 0.182, intensity: 0.88 },
  { name: "O. Popescu", xt: 0.132, intensity: 0.7 },
  { name: "V. Lixandru", xt: 0.072, intensity: 0.36 },
  { name: "F. Coman", xt: 0.156, intensity: 0.78 },
  { name: "F. Coman", xt: 0.198, intensity: 0.94 },
  { name: "D. Bîrligea", xt: 0.211, intensity: 1.0 },
  { name: "O. Popescu", xt: 0.174, intensity: 0.86 },
  { name: "F. Coman", xt: 0.108, intensity: 0.56 },
  { name: "D. Bîrligea", xt: 0.148, intensity: 0.76 },
  { name: "D. Bîrligea", xt: 0.192, intensity: 0.92 },
  { name: "D. Bîrligea", xt: 0.165, intensity: 0.84 },
  { name: "O. Popescu", xt: 0.096, intensity: 0.5 },
];

// Expand to 48 zones (8x6) by repeating with slight variations
const LEADER_ZONES = Array.from({ length: 48 }).map((_, i) => {
  const base = LEADER_ZONES_BASE[i % LEADER_ZONES_BASE.length];
  const jitter = ((i * 37) % 13) / 100; // 0..0.12
  const intensity = Math.max(0.04, Math.min(1, base.intensity + jitter - 0.06));
  const xt = +(base.xt * (0.85 + jitter)).toFixed(3);
  return { name: base.name, xt, intensity };
});

interface PitchFocus {
  x: number; // 0..1
  y: number; // 0..1
  spread: number; // in cell units
}

interface PitchProps {
  layer: Layer;
  seed?: number;
  focus?: PitchFocus | null;
  passes?: MadePass[];
  /** Normalized 12×16 xT matrix from Supabase (values 0..1 where 1 = max zone). Overrides mock data when present. */
  xtMatrix?: number[][] | null;
  /** Real leader zones from Supabase (48 entries, 8×6). Overrides mock LEADER_ZONES when present. */
  leaderZones?: { name: string; xt: number; intensity: number }[] | null;
  /** Real goal sequence from Supabase to show build-up. Overrides mock PASS_LINKS when present. */
  goalSequence?: GoalSequence;
}

const ROWS = 12;
const COLS = 16;

function generateFocusGrid(focus: PitchFocus): number[][] {
  const cx = focus.x * (COLS - 1);
  const cy = focus.y * (ROWS - 1);
  const r = focus.spread;
  const g: number[][] = [];
  for (let row = 0; row < ROWS; row++) {
    const arr: number[] = [];
    for (let col = 0; col < COLS; col++) {
      const d = Math.hypot(col - cx, row - cy);
      const v = Math.exp(-(d * d) / (2 * r * r));
      arr.push(Math.max(0.02, Math.min(1, v)));
    }
    g.push(arr);
  }
  return g;
}

export function Pitch({ layer, seed = 1, focus, passes, xtMatrix, leaderZones, goalSequence }: PitchProps) {
  const xtTeam = useMemo(() => generateXTGrid(seed), [seed]);
  const hmTeam = useMemo(() => generateHeatmap(seed + 1), [seed]);
  const focusGrid = useMemo(() => (focus ? generateFocusGrid(focus) : null), [focus]);

  // If we have real data from Supabase, use that; otherwise fallback to mock
  const hasRealData = !!xtMatrix && xtMatrix.length > 0;

  // Normalize: xt original max ~0.28, heatmap 0..1
  const xt = hasRealData
    ? xtMatrix!
    : focusGrid
    ? focusGrid.map((row) => row.map((v) => v * 0.28))
    : xtTeam;
  const hm = focusGrid ?? hmTeam;

  // SVG viewBox proportional to 105:68
  const W = 1050, H = 680;

  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-border/80 bg-[hsl(var(--pitch-base))] shadow-[var(--shadow-glow)]">
      <div className="absolute inset-0 grain" />
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto" preserveAspectRatio="xMidYMid meet">
        {/* subtle gradient base */}
        <defs>
          <radialGradient id="pitchVignette" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor="hsl(0 0% 10%)" />
            <stop offset="100%" stopColor="hsl(0 0% 5%)" />
          </radialGradient>
          <linearGradient id="cellXT" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="hsl(0 0% 8%)" />
            <stop offset="1" stopColor="hsl(0 0% 100%)" />
          </linearGradient>
        </defs>
        <rect x={0} y={0} width={W} height={H} fill="url(#pitchVignette)" />

        {/* xT Grid heat cells */}
        {layer === "xt" && (
          <g opacity={0.95}>
            {Array.from({ length: ROWS }).flatMap((_, r) =>
              Array.from({ length: COLS }).map((_, c) => {
                // When using real data, values are already normalized 0..1
                // When using mock data, normalize by dividing by 0.28
                const raw = hasRealData ? (xt[r]?.[c] ?? 0) : xt[r][c] / 0.28;
                // Apply gamma correction for more gradual brightness (v^0.3)
                const v = hasRealData ? Math.pow(raw, 0.3) : raw;
                const cw = W / COLS, ch = H / ROWS;
                const lightness = 10 + v * 75;
                const alpha = 0.5 + v * 0.5;
                return (
                  <rect
                    key={`${r}-${c}`}
                    x={c * cw}
                    y={r * ch}
                    width={cw}
                    height={ch}
                    fill={`hsl(0 0% ${lightness}% / ${alpha})`}
                  />
                );
              })
            )}
          </g>
        )}

        {/* Pitch lines */}
        <g
          stroke="hsl(var(--pitch-line) / 0.7)"
          strokeWidth={2}
          fill="none"
          strokeLinejoin="round"
        >
          <rect x={20} y={20} width={W - 40} height={H - 40} />
          <line x1={W / 2} y1={20} x2={W / 2} y2={H - 20} />
          <circle cx={W / 2} cy={H / 2} r={75} />
          <circle cx={W / 2} cy={H / 2} r={3} fill="hsl(var(--pitch-line) / 0.9)" />
          {/* Penalty boxes */}
          <rect x={20} y={H / 2 - 130} width={150} height={260} />
          <rect x={W - 170} y={H / 2 - 130} width={150} height={260} />
          {/* 6-yard */}
          <rect x={20} y={H / 2 - 55} width={55} height={110} />
          <rect x={W - 75} y={H / 2 - 55} width={55} height={110} />
          {/* Penalty spots */}
          <circle cx={120} cy={H / 2} r={2.5} fill="hsl(var(--pitch-line) / 0.9)" />
          <circle cx={W - 120} cy={H / 2} r={2.5} fill="hsl(var(--pitch-line) / 0.9)" />
          {/* Arcs */}
          <path d={`M 170 ${H / 2 - 40} A 50 50 0 0 1 170 ${H / 2 + 40}`} />
          <path d={`M ${W - 170} ${H / 2 - 40} A 50 50 0 0 0 ${W - 170} ${H / 2 + 40}`} />
        </g>

        {/* Cell grid overlay (very faint) */}
        <g stroke="hsl(0 0% 100% / 0.04)">
          {Array.from({ length: COLS - 1 }).map((_, i) => (
            <line key={`v${i}`} x1={(W / COLS) * (i + 1)} x2={(W / COLS) * (i + 1)} y1={0} y2={H} />
          ))}
          {Array.from({ length: ROWS - 1 }).map((_, i) => (
            <line key={`h${i}`} x1={0} x2={W} y1={(H / ROWS) * (i + 1)} y2={(H / ROWS) * (i + 1)} />
          ))}
        </g>

        {/* Made Passes (success/fail arrows) */}
        {layer === "passes" && passes && (
          <g>
            <defs>
              <marker id="arrowSuccess" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#064512" />
              </marker>
              <marker id="arrowFail" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#8C1E06" />
              </marker>
            </defs>
            {passes.map((p, i) => {
              const x1 = p.from.x * W, y1 = p.from.y * H;
              const x2 = p.to.x * W, y2 = p.to.y * H;
              const stroke = p.success ? "#064512" : "#8C1E06";
              const marker = p.success ? "url(#arrowSuccess)" : "url(#arrowFail)";
              return (
                <line
                  key={i}
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={stroke}
                  strokeWidth={2.4}
                  strokeOpacity={0.78}
                  markerEnd={marker}
                  strokeLinecap="round"
                />
              );
            })}
            {passes.map((p, i) => (
              <circle
                key={`o-${i}`}
                cx={p.from.x * W}
                cy={p.from.y * H}
                r={3}
                fill={p.success ? "#064512" : "#8C1E06"}
                opacity={0.9}
              />
            ))}
          </g>
        )}

        {/* Goal DNA Network (team only) */}
        {layer === "network" && (
          <g>
            <defs>
              <marker id="arrowNet" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(0 0% 95%)" />
              </marker>
            </defs>
            {goalSequence ? (
              // REAL GOAL SEQUENCE DATA
              <>
                {goalSequence.events.map((ev, i) => {
                  const x1 = (ev.start_x / 100) * W;
                  const y1 = (ev.start_y / 100) * H;
                  const x2 = (ev.end_x / 100) * W;
                  const y2 = (ev.end_y / 100) * H;
                  
                  // Goal shot in yellow, else normal pass
                  const isGoal = ev.event_type === 'goal';
                  const strokeColor = isGoal ? "hsl(45 100% 60%)" : "hsl(0 0% 95%)";
                  const strokeOpacity = isGoal ? 0.9 : 0.6;
                  const sw = isGoal ? 3 : 2;
                  
                  return (
                    <line
                      key={`seq-line-${i}`}
                      x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke={strokeColor}
                      strokeOpacity={strokeOpacity}
                      strokeWidth={sw}
                      markerEnd="url(#arrowNet)"
                      strokeLinecap="round"
                    />
                  );
                })}
                {goalSequence.events.map((ev, i) => {
                  const x = (ev.start_x / 100) * W;
                  const y = (ev.start_y / 100) * H;
                  
                  // Shorten name to last name if possible
                  const parts = ev.player_name.split(' ');
                  const displayName = parts.length > 1 ? parts[parts.length - 1] : ev.player_name;
                  
                  return (
                    <g key={`seq-node-${i}`}>
                      <circle cx={x} cy={y} r={18} fill="hsl(0 0% 8%)" stroke="hsl(0 0% 95%)" strokeWidth={1.5} />
                      <text x={x} y={y + 5} textAnchor="middle" fill="hsl(0 0% 95%)" fontSize={13} fontWeight={700} fontFamily="Space Grotesk, Inter">
                        {i + 1}
                      </text>
                      <text x={x} y={y + 34} textAnchor="middle" fill="hsl(0 0% 70%)" fontSize={11} fontFamily="Inter">
                        {displayName}
                      </text>
                    </g>
                  );
                })}
              </>
            ) : (
              // MOCK DATA FALLBACK
              <>
                {PASS_LINKS.map((l, i) => {
                  const from = PASS_NODES.find((n) => n.id === l.from);
                  const to = PASS_NODES.find((n) => n.id === l.to);
                  if (!from || !to) return null;
                  const x1 = from.x * W, y1 = from.y * H, x2 = to.x * W, y2 = to.y * H;
                  const lightness = 50 + l.weight * 50;
                  const sw = 1.2 + l.weight * 4.2;
                  return (
                    <line
                      key={i}
                      x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke={`hsl(0 0% ${lightness}% / ${0.35 + l.weight * 0.55})`}
                      strokeWidth={sw}
                      markerEnd="url(#arrowNet)"
                      strokeLinecap="round"
                    />
                  );
                })}
                {PASS_NODES.map((n) => {
                  const x = n.x * W, y = n.y * H;
                  return (
                    <g key={n.id}>
                      <circle cx={x} cy={y} r={20} fill="hsl(0 0% 8%)" stroke="hsl(0 0% 95%)" strokeWidth={1.5} />
                      <text x={x} y={y + 5} textAnchor="middle" fill="hsl(0 0% 95%)" fontSize={14} fontWeight={700} fontFamily="Space Grotesk, Inter">
                        {n.num}
                      </text>
                      <text x={x} y={y + 38} textAnchor="middle" fill="hsl(0 0% 70%)" fontSize={11} fontFamily="Inter">
                        {n.name}
                      </text>
                    </g>
                  );
                })}
              </>
            )}
          </g>
        )}

        {/* xT Leaders By Zone (6x5 grid) */}
        {layer === "leaders" && (
          <g>
            {Array.from({ length: 6 }).flatMap((_, row) =>
              Array.from({ length: 8 }).map((_, col) => {
                const idx = row * 8 + col;
                const z = (leaderZones && leaderZones.length > 0 ? leaderZones : LEADER_ZONES)[idx];
                const cw = (W - 40) / 8;
                const ch = (H - 40) / 6;
                const x = 20 + col * cw;
                const y = 20 + row * ch;
                const lightness = 22 + Math.pow(z.intensity, 0.4) * 65; // gamma-corrected, base 22%
                const lightBg = lightness > 50;
                const textFill = lightBg ? "#000" : "#fff";
                return (
                  <g key={`lz-${idx}`}>
                    <rect
                      x={x}
                      y={y}
                      width={cw}
                      height={ch}
                      fill={`hsl(0 0% ${lightness}%)`}
                      stroke="hsl(0 0% 100% / 0.25)"
                      strokeWidth={1.5}
                    />
                    <text
                      x={x + cw / 2}
                      y={y + ch / 2 - 4}
                      textAnchor="middle"
                      fill={textFill}
                      fontSize={15}
                      fontWeight={600}
                      fontFamily="Inter, sans-serif"
                      style={{ paintOrder: "stroke", stroke: lightBg ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.6)", strokeWidth: 2, strokeLinejoin: "round" }}
                    >
                      {z.name}
                    </text>
                    <text
                      x={x + cw / 2}
                      y={y + ch / 2 + 18}
                      textAnchor="middle"
                      fill={textFill}
                      fontSize={16}
                      fontWeight={700}
                      fontFamily="Space Grotesk, Inter, sans-serif"
                      style={{ paintOrder: "stroke", stroke: lightBg ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.6)", strokeWidth: 2, strokeLinejoin: "round" }}
                    >
                      {z.xt.toFixed(3)}
                    </text>
                  </g>
                );
              })
            )}
          </g>
        )}

        {/* Direction of attack arrow */}
        <g opacity={0.6}>
          <line x1={W - 200} y1={H - 40} x2={W - 40} y2={H - 40} stroke="hsl(0 0% 80%)" strokeWidth={1} markerEnd="url(#dirArrow)" />
          <defs>
            <marker id="dirArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(0 0% 80%)" />
            </marker>
          </defs>
          <text x={W - 200} y={H - 50} fill="hsl(0 0% 65%)" fontSize={11} fontFamily="Inter" letterSpacing={1}>
            ATTACK →
          </text>
        </g>
      </svg>
    </div>
  );
}
