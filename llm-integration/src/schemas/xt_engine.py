from pydantic import BaseModel, Field
from typing import Literal
from src.schemas.ingestion import IngestionMetadata


class TopPassExample(BaseModel):
    """One of a player's most threatening successful passes, kept for grounding the LLM's reasoning."""
    match_id: int
    timestamp: int
    start_zone_id: int
    end_zone_id: int
    xt_delta: float
    receiver_player_id: int | None
    receiver_player_name: str | None


class PlayerXTAggregate(BaseModel):
    """Pre-aggregated by the math layer. The LLM does NOT recompute these values."""
    player_id: int
    player_name: str
    team_side: Literal["home", "away"]
    cumulative_xt: float
    successful_pass_count: int
    average_xt_per_pass: float
    top_passes: list[TopPassExample]
    matches_played: int


class XTEngineInput(BaseModel):
    ingestion: IngestionMetadata
    aggregates: list[PlayerXTAggregate]


class PlayerThreatEntry(BaseModel):
    player_id: int
    player_name: str
    rank: int
    cumulative_xt: float
    reasoning: str
    is_danger_creator: bool


class RankedThreatList(BaseModel):
    opponent_id: int
    ranked_players: list[PlayerThreatEntry]
    danger_creator_id: int
    secondary_targets: list[int] = Field(default_factory=list, max_length=2)
    notes: list[str] = Field(default_factory=list)
