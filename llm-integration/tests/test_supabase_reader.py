"""Phase 2 verification.

Two layers:
  * **Offline** — stub the Supabase client (or its httpx transport) and verify
    `build_raw_bundle` joins rows into a valid `RawScrapedBundle`. Always runs.
  * **Live** — hit the real Supabase project; skipped if `SUPABASE_URL` /
    `SUPABASE_SERVICE_ROLE_KEY` are absent or the configured `match_id` is
    not yet seeded.
"""
from __future__ import annotations

import json
import os
from typing import Any

import httpx
import pytest

from src.db.bundle import build_raw_bundle, stable_int_from_uuid
from src.db.supabase_client import SupabaseClient, SupabaseConfigError
from src.schemas.ingestion import RawScrapedBundle


# ---------- helpers ----------

class _StubClient:
    """Duck-typed stand-in for `SupabaseClient`. Returns fixture rows verbatim."""

    def __init__(
        self,
        match: dict[str, Any] | None,
        players: list[dict[str, Any]],
        passes: list[dict[str, Any]],
        match_events: list[dict[str, Any]],
        spatial: list[dict[str, Any]] | None = None,
    ) -> None:
        self._match = match
        self._players = players
        self._passes = passes
        self._match_events = match_events
        self._spatial = spatial or []

    def fetch_match(self, match_id: int):
        return self._match

    def fetch_players(self, match_id: int):
        return self._players

    def fetch_passes(self, match_id: int):
        return self._passes

    def fetch_match_events(self, match_id: int):
        return self._match_events

    def fetch_spatial_analysis(self, match_id: int):
        return self._spatial


# ---------- offline tests: client (httpx.MockTransport) ----------

