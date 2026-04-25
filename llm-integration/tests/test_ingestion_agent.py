import os
import pytest
from src.schemas.ingestion import RawScrapedBundle, IngestionMetadata
from src.agents.ingestion import run_ingestion

FIXTURE = "tests/fixtures/ingestion_bundle_minimal.json"


@pytest.mark.skipif(
    not os.environ.get("GEMINI_API_KEY") and not os.environ.get("GOOGLE_GENAI_USE_VERTEXAI"),
    reason="No Gemini credentials in env; smoke test requires a live API call.",
)
def test_ingestion_agent_smoke():
    with open(FIXTURE) as f:
        bundle = RawScrapedBundle.model_validate_json(f.read())

    result = run_ingestion(bundle)

    assert isinstance(result, IngestionMetadata)
    assert result.total_events == len(bundle.events)
    breakdown = result.event_type_breakdown
    assert sum(breakdown.model_dump(by_alias=True).values()) == result.total_events
    assert len(result.warnings) > 0
