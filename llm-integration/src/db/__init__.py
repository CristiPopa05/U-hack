"""Supabase reader package — fetches the rows the LLM pipeline consumes.

The cloud function (`calculateTxPerPas`) populates `passes.xt` and the
`spatial_analysis` table; this package only *reads*. No writes belong here.
"""
from src.db.supabase_client import (
    SupabaseClient,
    fetch_match,
    fetch_match_events,
    fetch_passes,
    fetch_players,
    fetch_spatial_analysis,
    get_default_client,
)
from src.db.bundle import build_raw_bundle

__all__ = [
    "SupabaseClient",
    "fetch_match",
    "fetch_match_events",
    "fetch_passes",
    "fetch_players",
    "fetch_spatial_analysis",
    "get_default_client",
    "build_raw_bundle",
]
