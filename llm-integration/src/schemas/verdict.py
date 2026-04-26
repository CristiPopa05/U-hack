from pydantic import BaseModel, Field
from typing import Literal
from src.schemas.ingestion import IngestionMetadata
from src.schemas.xt_engine import RankedThreatList
from src.schemas.zones import ZonePriorityMap, Corridor
from src.schemas.goal_dna import BuildupPattern

Severity = Literal["critical", "high", "medium", "info"]


class PitchControlAlert(BaseModel):
    zone_id: int
    grid_x: int
    grid_y: int
    corridor: Corridor
    opponent_control_pct: float = Field(ge=0.0, le=1.0)
    our_control_pct: float = Field(ge=0.0, le=1.0)
    xt_exposure: float
    severity: Literal["critical", "high", "medium"]


class PitchControlSummary(BaseModel):
    alerts: list[PitchControlAlert]
    avg_defensive_line_height: float = Field(ge=0.0, le=100.0)
    notes: list[str] = Field(default_factory=list)


class TacticalVerdictInput(BaseModel):
    ingestion: IngestionMetadata
    threats: RankedThreatList
    zones: ZonePriorityMap
    pattern: BuildupPattern
    pitch_control: PitchControlSummary


class DefensiveInstruction(BaseModel):
    severity: Severity
    title: str
    body: str
    target_player_id: int | None = None
    target_zone_ids: list[int] = Field(default_factory=list)


class UISchemaMatrix(BaseModel):
    """Compact echo of upstream findings; the frontend renders this as the heatmap overlay."""
    danger_creator_id: int
    secondary_target_ids: list[int]
    critical_zone_ids: list[int]
    critical_corridors: list[Corridor]
    pattern_signature: str
    pattern_confidence: float


class CoachBrief(BaseModel):
    opponent_id: int
    headline: str
    summary: str
    instructions: list[DefensiveInstruction] = Field(min_length=3, max_length=6)
    ui_schema: UISchemaMatrix
    confidence: float = Field(ge=0.0, le=1.0)
