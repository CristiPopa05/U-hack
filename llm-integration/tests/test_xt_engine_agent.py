import os
import pytest
from src.schemas.xt_engine import XTEngineInput, RankedThreatList
from src.agents.xt_engine import run_xt_engine

FIXTURE = "tests/fixtures/xt_engine_input_minimal.json"


@pytest.mark.skipif(
    not os.environ.get("GEMINI_API_KEY") and not os.environ.get("GOOGLE_GENAI_USE_VERTEXAI"),
    reason="No Gemini credentials in env; smoke test requires a live API call.",
)
def test_xt_engine_agent_smoke():
    with open(FIXTURE) as f:
        payload = XTEngineInput.model_validate_json(f.read())

    result = run_xt_engine(payload)

    assert isinstance(result, RankedThreatList)

    danger_creators = [p for p in result.ranked_players if p.is_danger_creator]
    assert len(danger_creators) == 1
    assert danger_creators[0].rank == 1
    assert result.danger_creator_id == danger_creators[0].player_id

    ranks = sorted(p.rank for p in result.ranked_players)
    assert ranks == list(range(1, len(ranks) + 1))

    input_xt_by_id = {a.player_id: a.cumulative_xt for a in payload.aggregates}
    for entry in result.ranked_players:
        assert entry.player_id in input_xt_by_id
        assert entry.cumulative_xt == input_xt_by_id[entry.player_id], \
            f"cumulative_xt drifted for player {entry.player_id}"

    for entry in result.ranked_players:
        assert entry.reasoning.strip()
        assert any(ch.isdigit() for ch in entry.reasoning), \
            f"reasoning for player {entry.player_id} cites no numbers"

    assert len(result.secondary_targets) <= 2
    assert result.danger_creator_id not in result.secondary_targets
