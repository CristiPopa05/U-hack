"""Joins raw Supabase rows into the typed `RawScrapedBundle` the ingestion
agent consumes.

Why a separate module from the client? — keeps the HTTP layer focused on rows
and lets us unit-test the joining logic against mock fixtures without a network
round-trip.
"""
from __future__ import annotations

import hashlib
from typing import Any, Iterable, Literal

from src.db.supabase_client import (
    SupabaseClient,
    fetch_match,
    fetch_match_events,
    fetch_passes,
    fetch_players,
)
from src.schemas.ingestion import (
    MatchMetadata,
    PlayerMetadata,
    RawScrapedBundle,
    ScrapedEvent,
)


# event_type values from `match_events` that don't map to the ingestion schema
# are silently dropped — the LLM has fixed Literal types it can validate against.
_VALID_EVENT_TYPES: set[str] = {"pass", "shot", "carry", "dribble", "goal"}

TeamSide = Literal["home", "away"]


def stable_int_from_uuid(uuid_str: str | None) -> int:
    """Map a Postgres uuid string to a stable, positive 63-bit int.

    The schemas use `int` for team identifiers; Supabase stores uuids. We hash
    deterministically so the same team always maps to the same int across runs.
    """
    if not uuid_str:
        return 0
    digest = hashlib.sha256(uuid_str.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") & 0x7FFFFFFFFFFFFFFF


def _coerce_event_type(raw: Any) -> str | None:
    if raw is None:
        return None
    value = str(raw).lower()
    return value if value in _VALID_EVENT_TYPES else None


def _coerce_int_timestamp(raw: Any) -> int:
    if raw is None:
        return 0
    if isinstance(raw, int):
        return raw
    try:
        return int(str(raw))
    except (ValueError, TypeError):
        return 0


def _player_rows_to_metadata(rows: Iterable[dict[str, Any]]) -> list[PlayerMetadata]:
    metadata: list[PlayerMetadata] = []
    for row in rows:
        side = row.get("team_side")
        if side not in ("home", "away"):
            continue
        metadata.append(
            PlayerMetadata(
                id=int(row["id"]),
                name=row.get("name") or "Unknown",
                team_side=side,
                position=row.get("position"),
            )
        )
    return metadata


def _passes_to_events(rows: Iterable[dict[str, Any]], match_id: int) -> list[ScrapedEvent]:
    events: list[ScrapedEvent] = []
    for row in rows:
        events.append(
            ScrapedEvent(
                match_id=match_id,
                player_id=row.get("player_id"),
                event_type="pass",
                # `passes` has no in-match timestamp column; the math layer never
                # uses it for xT, so 0 is a safe sentinel.
                timestamp=0,
                start_x=row.get("x_start"),
                start_y=row.get("y_start"),
                end_x=row.get("x_end"),
                end_y=row.get("y_end"),
                is_success=bool(row.get("outcome", True)),
            )
        )
    return events


def _match_events_to_events(
    rows: Iterable[dict[str, Any]], match_id: int
) -> list[ScrapedEvent]:
    events: list[ScrapedEvent] = []
    for row in rows:
        event_type = _coerce_event_type(row.get("event_type"))
        if event_type is None:
            continue
        events.append(
            ScrapedEvent(
                match_id=match_id,
                player_id=row.get("player_id"),
                event_type=event_type,
                timestamp=_coerce_int_timestamp(row.get("timestamp")),
                start_x=row.get("start_x"),
                start_y=row.get("start_y"),
                end_x=row.get("end_x"),
                end_y=row.get("end_y"),
                is_success=bool(row.get("is_success", True)),
            )
        )
    return events


def _resolve_opponent(
    match: dict[str, Any],
    players: list[dict[str, Any]],
    opponent_team_side: TeamSide,
) -> tuple[int, str]:
    """Pick the opponent team's stable_int id and the human-readable name.

    `RawScrapedBundle.opponent_id` is a fixed `int`, but Supabase keys teams by
    uuid. We hash the opponent's `team_id` uuid into a stable int. Falls back to
    `match_id`-derived sentinel if no team_id is available.
    """
    opponent_players = [p for p in players if p.get("team_side") == opponent_team_side]
    if not opponent_players:
        raise ValueError(
            f"No players found on the '{opponent_team_side}' side for match "
            f"{match.get('id')} — cannot determine opponent."
        )

    team_uuid = next((p.get("team_id") for p in opponent_players if p.get("team_id")), None)
    opponent_id = stable_int_from_uuid(team_uuid) if team_uuid else int(match["id"])

    name_field = "home_team" if opponent_team_side == "home" else "away_team"
    opponent_name = match.get(name_field) or f"Team-{opponent_id}"
    return opponent_id, opponent_name


def build_raw_bundle(
    match_id: int,
    *,
    opponent_team_side: TeamSide = "away",
    client: SupabaseClient | None = None,
) -> RawScrapedBundle:
    """Pull match + players + passes + match_events from Supabase, join into
    a single `RawScrapedBundle` ready for the ingestion agent.

    `opponent_team_side` defaults to `"away"` — flip to `"home"` when our
    reference team played away. Caller's responsibility (the orchestrator
    determines this from match metadata).
    """
    match = fetch_match(match_id, client=client)
    if match is None:
        raise ValueError(f"No match row found for match_id={match_id}.")

    player_rows = fetch_players(match_id, client=client)
    pass_rows = fetch_passes(match_id, client=client)
    event_rows = fetch_match_events(match_id, client=client)

    opponent_id, opponent_name = _resolve_opponent(match, player_rows, opponent_team_side)

    match_date_raw = match.get("match_date") or ""
    # PostgREST returns ISO-8601 timestamps; keep just the date portion for the
    # bundle metadata. Empty string is acceptable per IngestionMetadata.
    match_date = match_date_raw.split("T", 1)[0] if isinstance(match_date_raw, str) else ""

    matches = [
        MatchMetadata(
            match_id=int(match["id"]),
            date=match_date,
            home_team=match.get("home_team") or "",
            away_team=match.get("away_team") or "",
            tournament=match.get("tournament_name") or "",
        )
    ]

    players = _player_rows_to_metadata(player_rows)

    events = _passes_to_events(pass_rows, match_id)
    events.extend(_match_events_to_events(event_rows, match_id))

    return RawScrapedBundle(
        opponent_id=opponent_id,
        opponent_name=opponent_name,
        match_window=(match_date, match_date),
        matches=matches,
        players=players,
        events=events,
    )
