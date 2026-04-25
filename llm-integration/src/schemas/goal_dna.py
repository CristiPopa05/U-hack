from pydantic import BaseModel, Field
from typing import Literal
from src.schemas.ingestion import IngestionMetadata


class PassEdge(BaseModel):
    from_player_id: int
    from_player_name: str
    to_player_id: int
    to_player_name: str
    from_zone_id: int
    to_zone_id: int
    timestamp_offset: float
    weight: int = 1


class PassNetworkGraph(BaseModel):
    match_id: int
    goal_scorer_id: int | None
    goal_timestamp: int | None
    duration_seconds: float
    edges: list[PassEdge] = Field(min_length=1)
    is_synthesised: bool = False


class GoalDNAInput(BaseModel):
    ingestion: IngestionMetadata
    graphs: list[PassNetworkGraph] = Field(min_length=1, max_length=5)


PatternSignature = Literal[
    "wide_overload_to_central_finish",
    "central_progression_through_halfspace",
    "fast_transition_counter",
    "set_piece_secondary",
    "deep_buildup_long_switch",
    "individual_dribble_initiated",
    "mixed_inconclusive",
]

PlayerRole = Literal["originator", "progressor", "finisher", "decoy", "switcher"]


class KeyPlayer(BaseModel):
    player_id: int
    player_name: str
    role: PlayerRole


class BuildupPattern(BaseModel):
    opponent_id: int
    pattern_signature: PatternSignature
    confidence: float = Field(ge=0.0, le=1.0)
    description: str
    key_players: list[KeyPlayer] = Field(min_length=2, max_length=4)
    starting_zones: list[int] = Field(min_length=1, max_length=3)
    finishing_zones: list[int] = Field(min_length=1, max_length=3)
    is_based_on_synthesised_input: bool
    notes: list[str] = Field(default_factory=list)
