/**
 * Panel D renderer — 5-Phase Tactical Verdict.
 *
 * Receives a `TacticalVerdictPanel` from the API and renders the
 * honest phase-by-phase narrative cards. Lifted from Analysis.tsx Panel D.
 *
 * Phase 5 of `ui_schema_design.md`.
 */
import type { TacticalVerdictPanel as TacticalVerdictPanelData } from "@/lib/api/types";
import { Brain } from "lucide-react";

interface Props {
  data: TacticalVerdictPanelData;
}

export function TacticalVerdictPanel({ data }: Props) {
  return (
    <div className="panel p-5 col-span-12 xl:col-span-5" id="panel-tactical-verdict">
      <div className="flex items-start justify-between mb-5">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Panel D</p>
          <h2 className="font-display text-lg font-semibold tracking-tight mt-1">{data.title}</h2>
          <p className="text-xs text-muted-foreground mt-1">LLM agent synthesis · scraped event data</p>
        </div>
        <div className="w-9 h-9 rounded-md bg-secondary/60 border border-border/60 flex items-center justify-center">
          <Brain className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>

      {/* Headline + summary */}
      <div className="mb-5 rounded-lg border border-foreground/20 bg-foreground/[0.03] p-4">
        <p className="font-semibold text-sm leading-relaxed">{data.headline}</p>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{data.summary}</p>
        <div className="mt-3 pt-3 border-t border-border/40 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>Confidence</span>
          <span className="font-mono font-semibold text-foreground">
            {(data.confidence * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Phase cards */}
      <ol className="space-y-4">
        {data.phases.map((phase, i) => (
          <li key={i} className="flex gap-4">
            <div className="flex flex-col items-center">
              <span className="w-7 h-7 rounded-full border border-border bg-secondary/40 flex items-center justify-center text-xs font-mono text-muted-foreground">
                {String(i + 1).padStart(2, "0")}
              </span>
              {i < data.phases.length - 1 && <span className="w-px flex-1 bg-border mt-1" />}
            </div>
            <div className="flex-1 pb-1">
              <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                {phase.phase_label}
              </p>
              <p className="font-semibold text-sm mt-0.5">{phase.title}</p>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed font-light">
                {phase.body}
              </p>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground/50 mt-1">
                source: {phase.source}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 pt-4 border-t border-border/60 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>U-xT Agent · 5-Phase Pipeline</span>
        <span className="font-mono">{new Date().toISOString().slice(0, 10)}</span>
      </div>
    </div>
  );
}
