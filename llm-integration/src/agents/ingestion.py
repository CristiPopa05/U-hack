import os
from src.agents.base import call_structured
from src.schemas.ingestion import RawScrapedBundle, IngestionMetadata

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


def run_ingestion(bundle: RawScrapedBundle) -> IngestionMetadata:
    """Phase 1 entrypoint. Pure function: bundle in, metadata out."""
    prompt = INGESTION_PROMPT.format(bundle_json=bundle.model_dump_json())
    model = os.environ.get("LLM_MODEL_INGESTION", "gemini-2.5-flash")
    return call_structured(model, prompt, IngestionMetadata)
