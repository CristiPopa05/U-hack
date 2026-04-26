"""Pipeline orchestrator — chains Supabase reader → 5 LLM agents → assembler.

Phase 3 of `ui_schema_design.md`.

    run_pipeline(match_id) → DashboardPayload

The pipeline is **prompt-chaining** (fixed sequence, not agent-loop). Each
phase's typed output gates the next phase's input. Pydantic validation between
phases acts as the deterministic gate.

Sequence:
    1. Fetch data from Supabase (reader — Phase 2)
    2. run_ingestion           (Phase 1 agent — Flash)
    3. run_xt_engine            (Phase 2 agent — Flash)
    4. run_zone_analysis        (Phase 3 agent — Flash)
    5. run_goal_dna             (Phase 4 agent — Flash)
    6. run_tactical_verdict     (Phase 5 agent — Pro)
    7. assemble_dashboard       (deterministic — no LLM)
"""
from __future__ import annotations

import logging
from collections import Counter
from typing import Any, Literal

from src.assembler import assemble_dashboard
from src.db.bundle import build_raw_bundle, stable_int_from_uuid
from src.db.supabase_client import SupabaseClient, get_default_client

# Agents
from src.agents.ingestion import run_ingestion
from src.agents.xt_engine import run_xt_engine
from src.agents.zones import run_zone_analysis
from src.agents.goal_dna import run_goal_dna
from src.agents.verdict import run_tactical_verdict

# Schemas — inputs
from src.schemas.xt_engine import XTEngineInput, PlayerXTAggregate, TopPassExample
from src.schemas.zones import ZoneAnalysisInput, ZoneAggregates, ZoneAggregate
from src.schemas.goal_dna import GoalDNAInput, PassNetworkGraph, PassEdge
from src.schemas.verdict import (
    TacticalVerdictInput,
    PitchControlSummary,
    PitchControlAlert,
)

# Schemas — dashboard (assembler inputs)
from src.schemas.dashboard import (
    DashboardPayload,
    PlayerLookup,
    PlayerSpatialRow,
    TeamSpatialRow,
)

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────
# Helpers — build typed agent inputs from raw Supabase rows
# ─────────────────────────────────────────────────────────────

_CORRIDOR_BY_X: dict[int, str] = {}
for _x in range(16):
    if _x <= 2:
        _CORRIDOR_BY_X[_x] = "left_wing"
    elif _x <= 5:
        _CORRIDOR_BY_X[_x] = "left_halfspace"
    elif _x <= 9:
        _CORRIDOR_BY_X[_x] = "central"
    elif _x <= 12:
        _CORRIDOR_BY_X[_x] = "right_halfspace"
    else:
        _CORRIDOR_BY_X[_x] = "right_wing"


def _corridor_for(grid_x: int) -> str:
    return _CORRIDOR_BY_X.get(grid_x, "central")


