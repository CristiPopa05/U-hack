import os, pytest
from src.schemas.goal_dna import GoalDNAInput, BuildupPattern
from src.agents.goal_dna import run_goal_dna

FIXTURE = "tests/fixtures/goal_dna_input_minimal.json"

VALID_SIGNATURES = {
    "wide_overload_to_central_finish",
    "central_progression_through_halfspace",
    "fast_transition_counter",
    "set_piece_secondary",
    "deep_buildup_long_switch",
    "individual_dribble_initiated",
    "mixed_inconclusive",
}


@pytest.mark.skipif(
    not os.environ.get("GEMINI_API_KEY") and not os.environ.get("GOOGLE_GENAI_USE_VERTEXAI"),
    reason="No Gemini credentials in env.",
)
def test_goal_dna_agent_smoke():
    with open(FIXTURE) as f:
        payload = GoalDNAInput.model_validate_json(f.read())

    result = run_goal_dna(payload)
    assert isinstance(result, BuildupPattern)

    # Signature is one of the allowed literals.
    assert result.pattern_signature in VALID_SIGNATURES

    # Confidence in range. All inputs are real (not synthesised), so the synth cap doesn't apply.
    assert 0.0 <= result.confidence <= 1.0
    assert result.is_based_on_synthesised_input is False

    # Build a set of every (player_id, zone_id) that appears in any edge.
    valid_player_ids = set()
    valid_zone_ids = set()
    valid_names = set()
    for g in payload.graphs:
        for e in g.edges:
            valid_player_ids.update({e.from_player_id, e.to_player_id})
            valid_zone_ids.update({e.from_zone_id, e.to_zone_id})
            valid_names.update({e.from_player_name, e.to_player_name})

    # No fabricated players or zones.
    for kp in result.key_players:
        assert kp.player_id in valid_player_ids
    for z in result.starting_zones + result.finishing_zones:
        assert z in valid_zone_ids

    # Description cites at least one digit AND at least one player name from the input.
    assert any(ch.isdigit() for ch in result.description)
    assert any(name in result.description for name in valid_names)

    # key_players bounds.
    assert 2 <= len(result.key_players) <= 4
