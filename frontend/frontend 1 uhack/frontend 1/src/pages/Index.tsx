import { useNavigate } from "react-router-dom";
import { useState, KeyboardEvent, useMemo, useRef, useEffect } from "react";
import { TEAMS, STANDINGS } from "@/lib/mock-data";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Loader2, Sparkles, Activity, Search, Clock, Upload } from "lucide-react";
import { TeamCrest } from "@/components/TeamCrest";
import uClujCrest from "@/assets/u-cluj-crest.png";

type HistoryEntry = { id: string; name: string; when: string; ts: number };

const INITIAL_HISTORY: HistoryEntry[] = [
  { id: "craiova", name: "U Craiova", when: "Analyzed 2 hours ago", ts: Date.now() - 1000 * 60 * 60 * 2 },
  { id: "cfr", name: "CFR Cluj", when: "Analyzed yesterday", ts: Date.now() - 1000 * 60 * 60 * 24 },
  { id: "rapid", name: "Rapid București", when: "Analyzed 2 days ago", ts: Date.now() - 1000 * 60 * 60 * 48 },
  { id: "dinamo", name: "Dinamo București", when: "Searched 3 days ago", ts: Date.now() - 1000 * 60 * 60 * 72 },
  { id: "arges", name: "FC Argeș", when: "Analyzed last week", ts: Date.now() - 1000 * 60 * 60 * 24 * 7 },
];