def _build_xt_engine_input(
    ingestion_metadata,
    spatial_player_rows: list[dict[str, Any]],
    players_by_id: dict[int, dict[str, Any]],
    pass_rows: list[dict[str, Any]],
) -> XTEngineInput:
    """Build the Phase 2 agent input from spatial_analysis PLAYER rows + passes."""
    aggregates: list[PlayerXTAggregate] = []

    # Group passes by player for top-pass extraction
    passes_by_player: dict[int, list[dict[str, Any]]] = {}
    for p in pass_rows:
        pid = p.get("player_id")
        if pid is not None:
            passes_by_player.setdefault(pid, []).append(p)

    for row in spatial_player_rows:
        pid = row["entity_id"]
        player_info = players_by_id.get(pid, {})
        player_name = player_info.get("name", f"Player-{pid}")
        team_side = player_info.get("team_side", "away")

        # Extract total xT and pass count from spatial_analysis
        total_xt = float(row.get("total_xt_value", 0.0))
        # Count passes for this player
        player_passes = passes_by_player.get(pid, [])
        pass_count = len(player_passes)
        avg_xt = total_xt / pass_count if pass_count > 0 else 0.0

        # Build top pass examples from the player's passes (sorted by xt desc)
        sorted_passes = sorted(
            player_passes, key=lambda p: float(p.get("xt", 0.0)), reverse=True
        )
        top_passes: list[TopPassExample] = []
        for tp in sorted_passes[:3]:
            # Map coordinates to zone IDs (16x12 grid, zone = grid_y * 16 + grid_x)
            sx, sy = float(tp.get("x_start", 0)), float(tp.get("y_start", 0))
            ex, ey = float(tp.get("x_end", 0)), float(tp.get("y_end", 0))
            start_zone = int(sy * 12 / 100) * 16 + int(sx * 16 / 100)
            end_zone = int(ey * 12 / 100) * 16 + int(ex * 16 / 100)
            start_zone = max(0, min(191, start_zone))
            end_zone = max(0, min(191, end_zone))

            top_passes.append(
                TopPassExample(
                    match_id=int(tp.get("match_id", 0)),
                    timestamp=0,
                    start_zone_id=start_zone,
                    end_zone_id=end_zone,
                    xt_delta=float(tp.get("xt", 0.0)),
                    receiver_player_id=tp.get("receiver_player_id"),
                    receiver_player_name=None,
                )
            )

        # Match count — assume 1 for single-match pipeline
        aggregates.append(
            PlayerXTAggregate(
                player_id=pid,
                player_name=player_name,
                team_side=team_side,
                cumulative_xt=total_xt,
                successful_pass_count=pass_count,
                average_xt_per_pass=round(avg_xt, 6),
                top_passes=top_passes,
                matches_played=1,
            )
        )

    return XTEngineInput(ingestion=ingestion_metadata, aggregates=aggregates)


def _build_zone_analysis_input(
    ingestion_metadata,
    spatial_team_row: dict[str, Any],
    pass_rows: list[dict[str, Any]],
    event_rows: list[dict[str, Any]],
) -> ZoneAnalysisInput:
    """Build the Phase 3 agent input: 192 zone aggregates from spatial + event data."""
    # Extract the xT matrix from the team spatial row
    xt_matrix = spatial_team_row.get("xt_matrix", [[0.0] * 16 for _ in range(12)])

    # Count pass destinations and origins per zone
    dest_counts: Counter[int] = Counter()
    origin_counts: Counter[int] = Counter()
    for p in pass_rows:
        sx, sy = float(p.get("x_start", 0)), float(p.get("y_start", 0))
        ex, ey = float(p.get("x_end", 0)), float(p.get("y_end", 0))
        origin_zone = int(sy * 12 / 100) * 16 + int(sx * 16 / 100)
        dest_zone = int(ey * 12 / 100) * 16 + int(ex * 16 / 100)
        origin_zone = max(0, min(191, origin_zone))
        dest_zone = max(0, min(191, dest_zone))
        origin_counts[origin_zone] += 1
        dest_counts[dest_zone] += 1

    # Count shots per zone
    shot_counts: Counter[int] = Counter()
    for e in event_rows:
        if e.get("event_type") == "shot":
            sx, sy = float(e.get("start_x", 0) or 0), float(e.get("start_y", 0) or 0)
            zone = int(sy * 12 / 100) * 16 + int(sx * 16 / 100)
            zone = max(0, min(191, zone))
            shot_counts[zone] += 1

    # Build all 192 zone aggregates
    zone_list: list[ZoneAggregate] = []
    for gy in range(12):
        for gx in range(16):
            zone_id = gy * 16 + gx
            xt_val = xt_matrix[gy][gx] if gy < len(xt_matrix) and gx < len(xt_matrix[gy]) else 0.0
            pass_dest = dest_counts.get(zone_id, 0)
            pass_orig = origin_counts.get(zone_id, 0)
            shots = shot_counts.get(zone_id, 0)
            total_passes = pass_dest + pass_orig
            avg_delta = xt_val / total_passes if total_passes > 0 else 0.0

            zone_list.append(
                ZoneAggregate(
                    zone_id=zone_id,
                    grid_x=gx,
                    grid_y=gy,
                    corridor=_corridor_for(gx),
                    pass_destination_count=pass_dest,
                    pass_origin_count=pass_orig,
                    shot_count=shots,
                    xt_sum=round(xt_val, 6),
                    avg_xt_delta=round(avg_delta, 6),
                )
            )

    return ZoneAnalysisInput(
        ingestion=ingestion_metadata,
        zones=ZoneAggregates(aggregates=zone_list),
    )


