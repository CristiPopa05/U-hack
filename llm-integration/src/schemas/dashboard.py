"""Dashboard payload — the contract between the LLM pipeline and the React frontend.

Phase 1 of `ui_schema_design.md`: a discriminated-union list of panels, each panel
typed and self-describing. The frontend keys its renderer registry on `panel.type`.
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field

from src.schemas.goal_dna import BuildupPattern, PassNetworkGraph
from src.schemas.verdict import DefensiveInstruction


SCHEMA_VERSION = "1"


# ---------- Inputs that come from `spatial_analysis` (cloud-fn output) ----------

class TeamSpatialRow(BaseModel):
    """Row from `spatial_analysis` where `type = 'TEAM'` for the opponent."""
    entity_id: int
    xt_matrix: list[list[float]] = Field(
        description="12 rows x 16 columns of accumulated xT per zone (cloud-fn output).",
    )
    total_xt_value: float
    max_xt_zone_id: int = Field(ge=0, le=191)


class PlayerSpatialRow(BaseModel):
    """Row from `spatial_analysis` where `type = 'PLAYER'`, joined with side stats.

    `total_xt_value` and `max_xt_zone_id` come from the cloud function.
    `minutes`, `passes`, `assists` come from match-level aggregates; the assembler
    treats them as opaque numeric input — Phase 2 (Supabase reader) is responsible
    for populating them.
    """
    player_id: int
    minutes: int
    passes: int
    assists: int
    total_xt_value: float
    max_xt_zone_id: int = Field(ge=0, le=191)


class PlayerLookup(BaseModel):
    """Subset of the `players` table needed to render the danger-creator panel."""
    id: int
    name: str
    position: str | None = None


# ---------- Per-panel payloads ----------

class XTRange(BaseModel):
    min: float
    max: float


class XTGridPanel(BaseModel):
    type: Literal["xt_grid"] = "xt_grid"
    title: str = "Defensive xT Heatmap"
    grid: list[list[float]] = Field(
        description="12 rows x 16 columns. grid[row][col] is the accumulated xT in that zone.",
    )
    range: XTRange
    max_xt_zone_id: int = Field(ge=0, le=191)


class DangerCreatorEntry(BaseModel):
    player_id: int
    name: str
    position: str | None
    minutes: int
    total_xt_value: float
    max_xt_zone_id: int = Field(ge=0, le=191)
    passes: int
    assists: int
    is_primary: bool


class DangerCreatorPanel(BaseModel):
    type: Literal["danger_creator"] = "danger_creator"
    title: str = "Danger Creator"
    players: list[DangerCreatorEntry] = Field(min_length=1)
    narrative: str = Field(
        description="LLM-authored framing pulled from RankedThreatList notes / top reasoning.",
    )


class VulnerabilityAlertsPanel(BaseModel):
    type: Literal["vulnerability_alerts"] = "vulnerability_alerts"
    title: str = "Defensive Instructions"
    alerts: list[DefensiveInstruction] = Field(min_length=1)


class GoalDNAPanel(BaseModel):
    type: Literal["goal_dna_network"] = "goal_dna_network"
    title: str = "Goal DNA"
    graph: PassNetworkGraph
    pattern: BuildupPattern


PhaseSource = Literal["xt_engine", "zones", "goal_dna", "verdict"]


class PhaseSummary(BaseModel):
    phase_label: str
    title: str
    body: str
    source: PhaseSource


class TacticalVerdictPanel(BaseModel):
    type: Literal["tactical_verdict"] = "tactical_verdict"
    title: str = "5-Phase Tactical Verdict"
    headline: str
    summary: str
    confidence: float = Field(ge=0.0, le=1.0)
    phases: list[PhaseSummary] = Field(min_length=4, max_length=4)


Panel = Annotated[
    Union[
        XTGridPanel,
        DangerCreatorPanel,
        VulnerabilityAlertsPanel,
        GoalDNAPanel,
        TacticalVerdictPanel,
    ],
    Field(discriminator="type"),
]


class DashboardPayload(BaseModel):
    match_id: int
    generated_at: datetime
    schema_version: Literal["1"] = SCHEMA_VERSION
    opponent_id: int
    panels: list[Panel] = Field(min_length=5, max_length=5)
