import { useState, useEffect } from "react";
import { toast } from "@/hooks/use-toast";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { TEAMS } from "@/lib/mock-data";
import { useDashboard } from "@/hooks/useDashboard";
import type { DashboardPayload, Panel } from "@/lib/api/types";
import {
  isXTGridPanel,
  isDangerCreatorPanel,
  isVulnerabilityAlertsPanel,
  isGoalDNAPanel,
  isTacticalVerdictPanel,
  findPanel,
} from "@/lib/api/types";
import { XTGridPanel } from "@/components/panels/XTGridPanel";
import { DangerCreatorPanel } from "@/components/panels/DangerCreatorPanel";
import { VulnerabilityAlertsPanel } from "@/components/panels/VulnerabilityAlertsPanel";
import { GoalDNAPanel } from "@/components/panels/GoalDNAPanel";
import { TacticalVerdictPanel } from "@/components/panels/TacticalVerdictPanel";
import { TeamCrest } from "@/components/TeamCrest";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Check,
  Play,
  Loader2,
  Database,
  AlertTriangle,
} from "lucide-react";

// ── Pipeline loading steps (fake progress while LLM runs) ───────────────

const PIPELINE_STEPS = [
  "Fetching match data from Supabase...",
  "Phase 1-2 · Ingestion + xT Engine...",
  "Phase 3 · Zone Analysis...",
  "Phase 4 · Goal DNA Pattern Recognition...",
  "Phase 5 · Tactical Verdict (Gemini Pro)...",
  "Assembling dashboard payload...",
];

// ── Panel renderer registry ─────────────────────────────────────────────

const RENDERERS: Record<
  Panel["type"],
  (panel: Panel) => React.ReactNode
> = {
  xt_grid: (p) => <XTGridPanel key="xt_grid" data={p as any} />,
  danger_creator: (p) => <DangerCreatorPanel key="danger_creator" data={p as any} />,
  vulnerability_alerts: (p) => <VulnerabilityAlertsPanel key="vulnerability_alerts" data={p as any} />,
  goal_dna_network: (p) => <GoalDNAPanel key="goal_dna_network" data={p as any} />,
  tactical_verdict: (p) => <TacticalVerdictPanel key="tactical_verdict" data={p as any} />,
};

// ── Component ───────────────────────────────────────────────────────────

