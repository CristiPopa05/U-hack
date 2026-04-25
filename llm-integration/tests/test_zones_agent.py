import os
import pytest
from src.schemas.zones import ZoneAnalysisInput, ZonePriorityMap
from src.agents.zones import run_zone_analysis

FIXTURE = "tests/fixtures/zones_input_minimal.json"


@pytest.mark.skipif(
    not os.environ.get("GEMINI_API_KEY") and not os.environ.get("GOOGLE_GENAI_USE_VERTEXAI"),
    reason="No Gemini credentials in env.",
)
def test_zones_agent_smoke():
    with open(FIXTURE) as f:
        payload = ZoneAnalysisInput.model_validate_json(f.read())

    result = run_zone_analysis(payload)

    assert isinstance(result, ZonePriorityMap)

    assert 3 <= len(result.priority_zones) <= 30

    assert 1 <= len(result.critical_corridors) <= 3

    input_by_id = {z.zone_id: z for z in payload.zones.aggregates}
    for entry in result.priority_zones:
        src = input_by_id.get(entry.zone_id)
        assert src is not None, f"unknown zone_id {entry.zone_id}"
        assert entry.grid_x == src.grid_x
        assert entry.grid_y == src.grid_y
        assert entry.corridor == src.corridor

    for entry in result.priority_zones:
        assert any(ch.isdigit() for ch in entry.reasoning)
    corridors = {"left_wing", "left_halfspace", "central", "right_halfspace", "right_wing"}
    summary_low = result.summary.lower()
    assert any(c in summary_low for c in corridors) or any(ch.isdigit() for ch in result.summary)
