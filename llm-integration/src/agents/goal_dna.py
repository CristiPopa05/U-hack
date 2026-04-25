import os
from src.agents.base import call_structured
from src.schemas.goal_dna import GoalDNAInput, BuildupPattern

GOAL_DNA_PROMPT = """You are a tactical-analysis agent in step 4 of a 5-agent football opponent-analysis chain.

You receive a JSON payload with:
1. `ingestion` — validated metadata about the scraped match window (Phase 1 output).
2. `graphs` — 1 to 5 pass-network graphs, each representing the 15-20 seconds of opponent possession before a scored goal. Players are nodes; passes are weighted edges with from/to zone IDs (0..191 in the 16x12 grid) and a timestamp_offset (negative = before the goal). If `is_synthesised` is True, the graph is a representative dangerous attack that did not end in a goal — used when the opponent scored zero goals in the window.

Your job: identify the SINGLE recurring build-up signature that best explains how this opponent scores, with a confidence score.

HARD RULES — these override anything else:
1. `pattern_signature` MUST be one of the allowed literal values. If no consistent pattern emerges across the graphs, use `mixed_inconclusive` — do not stretch a label to fit.
2. `confidence` is in [0, 1]. If ALL input graphs have `is_synthesised: true`, confidence MUST NOT exceed 0.4 — the result is a hypothesis, not an observed pattern. Set `is_based_on_synthesised_input: true` in this case.
3. Every `key_players[].player_id` MUST appear as either a from_player_id or to_player_id in at least one input edge. Do not invent players.
4. Every `starting_zones[]` and `finishing_zones[]` zone_id MUST appear as a from_zone_id or to_zone_id in at least one input edge. Do not invent zones.
5. `description` is 2-3 sentences and MUST cite at least one concrete zone_id AND at least one player name from the input. Generic phrases ("they build through the middle", "incisive passing") without numerical/named citation are forbidden.
6. `notes` are short factual strings — e.g., "pattern present in 4 of 5 goals", "single synthesised graph; low confidence". No coaching prescriptions.
7. Stay in scope. You are NOT ranking players (Phase 2), classifying zones (Phase 3), or producing the coach brief (Phase 5).

Input:
{input_json}
"""


def run_goal_dna(payload: GoalDNAInput) -> BuildupPattern:
    prompt = GOAL_DNA_PROMPT.format(input_json=payload.model_dump_json())
    model = os.environ.get("LLM_MODEL_GOAL_DNA", "gemini-2.5-flash")
    return call_structured(model, prompt, BuildupPattern)
