from pydantic import BaseModel, Field
from typing import Literal
from src.schemas.ingestion import IngestionMetadata

Corridor = Literal["left_wing", "left_halfspace", "central", "right_halfspace", "right_wing"]
Priority = Literal["critical", "high", "medium"]


class ZoneAggregate(BaseModel):
    """Per-zone aggregates over the match window. Math-layer output."""
    zone_id: int
    grid_x: int
    grid_y: int
    corridor: Corridor
    pass_destination_count: int
    pass_origin_count: int
    shot_count: int
    xt_sum: float
    avg_xt_delta: float


class ZoneAggregates(BaseModel):
    aggregates: list[ZoneAggregate] = Field(min_length=192, max_length=192)


class ZoneAnalysisInput(BaseModel):
    ingestion: IngestionMetadata
    zones: ZoneAggregates


class ZonePriority(BaseModel):
    zone_id: int
    grid_x: int
    grid_y: int
    corridor: Corridor
    priority: Priority
    reasoning: str


class ZonePriorityMap(BaseModel):
    opponent_id: int
    priority_zones: list[ZonePriority]
    critical_corridors: list[Corridor] = Field(min_length=1, max_length=3)
    summary: str
