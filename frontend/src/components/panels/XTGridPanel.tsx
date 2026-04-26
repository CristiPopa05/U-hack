/**
 * Panel A renderer — xT heatmap grid on the pitch.
 *
 * Receives an `XTGridPanel` from the API and renders the 12×16 cell grid
 * using the same pitch SVG structure as the existing `Pitch` component.
 *
 * Phase 5 of `ui_schema_design.md`.
 */
import type { XTGridPanel as XTGridPanelData } from "@/lib/api/types";
import { Layers } from "lucide-react";

interface Props {
  data: XTGridPanelData;
}

const ROWS = 12;
const COLS = 16;
const W = 1050;
const H = 680;

export function XTGridPanel({ data }: Props) {
  const { grid, range } = data;
  const span = range.max - range.min || 1;

  return (
    <div className="panel p-5 col-span-12 xl:col-span-8" id="panel-xt-grid">
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Panel A</p>
          <h2 className="font-display text-lg font-semibold tracking-tight mt-1">
            {data.title} · 16×12 zones
          </h2>
        </div>
        <div className="w-9 h-9 rounded-md bg-foreground text-background flex items-center justify-center">
          <Layers className="w-4 h-4" />
        </div>
      </div>

      <div className="relative w-full overflow-hidden rounded-lg border border-border/80 bg-[hsl(var(--pitch-base))] shadow-[var(--shadow-glow)]">
        <div className="absolute inset-0 grain" />
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {/* Vignette background */}
          <defs>
            <radialGradient id="xtVignette" cx="50%" cy="50%" r="70%">
              <stop offset="0%" stopColor="hsl(0 0% 10%)" />
              <stop offset="100%" stopColor="hsl(0 0% 5%)" />
            </radialGradient>
          </defs>
          <rect x={0} y={0} width={W} height={H} fill="url(#xtVignette)" />

          {/* xT heatmap cells */}
          <g opacity={0.95}>
            {grid.map((row, r) =>
              row.map((val, c) => {
                const v = Math.min(1, Math.max(0, (val - range.min) / span));
                const cw = W / COLS;
                const ch = H / ROWS;
                const lightness = 6 + v * 78;
                const alpha = 0.55 + v * 0.45;
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

          {/* Pitch lines */}
          <g stroke="hsl(var(--pitch-line) / 0.7)" strokeWidth={2} fill="none" strokeLinejoin="round">
            <rect x={20} y={20} width={W - 40} height={H - 40} />
            <line x1={W / 2} y1={20} x2={W / 2} y2={H - 20} />
            <circle cx={W / 2} cy={H / 2} r={75} />
            <circle cx={W / 2} cy={H / 2} r={3} fill="hsl(var(--pitch-line) / 0.9)" />
            <rect x={20} y={H / 2 - 130} width={150} height={260} />
            <rect x={W - 170} y={H / 2 - 130} width={150} height={260} />
            <rect x={20} y={H / 2 - 55} width={55} height={110} />
            <rect x={W - 75} y={H / 2 - 55} width={55} height={110} />
            <circle cx={120} cy={H / 2} r={2.5} fill="hsl(var(--pitch-line) / 0.9)" />
            <circle cx={W - 120} cy={H / 2} r={2.5} fill="hsl(var(--pitch-line) / 0.9)" />
            <path d={`M 170 ${H / 2 - 40} A 50 50 0 0 1 170 ${H / 2 + 40}`} />
            <path d={`M ${W - 170} ${H / 2 - 40} A 50 50 0 0 0 ${W - 170} ${H / 2 + 40}`} />
          </g>

          {/* Faint grid lines */}
          <g stroke="hsl(0 0% 100% / 0.04)">
            {Array.from({ length: COLS - 1 }).map((_, i) => (
              <line key={`v${i}`} x1={(W / COLS) * (i + 1)} x2={(W / COLS) * (i + 1)} y1={0} y2={H} />
            ))}
            {Array.from({ length: ROWS - 1 }).map((_, i) => (
              <line key={`h${i}`} x1={0} x2={W} y1={(H / ROWS) * (i + 1)} y2={(H / ROWS) * (i + 1)} />
            ))}
          </g>

          {/* Direction arrow */}
          <g opacity={0.6}>
            <defs>
              <marker id="dirArrowXT" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(0 0% 80%)" />
              </marker>
            </defs>
            <line x1={W - 200} y1={H - 40} x2={W - 40} y2={H - 40} stroke="hsl(0 0% 80%)" strokeWidth={1} markerEnd="url(#dirArrowXT)" />
            <text x={W - 200} y={H - 50} fill="hsl(0 0% 65%)" fontSize={11} fontFamily="Inter" letterSpacing={1}>
              ATTACK →
            </text>
          </g>
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
        <p>Threat zones · 16×12 grid</p>
        <div className="flex items-center gap-2">
          <span>{range.min.toFixed(3)}</span>
          <span className="w-32 h-1.5 rounded-full bg-gradient-to-r from-[hsl(0_0%_8%)] to-[hsl(0_0%_95%)] border border-border/60" />
          <span>{range.max.toFixed(3)}</span>
        </div>
      </div>
    </div>
  );
}
