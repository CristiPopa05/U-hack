"""Phase 1 verification — feeds hand-crafted Pydantic inputs into `assemble_dashboard`,
asserts every panel type is present, the honest-Panel-D mapping pulls from the
correct source agent, and the resulting `DashboardPayload` round-trips through
JSON serialization.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from src.assembler import assemble_dashboard
from src.schemas.dashboard import (
    DangerCreatorPanel,
    DashboardPayload,
    GoalDNAPanel,
    PlayerLookup,
    PlayerSpatialRow,
    TacticalVerdictPanel,
    TeamSpatialRow,
    VulnerabilityAlertsPanel,
    XTGridPanel,
)
from src.schemas.goal_dna import (
    BuildupPattern,
    KeyPlayer,
    PassEdge,
    PassNetworkGraph,
)
from src.schemas.ingestion import (
    CompletenessFlags,
    EventTypeBreakdown,
    IngestionMetadata,
    MatchSummary,
    PlayerSummary,
)
from src.schemas.verdict import CoachBrief, DefensiveInstruction, UISchemaMatrix
from src.schemas.xt_engine import PlayerThreatEntry, RankedThreatList
from src.schemas.zones import ZonePriority, ZonePriorityMap


# ---------------------- Fixtures ----------------------

OPPONENT_ID = 999
MATCH_ID = 3001


@pytest.fixture
def ingestion() -> IngestionMetadata:
    return IngestionMetadata(
        matches_covered=[
            MatchSummary(
                match_id=MATCH_ID,
                date="2026-03-22",
                opponent="FCSB",
                event_count=401,
                is_complete=True,
            )
        ],
        players_present=[
            PlayerSummary(id=9001, name="Marian Crisan", team_side="away", appearance_count=1),
            PlayerSummary(id=9002, name="Ovidiu Hoban", team_side="away", appearance_count=1),
        ],
        event_type_breakdown=EventTypeBreakdown(**{"pass": 300, "shot": 15, "carry": 60, "dribble": 10, "goal": 1}),
        total_events=386,
        completeness=CompletenessFlags(
            has_all_lineups=True,
            has_coordinates_for_all_passes=True,
            minimum_events_per_match=True,
            missing_match_ids=[],
        ),
        warnings=[],
    )


@pytest.fixture
def threats() -> RankedThreatList:
    return RankedThreatList(
        opponent_id=OPPONENT_ID,
        ranked_players=[
            PlayerThreatEntry(
                player_id=9001,
                player_name="Marian Crisan",
                rank=1,
                cumulative_xt=0.84,
                reasoning="47 successful progressive passes from the right halfspace.",
                is_danger_creator=True,
            ),
            PlayerThreatEntry(
                player_id=9002,
                player_name="Ovidiu Hoban",
                rank=2,
                cumulative_xt=0.71,
                reasoning="Deep originator feeding the danger creator from zone 88.",
                is_danger_creator=False,
            ),
        ],
        danger_creator_id=9001,
        secondary_targets=[9002],
        notes=["Top player accounts for over 40% of cumulative xT."],
    )


@pytest.fixture
def zones() -> ZonePriorityMap:
    return ZonePriorityMap(
        opponent_id=OPPONENT_ID,
        priority_zones=[
            ZonePriority(
                zone_id=152,
                grid_x=8,
                grid_y=9,
                corridor="central",
                priority="critical",
                reasoning="xt_sum 0.46 and shot_count 5.",
            ),
            ZonePriority(
                zone_id=170,
                grid_x=10,
                grid_y=10,
                corridor="central",
                priority="high",
                reasoning="xt_sum 0.21 with 24 destination passes.",
            ),
        ],
        critical_corridors=["central", "right_halfspace"],
        summary="Central corridor dominates.",
    )


@pytest.fixture
def pattern() -> BuildupPattern:
    return BuildupPattern(
        opponent_id=OPPONENT_ID,
        pattern_signature="central_progression_through_halfspace",
        confidence=0.72,
        description="Crisan progresses from zone 120 into central zone 152 before the final ball.",
        key_players=[
            KeyPlayer(player_id=9001, player_name="Marian Crisan", role="progressor"),
            KeyPlayer(player_id=9002, player_name="Ovidiu Hoban", role="originator"),
        ],
        starting_zones=[120, 88],
        finishing_zones=[170, 168],
        is_based_on_synthesised_input=False,
        notes=["Pattern present in 2 of 2 observed goals."],
    )


@pytest.fixture
def network_graph() -> PassNetworkGraph:
    return PassNetworkGraph(
        match_id=MATCH_ID,
        goal_scorer_id=9001,
        goal_timestamp=2700,
        duration_seconds=18.5,
        edges=[
            PassEdge(
                from_player_id=9002,
                from_player_name="Ovidiu Hoban",
                to_player_id=9001,
                to_player_name="Marian Crisan",
                from_zone_id=88,
                to_zone_id=120,
                timestamp_offset=0.0,
                weight=1,
            ),
            PassEdge(
                from_player_id=9001,
                from_player_name="Marian Crisan",
                to_player_id=9001,
                to_player_name="Marian Crisan",
                from_zone_id=120,
                to_zone_id=152,
                timestamp_offset=4.2,
                weight=2,
            ),
        ],
        is_synthesised=False,
    )


@pytest.fixture
def brief() -> CoachBrief:
    return CoachBrief(
        opponent_id=OPPONENT_ID,
        headline="Shut down zone 152 to choke FCSB's central progression.",
        summary=(
            "Marian Crisan generates 0.84 cumulative xT through right-halfspace progressions. "
            "Block the cutback into zone 152 with the deeper midfield pivot."
        ),
        instructions=[
            DefensiveInstruction(
                severity="critical",
                title="Press Crisan in zone 120",
                body="Force Marian Crisan onto his weaker foot before he reaches zone 120 (xT 0.84).",
                target_player_id=9001,
                target_zone_ids=[120, 152],
            ),
            DefensiveInstruction(
                severity="high",
                title="Cover the cutback",
                body="The pivot must drop into zone 168 once a pass enters zone 152 (5 shots in window).",
                target_player_id=None,
                target_zone_ids=[152, 168],
            ),
            DefensiveInstruction(
                severity="medium",
                title="Deny Hoban from zone 88",
                body="Block the deep originator: Ovidiu Hoban launches 12 progressions from zone 88.",
                target_player_id=9002,
                target_zone_ids=[88],
            ),
        ],
        ui_schema=UISchemaMatrix(
            danger_creator_id=9001,
            secondary_target_ids=[9002],
            critical_zone_ids=[152],
            critical_corridors=["central", "right_halfspace"],
            pattern_signature="central_progression_through_halfspace",
            pattern_confidence=0.72,
        ),
        confidence=0.78,
    )


@pytest.fixture
def spatial_team_row() -> TeamSpatialRow:
    matrix = [[0.0 for _ in range(16)] for _ in range(12)]
    matrix[9][8] = 0.46  # zone 152 = grid_y * 16 + grid_x  → 9*16 + 8 = 152
    matrix[10][10] = 0.21
    return TeamSpatialRow(
        entity_id=OPPONENT_ID,
        xt_matrix=matrix,
        total_xt_value=0.67,
        max_xt_zone_id=152,
    )


@pytest.fixture
def spatial_player_rows() -> list[PlayerSpatialRow]:
    return [
        PlayerSpatialRow(
            player_id=9002,
            minutes=89,
            passes=58,
            assists=0,
            total_xt_value=0.71,
            max_xt_zone_id=88,
        ),
        PlayerSpatialRow(
            player_id=9001,
            minutes=90,
            passes=72,
            assists=1,
            total_xt_value=0.84,
            max_xt_zone_id=120,
        ),
    ]


@pytest.fixture
def players_by_id() -> dict[int, PlayerLookup]:
    return {
        9001: PlayerLookup(id=9001, name="Marian Crisan", position="AM"),
        9002: PlayerLookup(id=9002, name="Ovidiu Hoban", position="DM"),
    }


# ---------------------- Tests ----------------------

def _panel(payload: DashboardPayload, panel_type: str):
    matches = [p for p in payload.panels if p.type == panel_type]
    assert len(matches) == 1, f"expected exactly one '{panel_type}' panel, got {len(matches)}"
    return matches[0]


def test_assemble_produces_all_five_panels(
    ingestion, threats, zones, pattern, brief, network_graph,
    spatial_team_row, spatial_player_rows, players_by_id,
):
    payload = assemble_dashboard(
        match_id=MATCH_ID,
        ingestion=ingestion,
        threats=threats,
        zones=zones,
        pattern=pattern,
        brief=brief,
        network_graph=network_graph,
        spatial_team_row=spatial_team_row,
        spatial_player_rows=spatial_player_rows,
        players_by_id=players_by_id,
    )

    types = [p.type for p in payload.panels]
    assert types == [
        "xt_grid",
        "danger_creator",
        "vulnerability_alerts",
        "goal_dna_network",
        "tactical_verdict",
    ]
    assert payload.match_id == MATCH_ID
    assert payload.opponent_id == OPPONENT_ID
    assert payload.schema_version == "1"


def test_xt_grid_panel_dimensions_and_range(
    ingestion, threats, zones, pattern, brief, network_graph,
    spatial_team_row, spatial_player_rows, players_by_id,
):
    payload = assemble_dashboard(
        match_id=MATCH_ID, ingestion=ingestion, threats=threats, zones=zones,
        pattern=pattern, brief=brief, network_graph=network_graph,
        spatial_team_row=spatial_team_row, spatial_player_rows=spatial_player_rows,
        players_by_id=players_by_id,
    )
    panel = _panel(payload, "xt_grid")
    assert isinstance(panel, XTGridPanel)
    assert len(panel.grid) == 12
    assert all(len(row) == 16 for row in panel.grid)
    assert panel.range.min == 0.0
    assert panel.range.max == pytest.approx(0.46)
    assert panel.max_xt_zone_id == 152


def test_danger_creator_sorted_and_primary_flagged(
    ingestion, threats, zones, pattern, brief, network_graph,
    spatial_team_row, spatial_player_rows, players_by_id,
):
    payload = assemble_dashboard(
        match_id=MATCH_ID, ingestion=ingestion, threats=threats, zones=zones,
        pattern=pattern, brief=brief, network_graph=network_graph,
        spatial_team_row=spatial_team_row, spatial_player_rows=spatial_player_rows,
        players_by_id=players_by_id,
    )
    panel = _panel(payload, "danger_creator")
    assert isinstance(panel, DangerCreatorPanel)

    # Sorted by total_xt_value descending — Crisan (0.84) before Hoban (0.71),
    # despite the input list having Hoban first.
    assert [p.player_id for p in panel.players] == [9001, 9002]
    assert panel.players[0].is_primary is True
    assert panel.players[1].is_primary is False
    assert panel.players[0].name == "Marian Crisan"
    assert panel.players[0].position == "AM"
    # Narrative is LLM-authored — pulled from threats.notes.
    assert "40%" in panel.narrative


def test_vulnerability_alerts_carry_brief_instructions(
    ingestion, threats, zones, pattern, brief, network_graph,
    spatial_team_row, spatial_player_rows, players_by_id,
):
    payload = assemble_dashboard(
        match_id=MATCH_ID, ingestion=ingestion, threats=threats, zones=zones,
        pattern=pattern, brief=brief, network_graph=network_graph,
        spatial_team_row=spatial_team_row, spatial_player_rows=spatial_player_rows,
        players_by_id=players_by_id,
    )
    panel = _panel(payload, "vulnerability_alerts")
    assert isinstance(panel, VulnerabilityAlertsPanel)
    assert len(panel.alerts) == len(brief.instructions)
    assert panel.alerts[0].title == brief.instructions[0].title


def test_goal_dna_panel_carries_graph_and_pattern(
    ingestion, threats, zones, pattern, brief, network_graph,
    spatial_team_row, spatial_player_rows, players_by_id,
):
    payload = assemble_dashboard(
        match_id=MATCH_ID, ingestion=ingestion, threats=threats, zones=zones,
        pattern=pattern, brief=brief, network_graph=network_graph,
        spatial_team_row=spatial_team_row, spatial_player_rows=spatial_player_rows,
        players_by_id=players_by_id,
    )
    panel = _panel(payload, "goal_dna_network")
    assert isinstance(panel, GoalDNAPanel)
    assert panel.graph.match_id == MATCH_ID
    assert panel.pattern.pattern_signature == "central_progression_through_halfspace"
    assert len(panel.graph.edges) == 2


def test_tactical_verdict_phases_pull_from_correct_source(
    ingestion, threats, zones, pattern, brief, network_graph,
    spatial_team_row, spatial_player_rows, players_by_id,
):
    payload = assemble_dashboard(
        match_id=MATCH_ID, ingestion=ingestion, threats=threats, zones=zones,
        pattern=pattern, brief=brief, network_graph=network_graph,
        spatial_team_row=spatial_team_row, spatial_player_rows=spatial_player_rows,
        players_by_id=players_by_id,
    )
    panel = _panel(payload, "tactical_verdict")
    assert isinstance(panel, TacticalVerdictPanel)
    assert panel.headline == brief.headline
    assert panel.summary == brief.summary
    assert panel.confidence == brief.confidence
    assert len(panel.phases) == 4

    sources = [phase.source for phase in panel.phases]
    assert sources == ["xt_engine", "zones", "goal_dna", "verdict"]

    # Phase 1&2: pulls from threats — top player's name and cumulative xT must appear.
    assert "Marian Crisan" in panel.phases[0].body
    assert "0.84" in panel.phases[0].body

    # Phase 3: pulls from zones — first critical zone (152) and its corridor.
    assert "152" in panel.phases[1].body
    assert "central" in panel.phases[1].body

    # Phase 4: pulls verbatim from BuildupPattern.description.
    assert panel.phases[2].body == pattern.description

    # Phase 5: pulls from CoachBrief — headline + first sentence of summary.
    assert brief.headline in panel.phases[3].body
    assert "0.84 cumulative xT" in panel.phases[3].body


def test_payload_round_trips_through_json(
    ingestion, threats, zones, pattern, brief, network_graph,
    spatial_team_row, spatial_player_rows, players_by_id,
):
    payload = assemble_dashboard(
        match_id=MATCH_ID, ingestion=ingestion, threats=threats, zones=zones,
        pattern=pattern, brief=brief, network_graph=network_graph,
        spatial_team_row=spatial_team_row, spatial_player_rows=spatial_player_rows,
        players_by_id=players_by_id,
        generated_at=datetime(2026, 4, 26, 12, 0, 0, tzinfo=timezone.utc),
    )

    serialized = payload.model_dump_json()
    # Discriminator must survive serialization so the frontend can dispatch.
    parsed = json.loads(serialized)
    assert [p["type"] for p in parsed["panels"]] == [
        "xt_grid",
        "danger_creator",
        "vulnerability_alerts",
        "goal_dna_network",
        "tactical_verdict",
    ]

    rebuilt = DashboardPayload.model_validate_json(serialized)
    assert rebuilt.match_id == payload.match_id
    assert rebuilt.opponent_id == payload.opponent_id
    assert [p.type for p in rebuilt.panels] == [p.type for p in payload.panels]
    # Panel-specific shape survives the round trip.
    rebuilt_xt = next(p for p in rebuilt.panels if p.type == "xt_grid")
    assert isinstance(rebuilt_xt, XTGridPanel)
    assert rebuilt_xt.max_xt_zone_id == 152
