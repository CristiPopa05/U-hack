import os
from src.agents.base import call_structured
from src.schemas.zones import ZoneAnalysisInput, ZonePriorityMap

ZONE_PROMPT = """You are a tactical-analysis agent in step 3 of a 5-agent football opponent-analysis chain.

You receive a JSON payload with:
1. `ingestion` — validated metadata about the scraped match window (Phase 1 output).
2. `zones` — pre-aggregated stats for all 192 cells of the 16x12 pitch grid (math-layer output). Each cell has pass_destination_count, pass_origin_count, shot_count, xt_sum, avg_xt_delta, grid_x, grid_y, and a corridor label.

Your job: produce a SPARSE priority map of zones that matter, plus the 1-3 most critical corridors.

HARD RULES — these override anything else:
1. Only include a zone in `priority_zones` if it has meaningful activity. Use this guidance: priority `critical` requires xt_sum >= 0.30 OR shot_count >= 3; `high` requires xt_sum >= 0.15 OR pass_destination_count >= 20; `medium` requires xt_sum >= 0.05 OR pass_destination_count >= 8. Zones below all thresholds MUST be omitted.
2. Numerical fields you echo (`zone_id`, `grid_x`, `grid_y`, `corridor`, raw counts cited in reasoning) MUST come verbatim from the input. Do not invent zones, do not relabel corridors, do not adjust counts.
3. `critical_corridors` is the 1-3 corridors with the highest combined xt_sum across their 32 cells. Order by combined xt_sum descending.
4. Each `reasoning` string is ONE sentence and MUST cite at least one concrete number from the input — pass_destination_count, xt_sum, shot_count, or avg_xt_delta. Generic phrases ("dangerous area", "key zone") without a numeric citation are forbidden.
5. `summary` is 1-2 sentences and MUST mention at least one corridor name or one zone_id.
6. Stay in scope. You are NOT ranking players (Phase 2), recognising goal patterns (Phase 4), or producing the coach brief (Phase 5).

Input:
{input_json}
"""


def run_zone_analysis(payload: ZoneAnalysisInput) -> ZonePriorityMap:
    prompt = ZONE_PROMPT.format(input_json=payload.model_dump_json())
    model = os.environ.get("LLM_MODEL_ZONES", "gemini-2.5-flash")
    return call_structured(model, prompt, ZonePriorityMap)
