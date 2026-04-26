"""Helper script to generate a fake demo cache when Gemini API is rate limited."""
import sys
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.schemas.dashboard import (
    DashboardPayload, XTGridPanel, DangerCreatorPanel, DangerCreatorEntry,
    VulnerabilityAlertsPanel, GoalDNAPanel, TacticalVerdictPanel, PhaseSummary, XTRange
)
from src.schemas.verdict import DefensiveInstruction
from src.schemas.goal_dna import PassNetworkGraph, BuildupPattern, PassEdge, KeyPlayer

def generate_fake_payload(match_id: int) -> DashboardPayload:
    # 1. XT Grid
    grid = [[(r+c)/280.0 for c in range(16)] for r in range(12)]
    xt_panel = XTGridPanel(
        title="Defensive xT Heatmap (Fake Data)",
        grid=grid,
        range=XTRange(min=0.0, max=0.1),
        max_xt_zone_id=100
    )

    # 2. Danger Creator
    dc_panel = DangerCreatorPanel(
        title="Danger Creator (Fake Data)",
        players=[
            DangerCreatorEntry(
                player_id=1, name="John Doe", position="AM", minutes=90,
                total_xt_value=1.5, max_xt_zone_id=100, passes=45, assists=2, is_primary=True
            ),
            DangerCreatorEntry(
                player_id=2, name="Jane Smith", position="RW", minutes=85,
                total_xt_value=1.2, max_xt_zone_id=101, passes=30, assists=1, is_primary=False
            )
        ],
        narrative="This is a fake narrative generated because the Gemini API is rate limited."
    )

    # 3. Vulnerability Alerts
    va_panel = VulnerabilityAlertsPanel(
        title="Vulnerability Alerts (Fake Data)",
        alerts=[
            DefensiveInstruction(
                severity="critical", title="Fake Alert 1", body="This is a fake critical alert.",
                target_zone_ids=[100, 101]
            ),
            DefensiveInstruction(
                severity="medium", title="Fake Alert 2", body="This is a fake warning alert.",
                target_zone_ids=[50]
            )
        ]
    )

    # 4. Goal DNA
    gd_panel = GoalDNAPanel(
        title="Goal DNA (Fake Data)",
        graph=PassNetworkGraph(
            match_id=match_id, goal_scorer_id=1, goal_timestamp=4500, duration_seconds=15.0,
            edges=[
                PassEdge(from_player_id=2, from_player_name="Jane Smith", to_player_id=1, to_player_name="John Doe",
                         from_zone_id=50, to_zone_id=100, timestamp_offset=5.0, weight=2)
            ],
            is_synthesised=False
        ),
        pattern=BuildupPattern(
            opponent_id=999, pattern_signature="wide_overload_to_central_finish", confidence=0.85,
            description="Fake pattern description.",
            key_players=[
                KeyPlayer(player_id=2, player_name="Jane Smith", role="originator"),
                KeyPlayer(player_id=1, player_name="John Doe", role="finisher")
            ],
            starting_zones=[50], finishing_zones=[100], is_based_on_synthesised_input=False, notes=["Fake note"]
        )
    )

    # 5. Tactical Verdict
    tv_panel = TacticalVerdictPanel(
        title="Tactical Verdict (Fake Data)",
        headline="Fake Headline",
        summary="Fake summary because Gemini API is rate limited.",
        confidence=0.9,
        phases=[
            PhaseSummary(phase_label="Phase 1", title="Ingestion", body="Fake ingestion body", source="xt_engine"),
            PhaseSummary(phase_label="Phase 2", title="xT Engine", body="Fake xT body", source="zones"),
            PhaseSummary(phase_label="Phase 3", title="Zones", body="Fake zones body", source="goal_dna"),
            PhaseSummary(phase_label="Phase 4", title="Verdict", body="Fake verdict body", source="verdict")
        ]
    )

    return DashboardPayload(
        match_id=match_id,
        generated_at=datetime.utcnow(),
        schema_version="1",
        opponent_id=999,
        panels=[xt_panel, dc_panel, va_panel, gd_panel, tv_panel]
    )

def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/generate_fake_cache.py <match_id>")
        sys.exit(1)

    match_id = int(sys.argv[1])
    cache_dir = Path(__file__).resolve().parent.parent / "cache"
    cache_dir.mkdir(exist_ok=True)
    out_file = cache_dir / f"demo_{match_id}.json"

    payload = generate_fake_payload(match_id)
    out_file.write_text(payload.model_dump_json(indent=2), encoding="utf-8")
    print(f"Wrote FAKE payload to {out_file}")

if __name__ == "__main__":
    main()
