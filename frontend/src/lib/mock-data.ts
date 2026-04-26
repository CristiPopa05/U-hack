export type Team = {
  id: string;
  name: string;
  short: string;
  city: string;
  founded: number;
};

export const TEAMS: Team[] = [
  { id: "u-cluj", name: "FC Universitatea Cluj", short: "U CLJ", city: "Cluj-Napoca", founded: 1919 },
  { id: "craiova", name: "Universitatea Craiova", short: "UCV", city: "Craiova", founded: 1948 },
  { id: "cfr", name: "CFR 1907 Cluj", short: "CFR", city: "Cluj-Napoca", founded: 1907 },
  { id: "rapid", name: "Rapid București", short: "RAP", city: "București", founded: 1923 },
  { id: "dinamo", name: "Dinamo București", short: "DIN", city: "București", founded: 1948 },
  { id: "arges", name: "FC Argeș", short: "ARG", city: "Pitești", founded: 1953 },
];

export type StandingRow = {
  pos: number; team: string; p: number; w: number; d: number; l: number; g: string; gd: number; pts: number; form: string[];
};

export const STANDINGS: StandingRow[] = [
  { pos: 1, team: "'U' Cluj", p: 7, w: 5, d: 0, l: 2, g: "12:5", gd: 7, pts: 42, form: ["V", "V", "V", "Î", "Î", "V"] },
  { pos: 2, team: "Univ. Craiova", p: 5, w: 3, d: 0, l: 2, g: "4:5", gd: -1, pts: 39, form: ["?", "V", "Î", "V", "V", "Î"] },
  { pos: 3, team: "CFR Cluj", p: 7, w: 3, d: 1, l: 3, g: "5:7", gd: -2, pts: 37, form: ["Î", "V", "E", "Î", "V", "V"] },
  { pos: 4, team: "Rapid București", p: 5, w: 1, d: 1, l: 3, g: "4:6", gd: -2, pts: 32, form: ["?", "Î", "E", "Î", "Î", "V"] },
  { pos: 5, team: "Dinamo București", p: 5, w: 1, d: 2, l: 2, g: "6:7", gd: -1, pts: 31, form: ["?", "V", "E", "E", "Î", "Î"] },
  { pos: 6, team: "FC Argeș", p: 5, w: 1, d: 2, l: 2, g: "2:3", gd: -1, pts: 30, form: ["?", "Î", "E", "E", "Î", "V"] },
];

// xT grid 16x12 (cols x rows). Values 0..1, higher = more threat for U-Cluj defense
export function generateXTGrid(seed = 1): number[][] {
  const rows = 12, cols = 16;
  const g: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) {
      // Threat grows toward right side (attacking goal)
      const dx = c / (cols - 1);
      const dy = Math.abs(r - (rows - 1) / 2) / ((rows - 1) / 2);
      const base = Math.pow(dx, 2.2) * (1 - dy * 0.6);
      const noise = (Math.sin((c + 1) * (r + 1) * 0.7 * seed) + 1) / 2 * 0.08;
      row.push(Math.max(0.005, Math.min(0.28, base * 0.28 + noise)));
    }
    g.push(row);
  }
  return g;
}

export function generateHeatmap(seed = 2): number[][] {
  const rows = 12, cols = 16;
  const g: number[][] = [];
  const hotspots = [
    { x: 11, y: 5, r: 3.5, w: 1 },
    { x: 13, y: 8, r: 2.8, w: 0.85 },
    { x: 8, y: 6, r: 3, w: 0.75 },
    { x: 4, y: 4, r: 2.5, w: 0.5 },
  ];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) {
      let v = 0;
      for (const h of hotspots) {
        const d = Math.hypot(c - h.x, r - h.y);
        v += Math.exp(-(d * d) / (2 * h.r * h.r)) * h.w;
      }
      v += (Math.sin(c * 1.3 + r * 0.9 + seed) + 1) * 0.04;
      row.push(Math.max(0.02, Math.min(1, v)));
    }
    g.push(row);
  }
  return g;
}

// Pass network nodes (positions on pitch in 0..1 coords)
export type PassNode = { id: string; x: number; y: number; name: string; num: number };
export type PassLink = { from: string; to: string; weight: number };

