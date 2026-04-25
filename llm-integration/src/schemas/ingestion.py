from pydantic import BaseModel, Field
from typing import Literal


class ScrapedEvent(BaseModel):
    match_id: int
    player_id: int | None
    event_type: Literal["pass", "shot", "carry", "dribble", "goal"]
    timestamp: int
    start_x: float | None
    start_y: float | None
    end_x: float | None
    end_y: float | None
    is_success: bool


class MatchMetadata(BaseModel):
    match_id: int
    date: str
    home_team: str
    away_team: str
    tournament: str


class PlayerMetadata(BaseModel):
    id: int
    name: str
    team_side: Literal["home", "away"]
    position: str | None


class RawScrapedBundle(BaseModel):
    opponent_id: int
    opponent_name: str
    match_window: tuple[str, str]
    matches: list[MatchMetadata]
    players: list[PlayerMetadata]
    events: list[ScrapedEvent]


class MatchSummary(BaseModel):
    match_id: int
    date: str
    opponent: str
    event_count: int
    is_complete: bool


class PlayerSummary(BaseModel):
    id: int
    name: str
    team_side: Literal["home", "away"]
    appearance_count: int


class CompletenessFlags(BaseModel):
    has_all_lineups: bool
    has_coordinates_for_all_passes: bool
    minimum_events_per_match: bool
    missing_match_ids: list[int]


class EventTypeBreakdown(BaseModel):
    """Counts per event type. The Gemini Developer API does not support
    additionalProperties, so we use explicit fields instead of dict[str, int]."""
    pass_count: int = Field(0, alias="pass")
    shot: int = 0
    carry: int = 0
    dribble: int = 0
    goal: int = 0

    model_config = {"populate_by_name": True}


class IngestionMetadata(BaseModel):
    matches_covered: list[MatchSummary]
    players_present: list[PlayerSummary]
    event_type_breakdown: EventTypeBreakdown
    total_events: int
    completeness: CompletenessFlags
    warnings: list[str] = Field(default_factory=list)
