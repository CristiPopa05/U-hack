import os, pytest
from src.schemas.verdict import TacticalVerdictInput, CoachBrief
from src.agents.verdict import run_tactical_verdict

FIXTURE = "tests/fixtures/verdict_input_minimal.json"
SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "info": 3}


@pytest.mark.skipif(
    not os.environ.get("GEMINI_API_KEY") and not os.environ.get("GOOGLE_GENAI_USE_VERTEXAI"),
    reason="No Gemini credentials in env.",
)
def test_verdict_agent_smoke():
    with open(FIXTURE) as f:
        payload = TacticalVerdictInput.model_validate_json(f.read())

    result = run_tactical_verdict(payload)
    assert isinstance(result, CoachBrief)

    # ui_schema verbatim-echo invariants.
    ui = result.ui_schema
    assert ui.danger_creator_id == payload.threats.danger_creator_id
    assert ui.secondary_target_ids == payload.threats.secondary_targets
    assert ui.critical_corridors == payload.zones.critical_corridors
    assert ui.pattern_signature == payload.pattern.pattern_signature
    assert ui.pattern_confidence == payload.pattern.confidence
    expected_critical = [z.zone_id for z in payload.zones.priority_zones if z.priority == "critical"]
    assert sorted(ui.critical_zone_ids) == sorted(expected_critical)

    # Instructions count and severity ordering.
    assert 3 <= len(result.instructions) <= 6
    sevs = [SEVERITY_ORDER[i.severity] for i in result.instructions]
    assert sevs == sorted(sevs), "instructions not sorted severity-descending"

    # Headline cites a digit; summary cites a digit and a known player name.
    assert any(ch.isdigit() for ch in result.headline)
    assert any(ch.isdigit() for ch in result.summary)
    known_names = {p.player_name for p in payload.threats.ranked_players}
    assert any(name in result.summary for name in known_names)

    # No fabricated targets in instructions.
    valid_player_ids = {p.player_id for p in payload.threats.ranked_players}
    valid_zone_ids = {z.zone_id for z in payload.zones.priority_zones} | {a.zone_id for a in payload.pitch_control.alerts}
    for ins in result.instructions:
        if ins.target_player_id is not None:
            assert ins.target_player_id in valid_player_ids
        for z in ins.target_zone_ids:
            assert z in valid_zone_ids
        assert any(ch.isdigit() for ch in ins.body)

    # Confidence propagation: pattern.confidence is 0.72 in the fixture, so the < 0.7 cap does NOT apply.
    assert 0.0 <= result.confidence <= 1.0
