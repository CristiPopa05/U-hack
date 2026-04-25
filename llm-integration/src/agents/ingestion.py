import os
from collections import Counter
from src.agents.base import call_structured
from src.schemas.ingestion import RawScrapedBundle, IngestionMetadata, EventTypeBreakdown

INGESTION_PROMPT = """You are a sports-data validation agent in a football tactical-analysis pipeline.

You will receive a JSON bundle of scraped event data for a single opposing team across a specified match window. Your role is the FIRST step in a 5-agent chain. Downstream agents will rank player threat, analyse zones, recognise goal patterns, and produce a tactical verdict — but only if your output is trustworthy.

Your job: inspect the bundle and return a structured metadata summary describing exactly what is present.

HARD RULES — these override anything else:
1. Do NOT invent matches, players, or events. If a field is missing in the input, say so in `warnings` and set the relevant completeness flag to false. Never fabricate data to fill a gap.
2. Counts must be derived from the input. `total_events` must equal the length of the events array. `event_type_breakdown` keys must come only from event types actually present.
3. `appearance_count` for a player is the number of distinct match_ids where that player_id appears in events — not a guess.
4. A match is `is_complete = true` only if ALL of: event_count >= 200, the player lineup for that match is non-empty, and at least 90% of pass events have non-null start/end coordinates.
5. `missing_match_ids` lists match IDs the request asked for but that are absent from `bundle.matches`. If the request did not enumerate IDs, leave this empty.
6. Warnings are short, factual strings — e.g. "match 12345 has only 87 events; below 200 threshold". No coaching advice, no clichés.

You are NOT analysing tactics. You are validating data shape. Stay in scope.

Bundle:
{bundle_json}
"""


def run_ingestion(bundle: RawScrapedBundle, max_retries: int = 3) -> IngestionMetadata:
    """Phase 1 entrypoint. Pure function: bundle in, metadata out."""
    prompt = INGESTION_PROMPT.format(bundle_json=bundle.model_dump_json())
    model = os.environ.get("LLM_MODEL_INGESTION", "gemini-2.5-flash")

    # Retry on transient LLM failures (e.g. invalid JSON, out-of-range numbers)
    last_error = None
    for attempt in range(max_retries):
        try:
            result = call_structured(model, prompt, IngestionMetadata)
            break
        except Exception as e:
            last_error = e
            if attempt == max_retries - 1:
                raise last_error

    # --- Post-processing: override deterministic counts with exact values ---
    # LLMs are unreliable at counting items in lists; code does this perfectly.
    result.total_events = len(bundle.events)

    type_counts = Counter(e.event_type for e in bundle.events)
    result.event_type_breakdown = EventTypeBreakdown(
        pass_count=type_counts.get("pass", 0),
        shot=type_counts.get("shot", 0),
        carry=type_counts.get("carry", 0),
        dribble=type_counts.get("dribble", 0),
        goal=type_counts.get("goal", 0),
    )

    # Fix per-match event_count
    match_event_counts = Counter(e.match_id for e in bundle.events)
    for ms in result.matches_covered:
        ms.event_count = match_event_counts.get(ms.match_id, 0)

    # Fix per-player appearance_count (distinct match_ids per player)
    player_matches: dict[int, set[int]] = {}
    for e in bundle.events:
        if e.player_id is not None:
            player_matches.setdefault(e.player_id, set()).add(e.match_id)
    for ps in result.players_present:
        ps.appearance_count = len(player_matches.get(ps.id, set()))

    return result
