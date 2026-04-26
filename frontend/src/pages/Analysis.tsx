import { useState, useEffect, useRef } from "react";
import { toast } from "@/hooks/use-toast";
import { Link, useParams } from "react-router-dom";
import { TEAMS, PLAYMAKERS, ALERTS as MOCK_ALERTS, MADE_PASSES_BY_PLAYER, MADE_PASSES_TEAM } from "@/lib/mock-data";
import { fetchTeamSpatialMatrices, sumMatrices, normalizeMatrix, fetchPlayerLeadersByZone, fetchTeamGoalSequences, fetchPlayerPasses, fetchTeamPasses, fetchTopPlaymakers, type Playmaker, type LeaderZone, type GoalSequence, type MadePass } from "@/lib/spatial-service";
import { generateAIVerdict } from "@/lib/ai-service";
import { Pitch } from "@/components/Pitch";
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
  Layers,
  Flame,
  Network,
  AlertTriangle,
  Sparkles,
  CircleAlert,
  Brain,
  TrendingUp,
  Activity,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Check,
  Play,
  Loader2,
  Database,
  RotateCcw,
  User,
  ArrowRight
} from "lucide-react";

type Layer = "xt" | "passes" | "network" | "leaders";

const PIPELINE_STEPS = [
  "Scraping match data (FBref, Understat)...",
  "Calculating xT and Pitch Control...",
  "Running 5-Phase LLM Agent...",
];

const DEFAULT_TACTICAL_VERDICT = [
  {
    phase: "Phase 1 & 2",
    title: "Zone Analysis",
    body: "FC Universitatea Cluj heavily relies on central progression and the left half-space. Build-up through the defensive midfielder is effective, but the right flank remains significantly underutilized, making progression predictable against organized mid-blocks.",
  },
  {
    phase: "Phase 3",
    title: "Engine — xT Attribution",
    body: "Dan Nistor serves as the primary xT generator, orchestrating play with 0.45 xT / 90 via progressive passes breaking the second line. Removing his influence on the left side collapses 40% of their generated threat.",
  },
  {
    phase: "Phase 4",
    title: "Vulnerability Map",
    body: "Critical gap detected in the left defensive half-space during transitions. When the left-back advances, the LCM often fails to cover the space, leaving a 15m vertical channel exposed to rapid counter-attacks.",
  },
  {
    phase: "Phase 5",
    title: "Goal DNA & Suggestions",
    body: "Suggestion for U Cluj: Shift build-up variation to the right flank to reduce predictability and stretch opponents. Defensively, implement a strict rotational cover rule for the LCM when the left-back joins the attack, as 80% of transition goals conceded exploit that left corridor.",
  },
];