export const PASS_NODES: PassNode[] = [
  { id: "gk", x: 0.05, y: 0.5, name: "Târnovanu", num: 1 },
  { id: "rb", x: 0.18, y: 0.85, name: "Crețu", num: 2 },
  { id: "cb1", x: 0.18, y: 0.62, name: "Dawa", num: 4 },
  { id: "cb2", x: 0.18, y: 0.38, name: "Ngezana", num: 5 },
  { id: "lb", x: 0.18, y: 0.15, name: "Radunović", num: 3 },
  { id: "dm", x: 0.38, y: 0.5, name: "Șut", num: 6 },
  { id: "rm", x: 0.55, y: 0.78, name: "Tavares", num: 7 },
  { id: "cm", x: 0.5, y: 0.5, name: "Olaru", num: 8 },
  { id: "lm", x: 0.55, y: 0.22, name: "Lixandru", num: 11 },
  { id: "cf1", x: 0.78, y: 0.4, name: "Bîrligea", num: 9 },
  { id: "cf2", x: 0.78, y: 0.6, name: "Coman", num: 10 },
];

export const PASS_LINKS: PassLink[] = [
  { from: "gk", to: "cb1", weight: 0.7 },
  { from: "gk", to: "cb2", weight: 0.6 },
  { from: "cb1", to: "dm", weight: 0.9 },
  { from: "cb2", to: "dm", weight: 0.85 },
  { from: "cb1", to: "rb", weight: 0.5 },
  { from: "cb2", to: "lb", weight: 0.55 },
  { from: "dm", to: "cm", weight: 1 },
  { from: "dm", to: "olaru", weight: 0.4 },
  { from: "cm", to: "rm", weight: 0.75 },
  { from: "cm", to: "lm", weight: 0.65 },
  { from: "rm", to: "cf1", weight: 0.85 },
  { from: "lm", to: "cf2", weight: 0.7 },
  { from: "cm", to: "cf1", weight: 0.95 },
  { from: "cm", to: "cf2", weight: 0.8 },
  { from: "cf1", to: "cf2", weight: 0.6 },
  { from: "rb", to: "rm", weight: 0.6 },
  { from: "lb", to: "lm", weight: 0.55 },
];

// Made passes (start -> end coordinates in 0..1, success flag, player owner)
export type MadePass = {
  player: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  success: boolean;
};

// Deterministic pseudo-random helper
function rand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function generatePassesFor(player: string, focus: { x: number; y: number; spread: number }, count: number, successRate: number, seed: number): MadePass[] {
  const r = rand(seed);
  const passes: MadePass[] = [];
  for (let i = 0; i < count; i++) {
    const fx = Math.max(0.04, Math.min(0.96, focus.x + (r() - 0.5) * focus.spread * 0.08));
    const fy = Math.max(0.06, Math.min(0.94, focus.y + (r() - 0.5) * focus.spread * 0.12));
    // Bias end toward attacking direction (right) with some lateral variance
    const dx = (r() * 0.28) + 0.04;
    const dy = (r() - 0.5) * 0.35;
    const tx = Math.max(0.04, Math.min(0.98, fx + dx));
    const ty = Math.max(0.06, Math.min(0.94, fy + dy));
    passes.push({
      player,
      from: { x: fx, y: fy },
      to: { x: tx, y: ty },
      success: r() < successRate,
    });
  }
  return passes;
}

