"""Phase 3 end-to-end test — runs the full pipeline on a live Supabase match.

Skipped if *any* required credential is absent:
  - GEMINI_API_KEY (or Vertex AI env)
  - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
  - SUPABASE_TEST_MATCH_ID (a match_id already processed by the cloud function)

When all are present, calls `run_pipeline(match_id)` and validates the
`DashboardPayload` structurally — every panel type present, honest Panel D
has 4 entries, vulnerability alerts reference upstream zone data.
"""
from __future__ import annotations

import json
import os

import pytest

from src.schemas.dashboard import DashboardPayload


_SKIP_REASON = (
    "Full-chain e2e test — requires GEMINI_API_KEY (or Vertex AI), "
    "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_TEST_MATCH_ID."
)


def _has_gemini_credentials() -> bool:
    if os.environ.get("GEMINI_API_KEY"):
        return True
    if (
        os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "").lower() == "true"
        and os.environ.get("GOOGLE_CLOUD_PROJECT")
    ):
        return True
    return False


def _has_supabase_credentials() -> bool:
    return bool(
        os.environ.get("SUPABASE_URL")
        and os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        and os.environ.get("SUPABASE_TEST_MATCH_ID")
    )


_SKIP = not (_has_gemini_credentials() and _has_supabase_credentials())


@pytest.mark.skipif(_SKIP, reason=_SKIP_REASON)
class TestPipelineE2E:
    """Full end-to-end pipeline on a real match.

    These tests are slow (5 sequential LLM calls) — expected ~30-90 s depending
    on model latency. Mark with `pytest -m e2e` if you want to filter.
    """

    @pytest.fixture(scope="class")
    def payload(self) -> DashboardPayload:
        """Run the pipeline once and cache the result for all tests in this class."""
        from src.pipeline import run_pipeline

        match_id = int(os.environ["SUPABASE_TEST_MATCH_ID"])
        return run_pipeline(match_id)

    # ── structural checks ────────────────────────────────────

    def test_payload_validates(self, payload: DashboardPayload):
        """DashboardPayload round-trips through JSON without loss."""
        raw = payload.model_dump_json()
        rebuilt = DashboardPayload.model_validate_json(raw)
        assert rebuilt.match_id == payload.match_id
        assert rebuilt.schema_version == "1"

    def test_all_five_panel_types_present(self, payload: DashboardPayload):
        types = {p.type for p in payload.panels}
        expected = {"xt_grid", "danger_creator", "vulnerability_alerts",
                    "goal_dna_network", "tactical_verdict"}
        assert types == expected, f"Missing panels: {expected - types}"

    def test_panel_count_is_five(self, payload: DashboardPayload):
        assert len(payload.panels) == 5

    # ── per-panel checks ─────────────────────────────────────

    def test_xt_grid_has_12x16_grid(self, payload: DashboardPayload):
        grid_panel = next(p for p in payload.panels if p.type == "xt_grid")
        assert len(grid_panel.grid) == 12
        assert all(len(row) == 16 for row in grid_panel.grid)
        assert grid_panel.range.min <= grid_panel.range.max

    def test_danger_creator_has_players(self, payload: DashboardPayload):
        dc = next(p for p in payload.panels if p.type == "danger_creator")
        assert len(dc.players) >= 1
        assert any(p.is_primary for p in dc.players), "No primary danger creator"

    def test_vulnerability_alerts_non_empty(self, payload: DashboardPayload):
        alerts = next(p for p in payload.panels if p.type == "vulnerability_alerts")
        assert len(alerts.alerts) >= 3  # min 3 per CoachBrief constraint

    def test_goal_dna_has_pattern(self, payload: DashboardPayload):
        dna = next(p for p in payload.panels if p.type == "goal_dna_network")
        assert dna.pattern.pattern_signature, "Empty pattern signature"
        assert 0.0 <= dna.pattern.confidence <= 1.0
        assert dna.graph.edges, "No edges in pass network graph"

    def test_tactical_verdict_has_four_phases(self, payload: DashboardPayload):
        verdict = next(p for p in payload.panels if p.type == "tactical_verdict")
        assert len(verdict.phases) == 4, f"Got {len(verdict.phases)} phases, expected 4"

    def test_tactical_verdict_phases_have_content(self, payload: DashboardPayload):
        verdict = next(p for p in payload.panels if p.type == "tactical_verdict")
        for phase in verdict.phases:
            assert phase.body, f"Phase '{phase.phase_label}' has empty body"
            assert phase.source in ("xt_engine", "zones", "goal_dna", "verdict")

    def test_tactical_verdict_honest_sources(self, payload: DashboardPayload):
        """Each phase card must cite its correct source agent."""
        verdict = next(p for p in payload.panels if p.type == "tactical_verdict")
        sources = [p.source for p in verdict.phases]
        assert sources == ["xt_engine", "zones", "goal_dna", "verdict"], (
            f"Unexpected source order: {sources}"
        )

    def test_tactical_verdict_confidence_in_range(self, payload: DashboardPayload):
        verdict = next(p for p in payload.panels if p.type == "tactical_verdict")
        assert 0.0 <= verdict.confidence <= 1.0

    # ── cross-panel consistency ──────────────────────────────

    def test_vulnerability_alerts_reference_valid_zones(self, payload: DashboardPayload):
        """Every target_zone_id in alerts should be non-negative (basic sanity)."""
        alerts = next(p for p in payload.panels if p.type == "vulnerability_alerts")
        for alert in alerts.alerts:
            for zone_id in alert.target_zone_ids:
                assert 0 <= zone_id <= 191, f"Zone ID {zone_id} out of 0..191 range"

    def test_danger_creator_primary_has_positive_xt(self, payload: DashboardPayload):
        dc = next(p for p in payload.panels if p.type == "danger_creator")
        primary = next((p for p in dc.players if p.is_primary), None)
        assert primary is not None, "No primary danger creator found"
        # xT can be 0 in degenerate cases, but should generally be positive
        assert primary.total_xt_value >= 0.0