def _build_goal_dna_input(
    ingestion_metadata,
    event_rows: list[dict[str, Any]],
    players_by_id: dict[int, dict[str, Any]],
    opponent_id: int,
) -> GoalDNAInput:
    """Build Phase 4 agent input: pass-network graphs for goals (or synthesised attacks)."""
    # Find goal events
    goals = [e for e in event_rows if e.get("event_type") == "goal"]

    graphs: list[PassNetworkGraph] = []

    if goals:
        for goal in goals[:5]:
            goal_ts = int(goal.get("timestamp", 0) or 0)
            scorer_id = goal.get("player_id")

            # Collect passes in the 20 seconds before the goal
            window_start = max(0, goal_ts - 20)
            nearby_passes = [
                e for e in event_rows
                if e.get("event_type") == "pass"
                and window_start <= int(e.get("timestamp", 0) or 0) <= goal_ts
            ]

            edges: list[PassEdge] = []
            for p in nearby_passes:
                from_pid = p.get("player_id") or 0
                to_pid = p.get("receiver_player_id") or from_pid
                from_name = players_by_id.get(from_pid, {}).get("name", f"Player-{from_pid}")
                to_name = players_by_id.get(to_pid, {}).get("name", f"Player-{to_pid}")

                sx, sy = float(p.get("start_x", 0) or 0), float(p.get("start_y", 0) or 0)
                ex, ey = float(p.get("end_x", 0) or 0), float(p.get("end_y", 0) or 0)
                from_zone = max(0, min(191, int(sy * 12 / 100) * 16 + int(sx * 16 / 100)))
                to_zone = max(0, min(191, int(ey * 12 / 100) * 16 + int(ex * 16 / 100)))

                ts_offset = int(p.get("timestamp", 0) or 0) - goal_ts

                edges.append(
                    PassEdge(
                        from_player_id=from_pid,
                        from_player_name=from_name,
                        to_player_id=to_pid,
                        to_player_name=to_name,
                        from_zone_id=from_zone,
                        to_zone_id=to_zone,
                        timestamp_offset=float(ts_offset),
                    )
                )

            # If no passes in the window, synthesise a minimal edge
            if not edges:
                scorer_name = players_by_id.get(scorer_id, {}).get("name", f"Player-{scorer_id}")
                edges = [
                    PassEdge(
                        from_player_id=scorer_id or 0,
                        from_player_name=scorer_name,
                        to_player_id=scorer_id or 0,
                        to_player_name=scorer_name,
                        from_zone_id=160,
                        to_zone_id=176,
                        timestamp_offset=-1.0,
                    )
                ]

            graphs.append(
                PassNetworkGraph(
                    match_id=int(goal.get("match_id", 0)),
                    goal_scorer_id=scorer_id,
                    goal_timestamp=goal_ts,
                    duration_seconds=20.0,
                    edges=edges,
                    is_synthesised=False,
                )
            )
    else:
        # No goals — synthesise a representative dangerous-attack graph
        # from the most active pass sequences
        shot_events = [e for e in event_rows if e.get("event_type") == "shot"]
        if shot_events:
            # Use the most dangerous shot as anchor
            anchor = shot_events[0]
            anchor_ts = int(anchor.get("timestamp", 0) or 0)
            window_start = max(0, anchor_ts - 20)
            nearby = [
                e for e in event_rows
                if e.get("event_type") == "pass"
                and window_start <= int(e.get("timestamp", 0) or 0) <= anchor_ts
            ]
            edges = []
            for p in nearby[:10]:
                from_pid = p.get("player_id") or 0
                to_pid = p.get("receiver_player_id") or from_pid
                from_name = players_by_id.get(from_pid, {}).get("name", f"Player-{from_pid}")
                to_name = players_by_id.get(to_pid, {}).get("name", f"Player-{to_pid}")
                sx, sy = float(p.get("start_x", 0) or 0), float(p.get("start_y", 0) or 0)
                ex, ey = float(p.get("end_x", 0) or 0), float(p.get("end_y", 0) or 0)
                from_zone = max(0, min(191, int(sy * 12 / 100) * 16 + int(sx * 16 / 100)))
                to_zone = max(0, min(191, int(ey * 12 / 100) * 16 + int(ex * 16 / 100)))
                ts_offset = int(p.get("timestamp", 0) or 0) - anchor_ts
                edges.append(
                    PassEdge(
                        from_player_id=from_pid,
                        from_player_name=from_name,
                        to_player_id=to_pid,
                        to_player_name=to_name,
                        from_zone_id=from_zone,
                        to_zone_id=to_zone,
                        timestamp_offset=float(ts_offset),
                    )
                )
            if not edges:
                # Absolute fallback: minimal synthetic edge
                edges = [
                    PassEdge(
                        from_player_id=anchor.get("player_id") or 0,
                        from_player_name=players_by_id.get(
                            anchor.get("player_id") or 0, {}
                        ).get("name", "Unknown"),
                        to_player_id=anchor.get("player_id") or 0,
                        to_player_name=players_by_id.get(
                            anchor.get("player_id") or 0, {}
                        ).get("name", "Unknown"),
                        from_zone_id=160,
                        to_zone_id=176,
                        timestamp_offset=-1.0,
                    )
                ]
            graphs.append(
                PassNetworkGraph(
                    match_id=int(anchor.get("match_id", 0)),
                    goal_scorer_id=None,
                    goal_timestamp=None,
                    duration_seconds=20.0,
                    edges=edges,
                    is_synthesised=True,
                )
            )
        else:
            # No goals, no shots — fabricate a minimal synthesised graph
            first_event = event_rows[0] if event_rows else {}
            fallback_pid = first_event.get("player_id") or 0
            fallback_name = players_by_id.get(fallback_pid, {}).get("name", "Unknown")
            graphs.append(
                PassNetworkGraph(
                    match_id=int(first_event.get("match_id", 0)),
                    goal_scorer_id=None,
                    goal_timestamp=None,
                    duration_seconds=20.0,
                    edges=[
                        PassEdge(
                            from_player_id=fallback_pid,
                            from_player_name=fallback_name,
                            to_player_id=fallback_pid,
                            to_player_name=fallback_name,
                            from_zone_id=80,
                            to_zone_id=160,
                            timestamp_offset=-5.0,
                        )
                    ],
                    is_synthesised=True,
                )
            )

    return GoalDNAInput(ingestion=ingestion_metadata, graphs=graphs)