export type Playmaker = {
  name: string;
  pos: string;
  xt: number;
  passes: number;
  assists: number;
  minutes: number;
  // normalized pitch coordinates (0..1) where the player's activity concentrates
  focus: { x: number; y: number; spread: number };
};
export const PLAYMAKERS: Record<string, Playmaker[]> = {
  default: [
    { name: "Darius Olaru", pos: "AM", xt: 8.42, passes: 612, assists: 9, minutes: 2480, focus: { x: 0.62, y: 0.5, spread: 2.4 } },
    { name: "Florinel Coman", pos: "LW", xt: 6.91, passes: 488, assists: 7, minutes: 2310, focus: { x: 0.7, y: 0.18, spread: 2.2 } },
    { name: "Octavian Popescu", pos: "RW", xt: 5.18, passes: 401, assists: 5, minutes: 1980, focus: { x: 0.7, y: 0.82, spread: 2.2 } },
    { name: "Daniel Bîrligea", pos: "ST", xt: 4.62, passes: 198, assists: 3, minutes: 1840, focus: { x: 0.84, y: 0.45, spread: 1.9 } },
    { name: "Adrian Șut", pos: "DM", xt: 3.95, passes: 720, assists: 2, minutes: 2390, focus: { x: 0.42, y: 0.5, spread: 2.6 } },
    { name: "Valentin Crețu", pos: "RB", xt: 3.41, passes: 540, assists: 4, minutes: 2210, focus: { x: 0.45, y: 0.85, spread: 2.5 } },
    { name: "Risto Radunović", pos: "LB", xt: 3.18, passes: 512, assists: 3, minutes: 2150, focus: { x: 0.45, y: 0.15, spread: 2.5 } },
    { name: "Marius Tavares", pos: "RM", xt: 2.84, passes: 360, assists: 2, minutes: 1620, focus: { x: 0.6, y: 0.78, spread: 2.0 } },
    { name: "Vlad Lixandru", pos: "LM", xt: 2.51, passes: 318, assists: 1, minutes: 1480, focus: { x: 0.6, y: 0.22, spread: 2.0 } },
    { name: "Siyabonga Ngezana", pos: "CB", xt: 1.92, passes: 610, assists: 0, minutes: 2400, focus: { x: 0.22, y: 0.38, spread: 2.4 } },
    { name: "Mihai Popescu", pos: "CB", xt: 1.74, passes: 588, assists: 0, minutes: 2280, focus: { x: 0.22, y: 0.62, spread: 2.4 } },
    { name: "Ștefan Târnovanu", pos: "GK", xt: 0.42, passes: 240, assists: 0, minutes: 2520, focus: { x: 0.08, y: 0.5, spread: 1.6 } },
  ],
};

// Generate made passes per player + aggregate team set
export const MADE_PASSES_BY_PLAYER: Record<string, MadePass[]> = PLAYMAKERS.default.reduce(
  (acc, p, i) => {
    // Defenders/GK higher success, forwards lower
    const sr = p.pos === "GK" || p.pos === "CB" || p.pos === "DM" ? 0.92 : p.pos === "ST" || p.pos === "LW" || p.pos === "RW" ? 0.68 : 0.8;
    const count = Math.max(8, Math.min(22, Math.round(p.passes / 30)));
    acc[p.name] = generatePassesFor(p.name, p.focus, count, sr, (i + 1) * 173);
    return acc;
  },
  {} as Record<string, MadePass[]>,
);

export const MADE_PASSES_TEAM: MadePass[] = Object.values(MADE_PASSES_BY_PLAYER).flat();

export type Alert = {
  severity: "critical" | "warning" | "info";
  zone: string;
  title: string;
  verdict: string;
};
export const ALERTS: Alert[] = [
  { severity: "critical", zone: "Left Channel", title: "Left-Flank Transition Exposure",
    verdict: "AI Verdict: The left-back's high starting position leaves a 15m vertical channel exposed during turnovers. LCM fails to provide cover in 65% of transitions against fast-paced attacks." },
  { severity: "warning", zone: "Central", title: "Predictable Central Progression",
    verdict: "AI Verdict: Over-reliance on central progression (45% of passes) allows opponents to pack the midfield. Right flank remains heavily underutilized for stretching play." },
  { severity: "warning", zone: "Box, Edge", title: "Set-piece Defensive Marking",
    verdict: "AI Verdict: Zonal marking line occasionally drops too deep on outswinging corners, leaving the edge of the box (Zone 14) vulnerable to second balls and long shots." },
  { severity: "info", zone: "Build-up, Own Third", title: "Pressing Trigger Window",
    verdict: "AI Verdict: A 2.4s window appears after the first pass to the center-back — a coordinated 3-man press recovers possession 41% of the time. Strong pressing is highly recommended here." },
];

export const AI_INSIGHTS: { title: string; body: string }[] = [
  { title: "Buildup Pattern", body: "Opponent favors a 3-2 build via the right center-back, releasing the right-back high in 71% of sequences." },
  { title: "Final Third Entry", body: "Primary entry vector is the right half-space (zone H10) with diagonal passes from the #8 to the #10." },
  { title: "Set Pieces", body: "Inswinging corners from the right target the near post; expect a blocker on the keeper in 4 of 5 deliveries." },
  { title: "Pressing Behavior", body: "Mid-block 4-4-2 shape; press is triggered when the ball reaches the opposing #6 below 35m line." },
  { title: "Transition Risk", body: "Average 4.2s to convert recovery into shot — fastest in the league. Counter-press immediately on loss in their half." },
  { title: "Recommended Counter", body: "Overload the left flank with inverted full-back; bait the #7 to press, then switch to the right winger in space." },
];
