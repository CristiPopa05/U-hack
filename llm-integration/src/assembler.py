"""Deterministic assembler — turns the 5 LLM phase outputs (+ math-layer spatial
data) into a `DashboardPayload` ready for the React frontend.

This module performs **no LLM calls**. Every field on the dashboard either comes
from a Pydantic input verbatim or is a trivial transformation (sorting, joining,
extracting a min/max). The "honest Panel D" rule — each tactical-verdict card
quotes its source agent rather than being re-narrated — is enforced here.
"""
from __future__ import annotations

from datetime import datetime, timezone

from src.schemas.dashboard import (
    DangerCreatorEntry,
    DangerCreatorPanel,
    DashboardPayload,
    GoalDNAPanel,
    Panel,
    PhaseSummary,
    PlayerLookup,
    PlayerSpatialRow,
    TacticalVerdictPanel,
    TeamSpatialRow,
    VulnerabilityAlertsPanel,
    XTGridPanel,
    XTRange,
)
from src.schemas.goal_dna import BuildupPattern, PassNetworkGraph
from src.schemas.ingestion import IngestionMetadata
from src.schemas.verdict import CoachBrief
from src.schemas.xt_engine import RankedThreatList
from src.schemas.zones import ZonePriorityMap


def _build_xt_grid_panel(team: TeamSpatialRow) -> XTGridPanel:
    flat = [v for row in team.xt_matrix for v in row]
    return XTGridPanel(
        grid=team.xt_matrix,
        range=XTRange(min=min(flat), max=max(flat)),
        max_xt_zone_id=team.max_xt_zone_id,
    )


def _build_danger_creator_panel(
    threats: RankedThreatList,
    spatial_players: list[PlayerSpatialRow],
    players_by_id: dict[int, PlayerLookup],
) -> DangerCreatorPanel:
    sorted_rows = sorted(spatial_players, key=lambda r: r.total_xt_value, reverse=True)
    entries: list[DangerCreatorEntry] = []
    for row in sorted_rows:
        lookup = players_by_id.get(row.player_id)
        if lookup is None:
            continue
        entries.append(
            DangerCreatorEntry(
                player_id=row.player_id,
                name=lookup.name,
                position=lookup.position,
                minutes=row.minutes,
                total_xt_value=row.total_xt_value,
                max_xt_zone_id=row.max_xt_zone_id,
                passes=row.passes,
                assists=row.assists,
                is_primary=row.player_id == threats.danger_creator_id,
            )
        )

    if threats.notes:
        narrative = " ".join(threats.notes)
    elif threats.ranked_players:
        narrative = threats.ranked_players[0].reasoning
    else:
        narrative = "No threat reasoning available."

    return DangerCreatorPanel(players=entries, narrative=narrative)


def _build_vulnerability_alerts_panel(brief: CoachBrief) -> VulnerabilityAlertsPanel:
    return VulnerabilityAlertsPanel(alerts=list(brief.instructions))


def _build_goal_dna_panel(graph: PassNetworkGraph, pattern: BuildupPattern) -> GoalDNAPanel:
    return GoalDNAPanel(graph=graph, pattern=pattern)


def _first_sentence(text: str) -> str:
    text = text.strip()
    if not text:
        return text
    for terminator in (". ", "? ", "! "):
        idx = text.find(terminator)
        if idx != -1:
            return text[: idx + 1].strip()
    return text if text.endswith((".", "?", "!")) else text + "."


def _phase_xt_engine(threats: RankedThreatList) -> PhaseSummary:
    if not threats.ranked_players:
        body = "No ranked threats available."
    else:
        top = threats.ranked_players[0]
        body = (
            f"{top.player_name} (cumulative xT {top.cumulative_xt:.2f}) is the danger creator. "
            f"{top.reasoning}"
        )
    return PhaseSummary(
        phase_label="Phases 1 & 2",
        title="Engine & xT Attribution",
        body=body,
        source="xt_engine",
    )


def _phase_zones(zones: ZonePriorityMap) -> PhaseSummary:
    critical = next((z for z in zones.priority_zones if z.priority == "critical"), None)
    if critical is None:
        body = zones.summary
    else:
        body = (
            f"Zone {critical.zone_id} ({critical.corridor}) is the critical exposure: "
            f"{critical.reasoning}"
        )
    return PhaseSummary(
        phase_label="Phase 3",
        title="Zone Analysis",
        body=body,
        source="zones",
    )


def _phase_goal_dna(pattern: BuildupPattern) -> PhaseSummary:
    return PhaseSummary(
        phase_label="Phase 4",
        title="Goal DNA",
        body=pattern.description,
        source="goal_dna",
    )


def _phase_verdict(brief: CoachBrief) -> PhaseSummary:
    body = f"{brief.headline} {_first_sentence(brief.summary)}".strip()
    return PhaseSummary(
        phase_label="Phase 5",
        title="Tactical Verdict",
        body=body,
        source="verdict",
    )


def _build_tactical_verdict_panel(
    threats: RankedThreatList,
    zones: ZonePriorityMap,
    pattern: BuildupPattern,
    brief: CoachBrief,
) -> TacticalVerdictPanel:
    return TacticalVerdictPanel(
        headline=brief.headline,
        summary=brief.summary,
        confidence=brief.confidence,
        phases=[
            _phase_xt_engine(threats),
            _phase_zones(zones),
            _phase_goal_dna(pattern),
            _phase_verdict(brief),
        ],
    )


def assemble_dashboard(
    *,
    match_id: int,
    ingestion: IngestionMetadata,
    threats: RankedThreatList,
    zones: ZonePriorityMap,
    pattern: BuildupPattern,
    brief: CoachBrief,
    network_graph: PassNetworkGraph,
    spatial_team_row: TeamSpatialRow,
    spatial_player_rows: list[PlayerSpatialRow],
    players_by_id: dict[int, PlayerLookup],
    generated_at: datetime | None = None,
) -> DashboardPayload:
    """Compose the dashboard payload from the 5 phase outputs and math-layer rows.

    Inputs are all typed Pydantic models — Phase 2 (Supabase reader) and Phase 3
    (orchestrator) are responsible for sourcing them. Pure deterministic; safe
    to call from tests with hand-crafted fixtures.
    """
    panels: list[Panel] = [
        _build_xt_grid_panel(spatial_team_row),
        _build_danger_creator_panel(threats, spatial_player_rows, players_by_id),
        _build_vulnerability_alerts_panel(brief),
        _build_goal_dna_panel(network_graph, pattern),
        _build_tactical_verdict_panel(threats, zones, pattern, brief),
    ]
    return DashboardPayload(
        match_id=match_id,
        generated_at=generated_at or datetime.now(timezone.utc),
        opponent_id=brief.opponent_id,
        panels=panels,
    )