def _build_pitch_control_summary(
    zones_output,
    spatial_team_row: dict[str, Any],
) -> PitchControlSummary:
    """Build a PitchControlSummary from the zone analysis output.

    This is a simplified derivation — a proper pitch-control model would need
    tracking data. We approximate from the zone priority map: zones flagged
    as critical/high by the opponent indicate our defensive vulnerability.
    """
    alerts: list[PitchControlAlert] = []
    for z in zones_output.priority_zones:
        if z.priority in ("critical", "high"):
            alerts.append(
                PitchControlAlert(
                    zone_id=z.zone_id,
                    grid_x=z.grid_x,
                    grid_y=z.grid_y,
                    corridor=z.corridor,
                    opponent_control_pct=0.65 if z.priority == "critical" else 0.55,
                    our_control_pct=0.35 if z.priority == "critical" else 0.45,
                    xt_exposure=0.3 if z.priority == "critical" else 0.15,
                    severity=z.priority,
                )
            )

    # Approximate defensive line height from team xT matrix
    xt_matrix = spatial_team_row.get("xt_matrix", [[0.0] * 16 for _ in range(12)])
    total_xt_by_row = [sum(row) for row in xt_matrix]
    total = sum(total_xt_by_row)
    if total > 0:
        weighted_height = sum(
            (gy / 11) * 100 * row_xt for gy, row_xt in enumerate(total_xt_by_row)
        ) / total
    else:
        weighted_height = 50.0
    avg_defensive_line_height = min(100.0, max(0.0, weighted_height))

    return PitchControlSummary(
        alerts=alerts,
        avg_defensive_line_height=round(avg_defensive_line_height, 1),
        notes=[f"{len(alerts)} zones flagged from zone analysis"],
    )