def test_supabase_client_requires_credentials(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    with pytest.raises(SupabaseConfigError):
        SupabaseClient()


def test_supabase_client_fetch_match_uses_eq_filter():
    """The PostgREST request is shaped correctly: eq.<id>, limit=1, headers set."""
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        return httpx.Response(
            200,
            json=[
                {
                    "id": 3001,
                    "tournament_name": "SuperLiga",
                    "home_team": "U Cluj",
                    "away_team": "FCSB",
                    "match_date": "2026-03-22T18:00:00+00:00",
                }
            ],
        )

    transport = httpx.MockTransport(handler)
    http_client = httpx.Client(transport=transport)
    client = SupabaseClient(
        url="https://example.supabase.co",
        api_key="test-secret",
        client=http_client,
    )

    match = client.fetch_match(3001)
    assert match is not None
    assert match["away_team"] == "FCSB"

    url = captured["url"]
    assert url.startswith("https://example.supabase.co/rest/v1/matches")
    assert "id=eq.3001" in url
    assert "limit=1" in url
    assert captured["headers"]["apikey"] == "test-secret"
    assert captured["headers"]["authorization"] == "Bearer test-secret"


def test_supabase_client_paginates_passes():
    """When a page returns exactly `page_size` rows, the client requests the next."""
    requested_offsets: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        offset = request.url.params.get("offset", "0")
        requested_offsets.append(offset)
        # First page: full 1000 rows; second page: 1 row → terminates.
        if offset == "0":
            rows = [{"id": str(i), "match_id": 3001} for i in range(1000)]
        else:
            rows = [{"id": "9999", "match_id": 3001}]
        return httpx.Response(200, json=rows)

    transport = httpx.MockTransport(handler)
    client = SupabaseClient(
        url="https://example.supabase.co",
        api_key="test-secret",
        client=httpx.Client(transport=transport),
    )

    rows = client.fetch_passes(3001)
    assert len(rows) == 1001
    assert requested_offsets == ["0", "1000"]


# ---------- offline tests: build_raw_bundle ----------

@pytest.fixture
def stub_match() -> dict[str, Any]:
    return {
        "id": 3001,
        "tournament_name": "SuperLiga",
        "home_team": "U Cluj",
        "away_team": "FCSB",
        "match_date": "2026-03-22T18:00:00+00:00",
        "tactical_verdict": None,
    }


@pytest.fixture
def stub_players() -> list[dict[str, Any]]:
    return [
        {
            "id": 30011001,
            "match_id": 3001,
            "name": "Home Player",
            "team_side": "home",
            "position": "F",
            "team_id": "11111111-1111-1111-1111-111111111111",
        },
        {
            "id": 30019001,
            "match_id": 3001,
            "name": "Marian Crisan",
            "team_side": "away",
            "position": "AM",
            "team_id": "22222222-2222-2222-2222-222222222222",
        },
        {
            "id": 30019002,
            "match_id": 3001,
            "name": "Ovidiu Hoban",
            "team_side": "away",
            "position": "DM",
            "team_id": "22222222-2222-2222-2222-222222222222",
        },
    ]


@pytest.fixture
def stub_passes() -> list[dict[str, Any]]:
    return [
        {
            "id": "p1",
            "player_id": 30019001,
            "x_start": 60.0,
            "y_start": 50.0,
            "x_end": 80.0,
            "y_end": 50.0,
            "outcome": True,
            "is_assist": False,
            "match_id": 3001,
            "xt": 0.04,
        },
        {
            "id": "p2",
            "player_id": 30011001,
            "x_start": 30.0,
            "y_start": 40.0,
            "x_end": 50.0,
            "y_end": 40.0,
            "outcome": False,
            "is_assist": False,
            "match_id": 3001,
            "xt": 0.0,
        },
    ]


@pytest.fixture
def stub_match_events() -> list[dict[str, Any]]:
    return [
        {
            "id": 1,
            "match_id": 3001,
            "player_id": 30019001,
            "event_type": "shot",
            "start_x": 92.0,
            "start_y": 50.0,
            "end_x": 100.0,
            "end_y": 50.0,
            "is_success": True,
            "xt_value": 0.0,
            "timestamp": 2700,
        },
        {
            "id": 2,
            "match_id": 3001,
            "player_id": 30019001,
            "event_type": "goal",
            "start_x": 95.0,
            "start_y": 50.0,
            "end_x": 100.0,
            "end_y": 50.0,
            "is_success": True,
            "xt_value": 0.0,
            "timestamp": 2705,
        },
        {
            # Unknown event type — must be silently dropped, not crash.
            "id": 3,
            "match_id": 3001,
            "player_id": 30019002,
            "event_type": "interception",
            "start_x": 40.0,
            "start_y": 50.0,
            "end_x": None,
            "end_y": None,
            "is_success": True,
            "xt_value": 0.0,
            "timestamp": 1800,
        },
    ]


def test_build_raw_bundle_joins_rows_into_valid_schema(
    stub_match, stub_players, stub_passes, stub_match_events,
):
    client = _StubClient(stub_match, stub_players, stub_passes, stub_match_events)
    bundle = build_raw_bundle(3001, client=client)

    assert isinstance(bundle, RawScrapedBundle)
    assert bundle.opponent_name == "FCSB"
    # Stable int hash from team uuid — non-zero, deterministic across runs.
    assert bundle.opponent_id == stable_int_from_uuid(
        "22222222-2222-2222-2222-222222222222"
    )
    assert bundle.opponent_id > 0
    assert bundle.match_window == ("2026-03-22", "2026-03-22")
    assert bundle.matches[0].home_team == "U Cluj"
    assert {p.team_side for p in bundle.players} == {"home", "away"}

    # 2 passes + 2 valid match_events (shot + goal); the "interception" row was dropped.
    assert len(bundle.events) == 4
    types = sorted(e.event_type for e in bundle.events)
    assert types == ["goal", "pass", "pass", "shot"]

    # Pass rows got timestamp=0 sentinel, match_events kept their real timestamps.
    pass_events = [e for e in bundle.events if e.event_type == "pass"]
    assert all(e.timestamp == 0 for e in pass_events)
    shot = next(e for e in bundle.events if e.event_type == "shot")
    assert shot.timestamp == 2700


def test_build_raw_bundle_supports_home_opponent(
    stub_match, stub_players, stub_passes, stub_match_events,
):
    """When our team plays away, the opponent is on the home side."""
    client = _StubClient(stub_match, stub_players, stub_passes, stub_match_events)
    bundle = build_raw_bundle(3001, opponent_team_side="home", client=client)
    assert bundle.opponent_name == "U Cluj"
    assert bundle.opponent_id == stable_int_from_uuid(
        "11111111-1111-1111-1111-111111111111"
    )


def test_build_raw_bundle_raises_on_missing_match():
    client = _StubClient(None, [], [], [])
    with pytest.raises(ValueError, match="No match row"):
        build_raw_bundle(9999, client=client)


def test_build_raw_bundle_raises_on_missing_opponent_side(stub_match, stub_passes, stub_match_events):
    home_only = [
        {
            "id": 30011001,
            "match_id": 3001,
            "name": "Home Player",
            "team_side": "home",
            "position": "F",
            "team_id": "11111111-1111-1111-1111-111111111111",
        }
    ]
    client = _StubClient(stub_match, home_only, stub_passes, stub_match_events)
    with pytest.raises(ValueError, match="No players"):
        build_raw_bundle(3001, opponent_team_side="away", client=client)


def test_stable_int_from_uuid_is_deterministic_and_positive():
    a = stable_int_from_uuid("22222222-2222-2222-2222-222222222222")
    b = stable_int_from_uuid("22222222-2222-2222-2222-222222222222")
    assert a == b > 0
    assert stable_int_from_uuid(None) == 0


# ---------- live test (skipped without credentials) ----------

LIVE_MATCH_ID_ENV = "SUPABASE_TEST_MATCH_ID"


@pytest.mark.skipif(
    not (
        os.environ.get("SUPABASE_URL")
        and os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        and os.environ.get(LIVE_MATCH_ID_ENV)
    ),
    reason=(
        "Live Supabase test — requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, "
        f"and {LIVE_MATCH_ID_ENV} (a real match_id seeded by the cloud function)."
    ),
)
def test_live_supabase_reader_full_bundle():
    match_id = int(os.environ[LIVE_MATCH_ID_ENV])
    with SupabaseClient() as client:
        bundle = build_raw_bundle(match_id, client=client)
        spatial = client.fetch_spatial_analysis(match_id)

    assert bundle.matches[0].match_id == match_id
    assert bundle.players, "no players returned for live match"
    assert bundle.events, "no events returned for live match"
    # Spatial analysis must include at least one TEAM and one PLAYER row once
    # the cloud function has run.
    types = {row.get("type") for row in spatial}
    assert "TEAM" in types and "PLAYER" in types, (
        f"spatial_analysis incomplete for match {match_id}: row types = {types}. "
        "Has the cloud function POST been triggered?"
    )

    # Round-trip the bundle through JSON to catch any non-serializable values.
    serialized = bundle.model_dump_json()
    rebuilt = RawScrapedBundle.model_validate(json.loads(serialized))
    assert rebuilt.opponent_id == bundle.opponent_id