const Analysis = () => {
  const { teamId } = useParams();
  const team = TEAMS.find((t) => t.id === teamId) ?? TEAMS[0];
  const [layer, setLayer] = useState<Layer>("xt");
  const [matchWindow, setMatchWindow] = useState("5");
  const [isRunning, setIsRunning] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [hasData, setHasData] = useState(false);
  const [expandedRoster, setExpandedRoster] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [realXtMatrix, setRealXtMatrix] = useState<number[][] | null>(null);
  const [realLeaderZones, setRealLeaderZones] = useState<LeaderZone[] | null>(null);
  const [goalSequences, setGoalSequences] = useState<GoalSequence[]>([]);
  const [activeSeqIndex, setActiveSeqIndex] = useState(0);
  const [realPlayerPasses, setRealPlayerPasses] = useState<MadePass[]>([]);
  const [realTeamPasses, setRealTeamPasses] = useState<MadePass[]>([]);
  const [realPlaymakers, setRealPlaymakers] = useState<Playmaker[]>([]);
  const [activePassMatchIndex, setActivePassMatchIndex] = useState(0);
  const [loadingPasses, setLoadingPasses] = useState(false);
  const [aiVerdict, setAiVerdict] = useState<any[]>(DEFAULT_TACTICAL_VERDICT);
  const [aiAlerts, setAiAlerts] = useState<any[]>(MOCK_ALERTS);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const names = Array.from(files).map((f) => f.name).join(", ");
    toast({
      title: `Uploaded ${files.length} file${files.length > 1 ? "s" : ""}`,
      description: names.length > 80 ? names.slice(0, 80) + "…" : names,
    });
    e.target.value = "";
  };

  const allLayers: { id: Layer; label: string; icon: React.ReactNode; sub: string; teamOnly?: boolean; playerOnly?: boolean }[] = [
    { id: "xt", label: "xT Grid", icon: <Layers className="w-3.5 h-3.5" />, sub: "Threat zones vs U-Cluj" },
    { id: "leaders", label: "xT Leaders By Zone", icon: <Sparkles className="w-3.5 h-3.5" />, sub: "Top xT contributor per zone · 6×5 grid", teamOnly: true },
    { id: "network", label: "Goal Sequences", icon: <Network className="w-3.5 h-3.5" />, sub: "Recent goals build-up sequences", teamOnly: true },
    { id: "passes", label: "Passes", icon: <Network className="w-3.5 h-3.5" />, sub: "Pass arrows · green = success, red = failed", playerOnly: true },
  ];

  const playmakers = realPlaymakers;
  const topPlaymakers = playmakers.slice(0, 3);
  const selected = playmakers.find((p) => p.name === selectedPlayer) ?? null;
  const layers = allLayers.filter((l) => {
    if (l.teamOnly && selected) return false;
    if (l.playerOnly && !selected) return false;
    return true;
  });
  // Fallback layer if current selection becomes invalid
  const effectiveLayer: Layer =
    selected && (layer === "leaders" || layer === "network")
      ? "xt"
      : !selected && layer === "passes"
      ? "xt"
      : layer;
  const pitchFocus = selected && effectiveLayer === "xt" ? selected.focus : null;
  const uniquePassMatches = Array.from(new Set(realPlayerPasses.map(p => p.match_id))).filter(Boolean) as string[];
  const currentPassMatch = uniquePassMatches[activePassMatchIndex];

  const pitchPasses = effectiveLayer === "passes"
    ? (selected ? (realPlayerPasses.length > 0 ? realPlayerPasses.filter(p => p.match_id === currentPassMatch) : (MADE_PASSES_BY_PLAYER[selected.name] ?? [])) : (realTeamPasses.length > 0 ? realTeamPasses : MADE_PASSES_TEAM))
    : undefined;

  const playerXtMatrix = selected ? realPlaymakers.find(p => p.name === selected.name)?.xtMatrix : null;
  const normalizedPlayerXt = playerXtMatrix ? normalizeMatrix(playerXtMatrix).normalized : null;

  useEffect(() => {
    if (selectedPlayer && hasData && layer === "passes") {
      setLoadingPasses(true);
      const matchCount = parseInt(matchWindow, 10) || 5;
      fetchPlayerPasses(team.name, selectedPlayer, matchCount).then(passes => {
        setRealPlayerPasses(passes);
        setActivePassMatchIndex(0);
        setLoadingPasses(false);
      }).catch(err => {
        console.error("Error fetching passes:", err);
        setLoadingPasses(false);
      });
    } else {
      setRealPlayerPasses([]);
    }
  }, [selectedPlayer, hasData, layer, matchWindow, team.name]);

  const runScraper = async () => {
    setIsRunning(true);
    setHasData(false);
    setActiveStep(0);
    setRealXtMatrix(null);
    setRealLeaderZones(null);
    setGoalSequences([]);
    setActiveSeqIndex(0);
    setRealPlayerPasses([]);
    setRealTeamPasses([]);
    setRealPlaymakers([]);
    setActivePassMatchIndex(0);
    setIsGeneratingAI(false);

    try {
      const matchCount = parseInt(matchWindow, 10) || 5;
      const matrices = await fetchTeamSpatialMatrices(team.name, matchCount);

      if (matrices.length > 0) {
        const summed = sumMatrices(matrices);
        const { normalized } = normalizeMatrix(summed);
        setRealXtMatrix(normalized);
        console.log(`[Analysis] Loaded ${matrices.length} spatial matrices for ${team.name}, matchWindow=${matchCount}`);
      } else {
        setRealXtMatrix(null);
        console.warn(`[Analysis] No spatial data found for ${team.name} — falling back to mock data`);
        toast({
          title: "No spatial data found",
          description: `No xT matrices in the database for ${team.name}. Showing mock data.`,
        });
      }

      // Fetch player leaders by zone
      const leaders = await fetchPlayerLeadersByZone(team.name, matchCount);
      if (leaders.length > 0) {
        setRealLeaderZones(leaders);
        console.log(`[Analysis] Loaded ${leaders.length} leader zones for ${team.name}`);
      } else {
        setRealLeaderZones(null);
      }

      // Fetch goal sequences
      const seqs = await fetchTeamGoalSequences(team.name, matchCount);
      setGoalSequences(seqs);
      setActiveSeqIndex(0);

      // Fetch all team passes
      const tPasses = await fetchTeamPasses(team.name, matchCount);
      setRealTeamPasses(tPasses);

      // Fetch top playmakers
      const pms = await fetchTopPlaymakers(team.name, matchCount);
      setRealPlaymakers(pms);

      // Generate AI Insights
      try {
        setIsGeneratingAI(true);
        const aiResponse = await generateAIVerdict(team.name, pms, seqs);
        if (aiResponse && aiResponse.verdict && aiResponse.alerts) {
          setAiVerdict(aiResponse.verdict);
          setAiAlerts(aiResponse.alerts);
          toast({
            title: "AI Analysis Complete",
            description: `Successfully generated dynamic tactical insights for ${team.name}.`,
          });
        }
      } catch (aiErr: any) {
        console.error('[Analysis] Failed to generate AI verdict:', aiErr);
        toast({
          title: "AI Analysis Error",
          description: aiErr.message || "Failed to generate dynamic insights. Showing fallback data.",
          variant: "destructive"
        });
        setAiVerdict(DEFAULT_TACTICAL_VERDICT);
        setAiAlerts(MOCK_ALERTS);
      } finally {
        setIsGeneratingAI(false);
      }
    } catch (err) {
      console.error('[Analysis] Failed to fetch spatial data:', err);
      setRealXtMatrix(null);
      toast({
        title: "Database error",
        description: "Could not fetch spatial analysis data. Showing mock data.",
      });
    }
  };

  useEffect(() => {
    if (!isRunning) return;
    if (activeStep >= PIPELINE_STEPS.length) {
      const t = setTimeout(() => {
        setIsRunning(false);
        setHasData(true);
      }, 500);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setActiveStep((s) => s + 1), 1400);
    return () => clearTimeout(t);
  }, [isRunning, activeStep]);

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
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={runScraper}
              disabled={isRunning}
              className="bg-foreground text-background hover:bg-foreground/90 h-10"
            >
              {isRunning ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              Start Analysis
            </Button>
          </div>
        </div>
      </header>
      {/* hidden file input retained for potential future use */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".csv,.xlsx,.xls,.json,.pdf,.txt"
        onChange={handleFilesSelected}
        className="hidden"
      />

      {/* Pipeline Loading Overlay */}
      {isRunning && (
        <div className="fixed inset-0 z-50 bg-background/85 backdrop-blur-md flex items-center justify-center px-6 animate-fade-in">
          <div className="panel p-10 max-w-xl w-full">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 rounded-lg bg-foreground text-background flex items-center justify-center">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Tactical scraper</p>
                <h2 className="font-display text-xl font-semibold tracking-tight mt-0.5">
                  Running pipeline · {team.name}
                </h2>
              </div>
            </div>

            <ul className="space-y-3">
              {PIPELINE_STEPS.map((step, i) => {
                const done = i < activeStep;
                const active = i === activeStep;
                return (
                  <li
                    key={i}
                    className={`flex items-center gap-3 rounded-lg border p-4 transition ${
                      done
                        ? "border-border/60 bg-secondary/20"
                        : active
                        ? "border-foreground/40 bg-foreground/5"
                        : "border-border/40 bg-transparent opacity-50"
                    }`}
                  >
                    <div
                      className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center ${
                        done
                          ? "bg-foreground text-background"
                          : active
                          ? "bg-foreground/10 border border-foreground/30 text-foreground"
                          : "bg-secondary border border-border text-muted-foreground"
                      }`}
                    >
                      {done ? (
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
              5-Phase LLM Agent · Sources: FBref · Sofascore · Understat
            </p>
          </div>
        </div>
      )}



      {/* Dashboard grid */}
      <section className="max-w-[1400px] mx-auto px-6 py-6">
        {!hasData ? (
          <div className="panel p-10 max-w-2xl mx-auto mt-12 border-border/50 bg-background/50 backdrop-blur-sm shadow-xl">
            <div className="text-center">
              <div className="inline-flex w-14 h-14 rounded-full bg-secondary border border-border items-center justify-center mb-4">
                <Activity className="w-6 h-6 text-muted-foreground" />
              </div>
              <h3 className="font-display text-2xl font-semibold tracking-tight">Select Analysis Type</h3>
              <p className="text-sm text-muted-foreground mt-2">
                Choose the number of matches to run for {team.name}.
              </p>
              <p className="text-xs text-muted-foreground/60 mt-4">
                Use the <span className="text-muted-foreground">Match Window</span> selector and press <span className="text-muted-foreground">Start Analysis</span> above.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-4">
            {/* Panel A: Pitch */}
            <div className="panel p-5 col-span-12 xl:col-span-8">
              <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Panel A</p>
                  <h2 className="font-display text-lg font-semibold tracking-tight mt-1">
                    The Pitch · {layer === "leaders" ? "8x6 zones" : "16x12 zones"}
                  </h2>
                </div>
                <div className="flex flex-wrap gap-1.5 p-1 rounded-lg bg-secondary/40 border border-border/60">
                  {layers.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => setLayer(l.id)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition ${
                        layer === l.id
                          ? "bg-foreground text-background shadow"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {l.icon}
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
              {selected && (
                <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-foreground/30 bg-foreground/5 px-3 py-2 animate-fade-in">
                  <div className="flex items-center gap-2 text-xs">
                    <User className="w-3.5 h-3.5 text-foreground" />
                    <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Showing data for</span>
                    <span className="font-medium text-foreground">{selected.name}</span>
                    <span className="text-muted-foreground">· {selected.pos}</span>
                  </div>
                  <button
                    onClick={() => setSelectedPlayer(null)}
                    className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition"
                  >
                    Clear
                  </button>
                </div>
              )}
              <Pitch layer={effectiveLayer} focus={pitchFocus} passes={pitchPasses} xtMatrix={!selected ? realXtMatrix : normalizedPlayerXt} leaderZones={!selected ? realLeaderZones : null} goalSequence={effectiveLayer === "network" ? goalSequences[activeSeqIndex] : undefined} />
              
              {effectiveLayer === "network" && goalSequences.length > 0 && (
                <div className="mt-4 flex items-center justify-between bg-foreground/5 p-3 rounded-lg border border-border/60">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveSeqIndex(i => Math.max(0, i - 1))}
                    disabled={activeSeqIndex === 0}
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" /> Newer
                  </Button>
                  <div className="text-center">
                    <p className="text-sm font-medium">Goal by {goalSequences[activeSeqIndex].scorer}</p>
                    <p className="text-xs text-muted-foreground">Minute {goalSequences[activeSeqIndex].minute} (Match {goalSequences[activeSeqIndex].match_id})</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveSeqIndex(i => Math.min(goalSequences.length - 1, i + 1))}
                    disabled={activeSeqIndex === goalSequences.length - 1}
                  >
                    Older <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              )}
              {effectiveLayer === "network" && goalSequences.length === 0 && hasData && (
                <div className="mt-4 text-center p-4 border border-border/60 rounded-lg text-sm text-muted-foreground">
                  No goals found for {team.name} in the selected matches.
                </div>
              )}

              {effectiveLayer === "passes" && selected && uniquePassMatches.length > 0 && (
                <div className="mt-4 flex items-center justify-between bg-foreground/5 p-3 rounded-lg border border-border/60">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setActivePassMatchIndex(i => Math.max(0, i - 1))}
                    disabled={activePassMatchIndex <= 0}
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" /> Prev Match
                  </Button>
                  <div className="text-center">
                    <p className="text-sm font-medium">{selected.name} Passes</p>
                    <p className="text-xs text-muted-foreground">Match {activePassMatchIndex + 1} of {uniquePassMatches.length}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setActivePassMatchIndex(i => Math.min(uniquePassMatches.length - 1, i + 1))}
                    disabled={activePassMatchIndex >= uniquePassMatches.length - 1}
                  >
                    Next Match <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              )}

              <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
                <p>{allLayers.find((l) => l.id === effectiveLayer)?.sub}{selected ? ` · isolated to ${selected.name}` : ""}</p>
                {effectiveLayer === "xt" ? (
                  <div className="flex items-center gap-2">
                    <span>{realXtMatrix ? "0%" : "0.010"}</span>
                    <span className="w-32 h-1.5 rounded-full bg-gradient-to-r from-[hsl(0_0%_8%)] to-[hsl(0_0%_95%)] border border-border/60" />
                    <span>{realXtMatrix ? "100%" : "0.256"}</span>
                  </div>
                ) : effectiveLayer === "passes" ? (
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-sm" style={{ background: "#064512" }} />
                      Successful
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-sm" style={{ background: "#8C1E06" }} />
                      Unsuccessful
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-foreground" />
                    <span>Node = player · line weight = pass volume</span>
                  </div>
                )}
              </div>
            </div>

            {/* Panel B: Danger Creator */}
            <div className="panel p-5 col-span-12 md:col-span-6 xl:col-span-4">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Panel B</p>
                  <h2 className="font-display text-lg font-semibold tracking-tight mt-1">The Danger Creator</h2>
                  <p className="text-xs text-muted-foreground mt-1">Top xT contributors · last {matchWindow === "season" ? "season" : `${matchWindow} matches`}</p>
                </div>
                <div className="w-9 h-9 rounded-md bg-foreground text-background flex items-center justify-center">
                  <Flame className="w-4 h-4" />
                </div>
              </div>
              {selected && (
                <button
                  onClick={() => setSelectedPlayer(null)}
                  className="w-full mb-4 inline-flex items-center justify-center gap-2 h-10 rounded-md bg-foreground text-background hover:bg-foreground/90 transition text-xs uppercase tracking-[0.2em] font-medium animate-fade-in"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  View Full Team Analysis
                </button>
              )}

              <div className="space-y-3">
                {topPlaymakers.map((p, i) => {
                  const primary = i === 0;
                  const isSelected = selectedPlayer === p.name;
                  return (
                    <button
                      type="button"
                      key={p.name}
                      onClick={() => setSelectedPlayer(isSelected ? null : p.name)}
                      className={`relative w-full text-left rounded-lg border p-4 transition ${
                        isSelected
                          ? "border-foreground bg-foreground text-background"
                          : primary
                          ? "border-foreground/30 bg-foreground/5 hover:bg-foreground/10"
                          : "border-border/60 bg-secondary/20 hover:bg-secondary/40"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center font-display font-bold text-sm ${
                            isSelected
                              ? "bg-background text-foreground"
                              : primary
                              ? "bg-foreground text-background"
                              : "bg-secondary text-muted-foreground border border-border"
                          }`}>
                            {i + 1}
                          </div>
                          <div>
                            <p className={`font-medium ${isSelected ? "text-background" : primary ? "text-foreground" : "text-muted-foreground"}`}>{p.name}</p>
                            <p className={`text-[10px] uppercase tracking-wider mt-0.5 ${isSelected ? "text-background/70" : "text-muted-foreground/80"}`}>{p.pos} · {p.minutes}'</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-display text-2xl ${isSelected ? "text-background" : primary ? "text-foreground" : "text-muted-foreground"}`}>{p.xt.toFixed(2)}</p>
                          <p className={`text-[10px] uppercase tracking-wider ${isSelected ? "text-background/70" : "text-muted-foreground"}`}>xT</p>
                        </div>
                      </div>
                      <div className={`grid grid-cols-2 gap-2 mt-3 pt-3 border-t ${isSelected ? "border-background/20" : "border-border/50"}`}>
                        <div>
                          <p className={`text-[10px] uppercase tracking-wider ${isSelected ? "text-background/70" : "text-muted-foreground"}`}>Passes</p>
                          <p className="text-sm font-mono mt-0.5">{p.passes}</p>
                        </div>
                        <div>
                          <p className={`text-[10px] uppercase tracking-wider ${isSelected ? "text-background/70" : "text-muted-foreground"}`}>Assists</p>
                          <p className="text-sm font-mono mt-0.5">{p.assists}</p>
                        </div>
                      </div>
                      {primary && !isSelected && (
                        <div className="absolute -top-2 right-3 px-2 py-0.5 rounded-full bg-foreground text-background text-[10px] uppercase tracking-wider font-medium">
                          Primary target
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

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
                    {playmakers.map((p, i) => {
                      const isSelected = selectedPlayer === p.name;
                      return (
                        <li key={p.name}>
                          <button
                            type="button"
                            onClick={() => setSelectedPlayer(isSelected ? null : p.name)}
                            className={`w-full flex items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition border ${
                              isSelected
                                ? "bg-foreground text-background border-foreground"
                                : "border-transparent hover:bg-zinc-800/60 hover:border-border/50"
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span className={`font-mono text-[11px] w-5 text-right ${isSelected ? "text-background/70" : "text-muted-foreground"}`}>
                                {String(i + 1).padStart(2, "0")}
                              </span>
                              <span className="text-sm font-medium truncate">{p.name}</span>
                              <span className={`text-[10px] uppercase tracking-wider shrink-0 ${isSelected ? "text-background/70" : "text-muted-foreground"}`}>
                                {p.pos}
                              </span>
                            </div>
                            <span className={`font-display text-sm shrink-0 ${isSelected ? "text-background" : "text-foreground"}`}>
                              {p.xt.toFixed(2)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>

            {/* Panel C: Defensive Vulnerability */}
            <div className="panel p-5 col-span-12 xl:col-span-7">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Panel C</p>
                  <h2 className="font-display text-lg font-semibold tracking-tight mt-1">Defensive Vulnerability Alerts</h2>
                  <p className="text-xs text-muted-foreground mt-1">Pitch control · LLM tactical verdicts</p>
                </div>
                <div className="w-9 h-9 rounded-md bg-secondary/60 border border-border/60 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
              {isGeneratingAI ? (
                <div className="flex flex-col items-center justify-center py-12 text-center animate-fade-in">
                  <div className="relative mb-4">
                    <div className="absolute inset-0 blur-xl bg-foreground/10 rounded-full" />
                    <Loader2 className="w-8 h-8 text-foreground animate-spin relative" strokeWidth={1.5} />
                  </div>
                  <p className="text-sm font-medium">Synthesizing Vulnerabilities...</p>
                  <p className="text-xs text-muted-foreground mt-1">Analyzing expected threat & patterns with Gemini</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {aiAlerts.map((a, i) => {
                    const isCritical = a.severity === "critical";
                    return (
                      <li
                        key={i}
                        className={`rounded-lg border p-4 transition ${
                          isCritical
                            ? "border-foreground/40 bg-foreground/[0.04]"
                            : "border-border/60 bg-secondary/20"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] uppercase tracking-wider font-semibold ${
                            isCritical
                              ? "bg-foreground text-background"
                              : a.severity === "warning"
                              ? "bg-secondary text-foreground border border-border"
                              : "bg-transparent text-muted-foreground border border-border/60"
                          }`}>
                            {isCritical ? <CircleAlert className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                            {a.severity}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-baseline justify-between gap-3 flex-wrap">
                              <p className="font-medium">{a.title}</p>
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">{a.zone}</p>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{a.verdict}</p>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Panel D: 5-Phase Tactical Verdict */}
            <div className="panel p-5 col-span-12 xl:col-span-5">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Panel D</p>
                  <h2 className="font-display text-lg font-semibold tracking-tight mt-1">5-Phase Tactical Verdict</h2>
                  <p className="text-xs text-muted-foreground mt-1">LLM agent synthesis · scraped event data</p>
                </div>
                <div className="w-9 h-9 rounded-md bg-secondary/60 border border-border/60 flex items-center justify-center">
                  <Brain className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
              {isGeneratingAI ? (
                <div className="flex flex-col items-center justify-center py-12 text-center animate-fade-in">
                  <div className="relative mb-4">
                    <div className="absolute inset-0 blur-xl bg-foreground/10 rounded-full" />
                    <Brain className="w-8 h-8 text-foreground animate-pulse relative" strokeWidth={1.5} />
                  </div>
                  <p className="text-sm font-medium">Generating LLM Tactical Verdict...</p>
                  <p className="text-xs text-muted-foreground mt-1">Processing 5-Phase pipeline data</p>
                </div>
              ) : (
                <ol className="space-y-4">
                  {aiVerdict.map((ins, i) => (
                    <li key={i} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <span className="w-7 h-7 rounded-full border border-border bg-secondary/40 flex items-center justify-center text-xs font-mono text-muted-foreground">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        {i < aiVerdict.length - 1 && <span className="w-px flex-1 bg-border mt-1" />}
                      </div>
                      <div className="flex-1 pb-1">
                        <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{ins.phase}</p>
                        <p className="font-semibold text-sm mt-0.5">{ins.title}</p>
                        <p className="text-sm text-muted-foreground mt-1 leading-relaxed font-light">{ins.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              <div className="mt-5 pt-4 border-t border-border/60 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>U-xT Agent v2.4 · 5-Phase Pipeline</span>
                <span className="font-mono">{new Date().toISOString().slice(0, 10)}</span>
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
};

export default Analysis;