const Analysis = () => {
  const { teamId } = useParams();
  const [searchParams] = useSearchParams();
  const team = TEAMS.find((t) => t.id === teamId) ?? TEAMS[0];

  // Read matchId and demo flag from URL: /analysis/cfr?matchId=3001&demo=1
  const matchIdParam = searchParams.get("matchId");
  const matchId = matchIdParam ? parseInt(matchIdParam, 10) : null;
  const isDemo = searchParams.get("demo") === "1";

  // Pipeline state
  const [shouldFetch, setShouldFetch] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [matchWindow, setMatchWindow] = useState("5");

  // API query
  const { data, isLoading, error, refetch } = useDashboard(matchId, {
    demo: isDemo,
    enabled: shouldFetch && matchId !== null,
  });

  // ── Start Analysis handler ──────────────────────────────────────────

  const runPipeline = () => {
    if (!matchId) {
      toast({
        title: "No match ID",
        description:
          "Add ?matchId=<number> to the URL (e.g. /analysis/cfr?matchId=3001).",
      });
      return;
    }
    setShouldFetch(true);
    setIsRunning(true);
    setActiveStep(0);
  };

  // ── Loading overlay animation ─────────────────────────────────────

  useEffect(() => {
    if (!isRunning) return;

    // If data arrived (or error), finish the overlay
    if (data || error) {
      const t = setTimeout(() => setIsRunning(false), 400);
      return () => clearTimeout(t);
    }

    // Auto-advance fake steps (slower — 6s per step to fill ~30s pipeline)
    if (activeStep < PIPELINE_STEPS.length) {
      const delay = isDemo ? 400 : 6000;
      const t = setTimeout(() => setActiveStep((s) => s + 1), delay);
      return () => clearTimeout(t);
    }
    // If we're past all steps but data hasn't arrived yet, stay on last step
  }, [isRunning, activeStep, data, error, isDemo]);

  // ── Notify on error ───────────────────────────────────────────────

  useEffect(() => {
    if (error) {
      toast({
        title: "Pipeline failed",
        description:
          error instanceof Error ? error.message : "Unknown error",
      });
    }
  }, [error]);

  // ── Derived state ─────────────────────────────────────────────────

  const hasData = !!data;

  return (
    <main className="min-h-screen relative">
      {/* Header */}
      <header className="border-b border-border/60 backdrop-blur-sm sticky top-0 z-30 bg-background/80">
        <div className="max-w-[1400px] mx-auto px-6 h-20 flex items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground -ml-2">
              <Link to="/">
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to Teams
              </Link>
            </Button>
            <div className="h-8 w-px bg-border" />
            <div className="flex items-center gap-4">
              <TeamCrest short={team.short} teamId={team.id} teamName={team.name} size={44} />
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Opponent dossier</p>
                <h1 className="font-display text-xl font-semibold tracking-tight leading-tight">{team.name}</h1>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="hidden lg:inline text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                Match window
              </span>
              <Select value={matchWindow} onValueChange={setMatchWindow}>
                <SelectTrigger className="h-10 w-[170px] bg-secondary/40 border-border/60 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">Last 3 Matches</SelectItem>
                  <SelectItem value="5">Last 5 Matches</SelectItem>
                  <SelectItem value="10">Last 10 Matches</SelectItem>
                  <SelectItem value="season">Full Season</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {matchId && (
              <span className="hidden md:inline text-[10px] font-mono text-muted-foreground bg-secondary/60 px-2 py-1 rounded">
                match #{matchId}{isDemo ? " · demo" : ""}
              </span>
            )}
            <Button
              onClick={runPipeline}
              disabled={isRunning || isLoading}
              className="bg-foreground text-background hover:bg-foreground/90 h-10"
            >
              {isRunning || isLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              Start Analysis
            </Button>
          </div>
        </div>
      </header>

      {/* Pipeline Loading Overlay */}
      {isRunning && (
        <div className="fixed inset-0 z-50 bg-background/85 backdrop-blur-md flex items-center justify-center px-6 animate-fade-in">
          <div className="panel p-10 max-w-xl w-full">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 rounded-lg bg-foreground text-background flex items-center justify-center">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                  {isDemo ? "Loading demo cache" : "5-Phase LLM Pipeline"}
                </p>
                <h2 className="font-display text-xl font-semibold tracking-tight mt-0.5">
                  {isDemo ? "Demo mode" : "Running pipeline"} · {team.name}
                </h2>
              </div>
            </div>

            <ul className="space-y-3">
              {PIPELINE_STEPS.map((step, i) => {
                const done = i < activeStep;
                const active = i === activeStep && !data;
                const waiting = i >= activeStep && !data;
                return (
                  <li
                    key={i}
                    className={`flex items-center gap-3 rounded-lg border p-4 transition ${
                      done || (data && i <= activeStep)
                        ? "border-border/60 bg-secondary/20"
                        : active
                        ? "border-foreground/40 bg-foreground/5"
                        : "border-border/40 bg-transparent opacity-50"
                    }`}
                  >
                    <div
                      className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center ${
                        done || data
                          ? "bg-foreground text-background"
                          : active
                          ? "bg-foreground/10 border border-foreground/30 text-foreground"
                          : "bg-secondary border border-border text-muted-foreground"
                      }`}
                    >
                      {done || data ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : active ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <span className="text-[11px] font-mono">{i + 1}</span>
                      )}
                    </div>
                    <p className={`text-sm ${active ? "text-foreground" : "text-muted-foreground"}`}>{step}</p>
                  </li>
                );
              })}
            </ul>

            <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground mt-6 text-center">
              {isDemo
                ? "Serving pre-cached payload · no LLM calls"
                : "5-Phase LLM Agent · Gemini Flash + Pro"}
            </p>
          </div>
        </div>
      )}

      {/* Dashboard grid */}
      <section className="max-w-[1400px] mx-auto px-6 py-6">
        {/* Error state */}
        {error && !isRunning && (
          <div className="panel p-10 text-center border-red-500/30">
            <div className="inline-flex w-14 h-14 rounded-full bg-red-500/10 border border-red-500/30 items-center justify-center mb-4">
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </div>
            <h3 className="font-display text-xl">Pipeline failed</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
              {error instanceof Error ? error.message : "Unknown error. Check the FastAPI server logs."}
            </p>
            <Button
              onClick={() => { setShouldFetch(false); }}
              variant="ghost"
              className="mt-4"
            >
              Dismiss
            </Button>
          </div>
        )}

        {/* Awaiting state — no data yet */}
        {!hasData && !error && !isRunning && (
          <div className="panel p-16 text-center">
            <div className="inline-flex w-14 h-14 rounded-full bg-secondary border border-border items-center justify-center mb-4">
              <Database className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="font-display text-xl">Awaiting analysis</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
              {matchId
                ? `Click Start Analysis to run the 5-phase pipeline for match #${matchId}${isDemo ? " (demo mode)" : ""}.`
                : "Add ?matchId=<number> to the URL, then click Start Analysis to generate the opponent dossier."}
            </p>
          </div>
        )}

        {/* Live data panels */}
        {hasData && !isRunning && (
          <div className="grid grid-cols-12 gap-4">
            {data!.panels.map((panel) => {
              const renderer = RENDERERS[panel.type];
              return renderer ? renderer(panel) : null;
            })}
          </div>
        )}
      </section>
    </main>
  );
};

export default Analysis;
