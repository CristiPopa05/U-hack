/**
 * TypeScript types mirroring the Python `DashboardPayload` and per-panel
 * Pydantic schemas.  Manual port — hackathon scope; codegen optional later.
 *
 * Phase 5 of `ui_schema_design.md`.
 */

// ─── Shared / upstream types ────────────────────────────────────────────────

export type Severity = "critical" | "high" | "medium" | "info";

export type PatternSignature =
  | "wide_overload_to_central_finish"
  | "central_progression_through_halfspace"
  | "fast_transition_counter"
  | "set_piece_secondary"
  | "deep_buildup_long_switch"
  | "individual_dribble_initiated"
  | "mixed_inconclusive";

export type PlayerRole =
  | "originator"
  | "progressor"
  | "finisher"
  | "decoy"
  | "switcher";

export type PhaseSource = "xt_engine" | "zones" | "goal_dna" | "verdict";

// ─── Pass network (Goal DNA) ────────────────────────────────────────────────

export interface PassEdge {
  from_player_id: number;
  from_player_name: string;
  to_player_id: number;
  to_player_name: string;
  from_zone_id: number;
  to_zone_id: number;
  timestamp_offset: number;
  weight: number;
}

export interface PassNetworkGraph {
  match_id: number;
  goal_scorer_id: number | null;
  goal_timestamp: number | null;
  duration_seconds: number;
  edges: PassEdge[];
  is_synthesised: boolean;
}

export interface KeyPlayer {
  player_id: number;
  player_name: string;
  role: PlayerRole;
}

export interface BuildupPattern {
  opponent_id: number;
  pattern_signature: PatternSignature;
  confidence: number; // 0..1
  description: string;
  key_players: KeyPlayer[];
  starting_zones: number[];
  finishing_zones: number[];
  is_based_on_synthesised_input: boolean;
  notes: string[];
}

// ─── Defensive instruction (Verdict) ────────────────────────────────────────

export interface DefensiveInstruction {
  severity: Severity;
  title: string;
  body: string;
  target_player_id: number | null;
  target_zone_ids: number[];
}

// ─── Per-panel payloads ─────────────────────────────────────────────────────

export interface XTRange {
  min: number;
  max: number;
}

export interface XTGridPanel {
  type: "xt_grid";
  title: string;
  grid: number[][]; // 12 rows × 16 cols
  range: XTRange;
  max_xt_zone_id: number;
}

export interface DangerCreatorEntry {
  player_id: number;
  name: string;
  position: string | null;
  minutes: number;
  total_xt_value: number;
  max_xt_zone_id: number;
  passes: number;
  assists: number;
  is_primary: boolean;
}

export interface DangerCreatorPanel {
  type: "danger_creator";
  title: string;
  players: DangerCreatorEntry[];
  narrative: string;
}

export interface VulnerabilityAlertsPanel {
  type: "vulnerability_alerts";
  title: string;
  alerts: DefensiveInstruction[];
}

export interface GoalDNAPanel {
  type: "goal_dna_network";
  title: string;
  graph: PassNetworkGraph;
  pattern: BuildupPattern;
}

export interface PhaseSummary {
  phase_label: string;
  title: string;
  body: string;
  source: PhaseSource;
}

export interface TacticalVerdictPanel {
  type: "tactical_verdict";
  title: string;
  headline: string;
  summary: string;
  confidence: number; // 0..1
  phases: PhaseSummary[];
}

// ─── Discriminated union ────────────────────────────────────────────────────

export type Panel =
  | XTGridPanel
  | DangerCreatorPanel
  | VulnerabilityAlertsPanel
  | GoalDNAPanel
  | TacticalVerdictPanel;

// ─── Root payload ───────────────────────────────────────────────────────────

export interface DashboardPayload {
  match_id: number;
  generated_at: string; // ISO 8601
  schema_version: "1";
  opponent_id: number;
  panels: Panel[];
}

// ─── Type guards ────────────────────────────────────────────────────────────

export function isXTGridPanel(p: Panel): p is XTGridPanel {
  return p.type === "xt_grid";
}
export function isDangerCreatorPanel(p: Panel): p is DangerCreatorPanel {
  return p.type === "danger_creator";
}
export function isVulnerabilityAlertsPanel(p: Panel): p is VulnerabilityAlertsPanel {
  return p.type === "vulnerability_alerts";
}
export function isGoalDNAPanel(p: Panel): p is GoalDNAPanel {
  return p.type === "goal_dna_network";
}
export function isTacticalVerdictPanel(p: Panel): p is TacticalVerdictPanel {
  return p.type === "tactical_verdict";
}

// ─── Panel-finder helpers ───────────────────────────────────────────────────

export function findPanel<T extends Panel>(
  panels: Panel[],
  guard: (p: Panel) => p is T,
): T | undefined {
  return panels.find(guard) as T | undefined;
}