def _extract_spatial_rows(
    spatial_rows: list[dict[str, Any]],
    opponent_id: int,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Split spatial_analysis rows into team and player rows."""
    team_rows = [r for r in spatial_rows if r.get("type") == "TEAM"]
    player_rows = [r for r in spatial_rows if r.get("type") == "PLAYER"]

    if not team_rows:
        raise ValueError(
            f"No TEAM row in spatial_analysis. Has the cloud function POST "
            f"been triggered for this match?"
        )
    return team_rows[0], player_rows


def _build_player_lookup(
    player_rows: list[dict[str, Any]],
) -> dict[int, dict[str, Any]]:
    """Build a player_id → raw-row dict for quick name/position lookup."""
    return {int(p["id"]): p for p in player_rows}


def _build_dashboard_player_lookup(
    players_by_id: dict[int, dict[str, Any]],
) -> dict[int, PlayerLookup]:
    """Convert raw player dicts → typed PlayerLookup models for the assembler."""
    return {
        pid: PlayerLookup(
            id=pid,
            name=info.get("name", f"Player-{pid}"),
            position=info.get("position"),
        )
        for pid, info in players_by_id.items()
    }


def _build_spatial_player_models(
    spatial_player_rows: list[dict[str, Any]],
    pass_rows: list[dict[str, Any]],
    event_rows: list[dict[str, Any]],
) -> list[PlayerSpatialRow]:
    """Convert raw spatial_analysis PLAYER rows → typed PlayerSpatialRow models."""
    # Count passes and assists per player
    pass_counts: Counter[int] = Counter()
    assist_counts: Counter[int] = Counter()
    for p in pass_rows:
        pid = p.get("player_id")
        if pid is not None:
            pass_counts[pid] += 1
            if p.get("is_assist"):
                assist_counts[pid] += 1

    models: list[PlayerSpatialRow] = []
    for row in spatial_player_rows:
        pid = row["entity_id"]
        models.append(
            PlayerSpatialRow(
                player_id=pid,
                minutes=90,  # Default — single-match pipeline
                passes=pass_counts.get(pid, 0),
                assists=assist_counts.get(pid, 0),
                total_xt_value=float(row.get("total_xt_value", 0.0)),
                max_xt_zone_id=int(row.get("max_xt_zone_id", 0)),
            )
        )
    return models


# ─────────────────────────────────────────────────────────────
# Main orchestrator
# ─────────────────────────────────────────────────────────────

def run_pipeline(
    match_id: int,
    *,
    opponent_team_side: Literal["home", "away"] = "away",
    client: SupabaseClient | None = None,
) -> DashboardPayload:
    """Execute the full 5-phase LLM chain for a single match.

    Returns a `DashboardPayload` ready for the FastAPI response / frontend.

    Raises on any phase failure — the caller (API server) decides retry policy
    and error-response shape.
    """
    sb = client or get_default_client()

    # ── Step 1: Fetch from Supabase ──────────────────────────
    logger.info("Pipeline [%d]: fetching data from Supabase", match_id)
    bundle = build_raw_bundle(match_id, opponent_team_side=opponent_team_side, client=sb)

    raw_spatial = sb.fetch_spatial_analysis(match_id)
    spatial_team_raw, spatial_player_raws = _extract_spatial_rows(raw_spatial, bundle.opponent_id)

    raw_players = sb.fetch_players(match_id)
    raw_passes = sb.fetch_passes(match_id)
    raw_events = sb.fetch_match_events(match_id)

    players_by_id = _build_player_lookup(raw_players)

    # ── Step 2: Phase 1 — Ingestion ──────────────────────────
    logger.info("Pipeline [%d]: Phase 1 — Ingestion", match_id)
    ingestion = run_ingestion(bundle)

    # ── Step 3: Phase 2 — xT Engine ──────────────────────────
    logger.info("Pipeline [%d]: Phase 2 — xT Engine", match_id)
    xt_input = _build_xt_engine_input(
        ingestion, spatial_player_raws, players_by_id, raw_passes,
    )
    threats = run_xt_engine(xt_input)

    # ── Step 4: Phase 3 — Zone Analysis ──────────────────────
    logger.info("Pipeline [%d]: Phase 3 — Zone Analysis", match_id)
    zone_input = _build_zone_analysis_input(
        ingestion, spatial_team_raw, raw_passes, raw_events,
    )
    zones = run_zone_analysis(zone_input)

    # ── Step 5: Phase 4 — Goal DNA ───────────────────────────
    logger.info("Pipeline [%d]: Phase 4 — Goal DNA", match_id)
    goal_dna_input = _build_goal_dna_input(
        ingestion, raw_events, players_by_id, bundle.opponent_id,
    )
    pattern = run_goal_dna(goal_dna_input)
    # The first graph is used as the network graph for the dashboard
    network_graph = goal_dna_input.graphs[0]

    # ── Step 6: Phase 5 — Tactical Verdict ───────────────────
    logger.info("Pipeline [%d]: Phase 5 — Tactical Verdict", match_id)
    pitch_control = _build_pitch_control_summary(zones, spatial_team_raw)
    verdict_input = TacticalVerdictInput(
        ingestion=ingestion,
        threats=threats,
        zones=zones,
        pattern=pattern,
        pitch_control=pitch_control,
    )
    brief = run_tactical_verdict(verdict_input)

    # ── Step 7: Assemble dashboard ───────────────────────────
    logger.info("Pipeline [%d]: assembling dashboard", match_id)

    # Build typed models for the assembler
    spatial_team_model = TeamSpatialRow(
        entity_id=spatial_team_raw["entity_id"],
        xt_matrix=spatial_team_raw["xt_matrix"],
        total_xt_value=float(spatial_team_raw.get("total_xt_value", 0.0)),
        max_xt_zone_id=int(spatial_team_raw.get("max_xt_zone_id", 0)),
    )

    spatial_player_models = _build_spatial_player_models(
        spatial_player_raws, raw_passes, raw_events,
    )

    dashboard_player_lookup = _build_dashboard_player_lookup(players_by_id)

    payload = assemble_dashboard(
        match_id=match_id,
        ingestion=ingestion,
        threats=threats,
        zones=zones,
        pattern=pattern,
        brief=brief,
        network_graph=network_graph,
        spatial_team_row=spatial_team_model,
        spatial_player_rows=spatial_player_models,
        players_by_id=dashboard_player_lookup,
    )

    logger.info("Pipeline [%d]: done — %d panels", match_id, len(payload.panels))
    return payload
