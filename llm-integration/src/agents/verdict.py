import os
from src.agents.base import call_structured
from src.schemas.verdict import TacticalVerdictInput, CoachBrief

VERDICT_PROMPT = """You are the FINAL agent in a 5-agent football opponent-analysis chain. Your output is shown directly to the coaching staff. Every other agent in the chain exists to give you grounded numerical evidence.

You receive a JSON payload with:
1. `ingestion` — Phase 1 metadata about the scraped match window.
2. `threats` — Phase 2 ranked-threat list with the danger_creator and secondary targets.
3. `zones` — Phase 3 sparse zone priority map and critical corridors.
4. `pattern` — Phase 4 build-up pattern with a confidence score.
5. `pitch_control` — math-layer summary of defensive vulnerabilities (zones where the opponent controls space we do not).

Your job: produce ONE coach-readable brief — a headline, a short summary, 3 to 6 ranked defensive instructions, and a compact UI schema.

HARD RULES — these override anything else:
1. `ui_schema` fields MUST be echoed verbatim from the upstream inputs:
   - `danger_creator_id` = `threats.danger_creator_id`
   - `secondary_target_ids` = `threats.secondary_targets`
   - `critical_corridors` = `zones.critical_corridors`
   - `pattern_signature` = `pattern.pattern_signature`
   - `pattern_confidence` = `pattern.confidence`
   - `critical_zone_ids` = the `zone_id` of every `zones.priority_zones` entry whose `priority` equals `"critical"`.
   Do not invent, reorder, or rename.
2. `headline` is ONE sentence and MUST cite at least one concrete number (xT, percentage, count, or zone_id).
3. `summary` is 3-5 sentences and MUST cite at least one player name from `threats.ranked_players` AND at least one zone_id from `zones.priority_zones` or `pitch_control.alerts`.
4. `instructions` contains 3 to 6 entries, ordered by `severity` descending using this order: `critical` > `high` > `medium` > `info`. Each entry's `body` is 2-4 sentences and MUST cite at least one digit AND at least one player name OR zone_id from the input.
5. Every `target_player_id` MUST be a `player_id` that appears in `threats.ranked_players`. Every `target_zone_ids` entry MUST appear in `zones.priority_zones` or `pitch_control.alerts`. Do not invent.
6. NO generic football clichés. Phrases like "the key man", "playmaker", "high press", "stay compact", "track runners" are forbidden UNLESS the same sentence cites a specific number, player_name, or zone_id from the input.
7. `confidence` is in [0, 1]. If `pattern.confidence < 0.5`, your `confidence` MUST be strictly less than 0.7 — propagate uncertainty, do not paper over it.
8. You are NOT producing additional player rankings, additional zone classifications, or new build-up patterns. You synthesise; you do not re-detect.

Input:
{input_json}
"""


def run_tactical_verdict(payload: TacticalVerdictInput) -> CoachBrief:
    prompt = VERDICT_PROMPT.format(input_json=payload.model_dump_json())
    model = os.environ.get("LLM_MODEL_VERDICT", "gemini-2.5-flash")
    return call_structured(model, prompt, CoachBrief)
