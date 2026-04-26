/**
 * Panel B renderer — Danger Creator player cards.
 *
 * Receives a `DangerCreatorPanel` from the API and renders player cards
 * sorted by total xT value. Lifted from the existing Analysis.tsx Panel B.
 *
 * Phase 5 of `ui_schema_design.md`.
 */
import { useState } from "react";
import type { DangerCreatorPanel as DangerCreatorPanelData } from "@/lib/api/types";
import { Flame, ChevronDown, ChevronUp } from "lucide-react";

interface Props {
  data: DangerCreatorPanelData;
}

export function DangerCreatorPanel({ data }: Props) {
  const [expandedRoster, setExpandedRoster] = useState(false);
  const topPlayers = data.players.slice(0, 3);

  return (
    <div className="panel p-5 col-span-12 md:col-span-6 xl:col-span-4" id="panel-danger-creator">
      <div className="flex items-start justify-between mb-5">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Panel B</p>
          <h2 className="font-display text-lg font-semibold tracking-tight mt-1">{data.title}</h2>
          <p className="text-xs text-muted-foreground mt-1">Top xT contributors</p>
        </div>
        <div className="w-9 h-9 rounded-md bg-foreground text-background flex items-center justify-center">
          <Flame className="w-4 h-4" />
        </div>
      </div>

      {/* Top 3 players */}
      <div className="space-y-3">
        {topPlayers.map((p, i) => {
          const primary = p.is_primary;
          return (
            <div
              key={p.player_id}
              className={`relative w-full text-left rounded-lg border p-4 transition ${
                primary
                  ? "border-foreground/30 bg-foreground/5"
                  : "border-border/60 bg-secondary/20"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center font-display font-bold text-sm ${
                      primary
                        ? "bg-foreground text-background"
                        : "bg-secondary text-muted-foreground border border-border"
                    }`}
                  >
                    {i + 1}
                  </div>
                  <div>
                    <p className={`font-medium ${primary ? "text-foreground" : "text-muted-foreground"}`}>
                      {p.name}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider mt-0.5 text-muted-foreground/80">
                      {p.position ?? "—"} · {p.minutes}'
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`font-display text-2xl ${primary ? "text-foreground" : "text-muted-foreground"}`}>
                    {p.total_xt_value.toFixed(2)}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">xT</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-border/50">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Passes</p>
                  <p className="text-sm font-mono mt-0.5">{p.passes}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Assists</p>
                  <p className="text-sm font-mono mt-0.5">{p.assists}</p>
                </div>
              </div>
              {primary && (
                <div className="absolute -top-2 right-3 px-2 py-0.5 rounded-full bg-foreground text-background text-[10px] uppercase tracking-wider font-medium">
                  Primary target
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Narrative */}
      {data.narrative && (
        <p className="text-xs text-muted-foreground mt-4 leading-relaxed italic border-t border-border/50 pt-3">
          {data.narrative}
        </p>
      )}

      {/* Expand roster */}
      {data.players.length > 3 && (
        <>
          <button
            onClick={() => setExpandedRoster((v) => !v)}
            className="mt-4 w-full inline-flex items-center justify-center gap-1.5 text-[11px] uppercase tracking-[0.25em] text-muted-foreground hover:text-foreground transition py-2 border-t border-border/50"
          >
            {expandedRoster ? "Hide full roster" : "View all players"}
            {expandedRoster ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {expandedRoster && (
            <div className="mt-3 max-h-72 overflow-y-auto scrollbar-thin-mono pr-2 animate-fade-in">
              <ul className="space-y-1">
                {data.players.map((p, i) => (
                  <li key={p.player_id}>
                    <div className="w-full flex items-center justify-between gap-3 rounded-md px-3 py-2 text-left border border-transparent hover:bg-zinc-800/60 hover:border-border/50 transition">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-mono text-[11px] w-5 text-right text-muted-foreground">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="text-sm font-medium truncate">{p.name}</span>
                        <span className="text-[10px] uppercase tracking-wider shrink-0 text-muted-foreground">
                          {p.position ?? "—"}
                        </span>
                      </div>
                      <span className="font-display text-sm shrink-0 text-foreground">
                        {p.total_xt_value.toFixed(2)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