const Index = () => {
  const navigate = useNavigate();
  const [loadingTeam, setLoadingTeam] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>(INITIAL_HISTORY);
  const wrapRef = useRef<HTMLDivElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const handleUploadClick = () => uploadInputRef.current?.click();
  const handleUploadFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    toast({
      title: `Uploaded ${files.length} file${files.length > 1 ? "s" : ""}`,
      description: Array.from(files).map((f) => f.name).join(", ").slice(0, 100),
    });
    e.target.value = "";
  };

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return TEAMS.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.short.toLowerCase().includes(q) ||
        t.city.toLowerCase().includes(q),
    ).slice(0, 6);
  }, [query]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const pushHistory = (id: string, name: string) => {
    setHistory((prev) => [
      { id, name, when: "Analyzed just now", ts: Date.now() },
      ...prev.filter((h) => h.id !== id),
    ]);
  };

  const handleSelect = (id: string) => {
    const team = TEAMS.find((t) => t.id === id);
    if (team) pushHistory(team.id, team.name);
    setLoadingTeam(id);
    setTimeout(() => navigate(`/analysis/${id}`), 2000);
  };

  const handleSearch = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key !== "Enter") return;
    if (open && suggestions[activeIdx]) {
      handleSelect(suggestions[activeIdx].id);
      return;
    }
    const q = query.trim().toLowerCase();
    if (!q) return;
    const match =
      TEAMS.find((t) => t.name.toLowerCase() === q || t.short.toLowerCase() === q || t.id === q) ||
      TEAMS.find((t) => t.name.toLowerCase().includes(q) || t.short.toLowerCase().includes(q));
    if (match) handleSelect(match.id);
  };

  if (loadingTeam) {
    const team = TEAMS.find((t) => t.id === loadingTeam);
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-background relative overflow-hidden">
        <div className="absolute inset-0 grain pointer-events-none" />
        <div className="flex flex-col items-center gap-8 animate-fade-in">
          <div className="relative">
            <div className="absolute inset-0 blur-3xl bg-foreground/10 rounded-full" />
            <Loader2 className="w-14 h-14 text-foreground animate-spin relative" strokeWidth={1.2} />
          </div>
          <div className="text-center space-y-2">
            <p className="text-xs uppercase tracking-[0.4em] text-muted-foreground">AI Processing</p>
            <h2 className="text-3xl font-display font-semibold text-gradient-mono">
              Profiling {team?.name}
            </h2>
            <p className="text-sm text-muted-foreground max-w-md">
              Ingesting 4,218 events · Computing xT grids · Synthesizing tactical patterns
            </p>
          </div>
          <div className="flex gap-1.5 mt-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-foreground/60 animate-pulse-soft"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen relative">
      {/* Top right action */}
      <div className="absolute top-6 right-6 z-20">
        <input
          ref={uploadInputRef}
          type="file"
          multiple
          accept=".csv,.xlsx,.xls,.json,.pdf,.txt"
          onChange={handleUploadFiles}
          className="hidden"
        />
        <Button
          onClick={handleUploadClick}
          className="h-10 bg-foreground text-background hover:bg-foreground/90 border border-border/40 shadow-sm"
        >
          <Upload className="w-4 h-4 mr-2" />
          Upload New Statistics
        </Button>
      </div>

      {/* Hero */}
      <section className="relative max-w-7xl mx-auto px-6 pt-20 pb-24">
        <div className="grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7 space-y-8 animate-fade-in">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/80 bg-secondary/40 text-xs text-muted-foreground">
              <Sparkles className="w-3 h-3" />
              <span>v2.4 · Superliga Round 30 · 12 dossiers ready</span>
            </div>
            <h1 className="font-display font-bold tracking-tighter leading-[0.85] text-7xl md:text-8xl lg:text-[10rem] text-gradient-mono">
              U-xT
            </h1>
            <p className="text-xl md:text-2xl text-foreground/90 max-w-2xl font-light leading-tight">
              Superliga Opponent <span className="text-muted-foreground">AI Profiling</span> for the staff of <span className="font-medium">FC Universitatea Cluj</span>.
            </p>
            <p className="text-sm text-muted-foreground max-w-xl leading-relaxed">
              Pitch control, expected threat, pass networks and large-language tactical verdicts — distilled from every Superliga match into a single dossier per opponent.
            </p>
            <div className="pt-2 max-w-xl">
              <label htmlFor="team-search" className="sr-only">Search team</label>
              <div ref={wrapRef} className="relative group">
                <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-foreground transition z-10" />
                <Input
                  id="team-search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setOpen(true);
                    setActiveIdx(0);
                  }}
                  onFocus={() => setOpen(true)}
                  onKeyDown={handleSearch}
                  autoComplete="off"
                  role="combobox"
                  aria-expanded={open && suggestions.length > 0}
                  aria-controls="team-suggestions"
                  placeholder="Type team name to analyze (e.g., CFR Cluj)..."
                  className="h-14 pl-11 pr-28 bg-secondary/30 border-border/80 text-base rounded-xl focus-visible:ring-1 focus-visible:ring-foreground/40 focus-visible:border-foreground/40 placeholder:text-muted-foreground/70"
                />
                <kbd className="hidden sm:inline-flex absolute right-4 top-1/2 -translate-y-1/2 items-center gap-1 px-2 py-1 rounded-md border border-border/80 bg-background/60 text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                  Enter ↵
                </kbd>
                {open && suggestions.length > 0 && (
                  <div
                    id="team-suggestions"
                    role="listbox"
                    className="absolute z-20 left-0 right-0 mt-2 rounded-xl border border-border/80 bg-background/95 backdrop-blur-md shadow-2xl shadow-black/40 overflow-hidden animate-fade-in"
                  >
                    <p className="px-4 pt-3 pb-2 text-[10px] uppercase tracking-[0.3em] text-muted-foreground border-b border-border/40">
                      {suggestions.length} match{suggestions.length === 1 ? "" : "es"}
                    </p>
                    <ul className="max-h-72 overflow-y-auto py-1">
                      {suggestions.map((t, i) => (
                        <li key={t.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={i === activeIdx}
                            onMouseEnter={() => setActiveIdx(i)}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handleSelect(t.id);
                            }}
                            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                              i === activeIdx ? "bg-secondary/70" : "hover:bg-secondary/50"
                            }`}
                          >
                            <span className="w-8 h-8 rounded-md bg-secondary/80 border border-border/60 flex items-center justify-center overflow-hidden">
                              <TeamCrest short={t.short} teamId={t.id} teamName={t.name} size={26} />
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block text-sm font-medium text-foreground truncate">{t.name}</span>
                              <span className="block text-[11px] text-muted-foreground">{t.city} · Est. {t.founded}</span>
                            </span>
                            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground/80 mt-3 pl-1">Press Enter or pick a suggestion to launch the AI dossier.</p>
            </div>
          </div>
          <div className="lg:col-span-5 flex items-center justify-center animate-fade-in">
            <div className="relative aspect-square flex items-center justify-center -my-20 lg:-ml-40 lg:mr-16 lg:scale-150">
              <div className="absolute inset-0 bg-gradient-to-br from-foreground/15 via-transparent to-foreground/[0.04] blur-3xl" aria-hidden />
              <img
                src={uClujCrest}
                alt="FC Universitatea Cluj crest"
                className="relative w-full h-full object-contain opacity-95 drop-shadow-[0_0_80px_rgba(255,255,255,0.18)]"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Recent Analysis History */}
      <section id="teams" className="max-w-7xl mx-auto px-6 pb-24">
        <div className="flex items-end justify-between mb-8">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">01 / Activity</p>
            <h2 className="font-display text-3xl md:text-4xl font-semibold tracking-tight">Recent Analysis History</h2>
          </div>
          <p className="text-sm text-muted-foreground hidden md:block">Resume any previous tactical dossier.</p>
        </div>
        <div className="panel divide-y divide-border/40 overflow-hidden">
          {history.map((h) => (
            <button
              key={`${h.id}-${h.ts}`}
              onClick={() => handleSelect(h.id)}
              className="group w-full flex items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-secondary/40"
            >
              <div className="w-9 h-9 rounded-md bg-secondary/60 border border-border/60 flex items-center justify-center overflow-hidden">
                <TeamCrest short={h.id.toUpperCase()} teamId={h.id} teamName={h.name} size={28} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm leading-tight truncate">{h.name}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{h.when}</p>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground/80 group-hover:text-foreground transition">
                Open dossier <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Standings */}
      <section id="standings" className="max-w-7xl mx-auto px-6 pb-32">
        <div className="flex items-end justify-between mb-8">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">02 / Context</p>
            <h2 className="font-display text-3xl md:text-4xl font-semibold tracking-tight">Superliga play-off standings</h2>
          </div>
          <p className="text-xs text-muted-foreground">Updated · Play-off MD 5</p>
        </div>
        <div className="panel overflow-hidden">
          <div className="grid grid-cols-12 px-5 py-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground border-b border-border/60 bg-secondary/30">
            <div className="col-span-1">#</div>
            <div className="col-span-5">Club</div>
            <div className="col-span-1 text-center">P</div>
            <div className="col-span-1 text-center">W</div>
            <div className="col-span-1 text-center">D</div>
            <div className="col-span-1 text-center">L</div>
            <div className="col-span-1 text-center">GD</div>
            <div className="col-span-1 text-right">Pts</div>
          </div>
          {STANDINGS.map((row, i) => (
            <div
              key={row.team}
              className={`grid grid-cols-12 px-5 py-3 text-sm items-center border-b border-border/40 last:border-0 ${
                i % 2 === 0 ? "bg-transparent" : "bg-secondary/20"
              } ${row.team === "U Cluj" ? "bg-foreground/5" : ""}`}
            >
              <div className="col-span-1 text-muted-foreground font-mono text-xs">{String(row.pos).padStart(2, "0")}</div>
              <div className="col-span-5 flex items-center gap-3">
                <span className={`w-1 h-6 rounded-full ${row.pos <= 3 ? "bg-foreground" : row.pos <= 6 ? "bg-muted-foreground" : "bg-border"}`} />
                <TeamCrest short={row.team} teamName={row.team} size={24} />
                <span className={row.team === "U Cluj" ? "font-semibold" : ""}>{row.team}</span>
              </div>
              <div className="col-span-1 text-center text-muted-foreground">{row.p}</div>
              <div className="col-span-1 text-center">{row.w}</div>
              <div className="col-span-1 text-center text-muted-foreground">{row.d}</div>
              <div className="col-span-1 text-center text-muted-foreground">{row.l}</div>
              <div className={`col-span-1 text-center font-mono text-xs ${row.gd >= 0 ? "text-foreground" : "text-muted-foreground"}`}>
                {row.gd > 0 ? `+${row.gd}` : row.gd}
              </div>
              <div className="col-span-1 text-right font-display font-semibold">{row.pts}</div>
            </div>
          ))}
        </div>
      </section>

      <footer id="about" className="border-t border-border/60 py-8">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between text-xs text-muted-foreground">
          <p>U-xT · Tactical AI for FC U Cluj · Built with expected threat models</p>
          <p className="font-mono">© 2025</p>
        </div>
      </footer>
    </main>
  );
};

export default Index;
