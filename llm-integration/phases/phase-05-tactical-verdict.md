# Phase 05 — Tactical Verdict Agent

> **Strict task spec for Claude Code.** Execute in order. Do not start until **Phases 01–04 are complete** — the prior agents' schemas and tests must already exist and pass.

| Field | Value |
|---|---|
| **Phase** | 05 — final LLM agent phase. The only agent whose output is shown directly to the coach. |
| **Owner** | Member 3 (LLM Architecture) |
| **Companion files** | `llm-integration/overview.md`, phases 01–04, `PROJECT.md` §3 (Phase 4) + §4, `CLAUDE.md` |
| **LLM agent role** | Synthesise the outputs of Phases 02–04 plus a `PitchControlSummary` from the math layer into a coach-readable brief: one headline, a short narrative summary, 3–6 ranked defensive instructions, and a compact UI schema for the dashboard. |
| **Model** | `gemini-2.5-pro` (override via `LLM_MODEL_VERDICT`) — reasoning depth matters more than throughput here. |
| **Dependency** | `PitchControlSummary` is produced by the **math layer (implementation-track Phase 04)**. Phase 05 ships a stubbed fixture so the agent can be implemented in isolation. |
| **Done when** | `run_tactical_verdict(payload)` returns a `CoachBrief` whose `ui_schema` echoes upstream agent outputs verbatim, instructions are sorted severity-descending, and every narrative string cites concrete numbers. |

---

## 1. Goal

Phase 05 is the only agent whose output the coach reads. From `PROJECT.md` §3 Phase 4, the canonical example is:

> *"The defensive midfielder does not drop back enough during the defensive phase, leaving a control gap in front of the penalty box with an xT exposure of 0.15 per attack."*

That shape — **specific actor, specific spatial fact, specific xT number** — is the standard for every sentence the agent emits. Generic football clichés ("the key man", "high press", "playmaker") without numerical or named citation are forbidden by the prompt and rejected by the smoke test.

The agent does **not** re-rank players, re-classify zones, or re-detect patterns. Those are settled by Phases 02–04. The agent's value is **synthesis**: collapse four structured upstream outputs into a brief the coach can act on this week.

---

## 2. Deliverables

```
llm-integration/
├── src/
│   ├── agents/verdict.py              NEW
│   └── schemas/verdict.py             NEW
└── tests/
    ├── fixtures/verdict_input_minimal.json   NEW
    └── test_verdict_agent.py          NEW
```

No edits to base helper, prior agents' modules, or `requirements.txt`.

---

## 3. Pydantic Schemas (Pinned)

> `PitchControlSummary` is the contract the math layer must honour. **Do not rename fields.**

### 3.1 Input — `TacticalVerdictInput` (`src/schemas/verdict.py`)

```python
from pydantic import BaseModel, Field
from typing import Literal
from src.schemas.ingestion import IngestionMetadata
from src.schemas.xt_engine import RankedThreatList
from src.schemas.zones import ZonePriorityMap, Corridor
from src.schemas.goal_dna import BuildupPattern

Severity = Literal["critical", "high", "medium", "info"]


class PitchControlAlert(BaseModel):
    zone_id: int
    grid_x: int
    grid_y: int
    corridor: Corridor
    opponent_control_pct: float = Field(ge=0.0, le=1.0)
    our_control_pct: float = Field(ge=0.0, le=1.0)
    xt_exposure: float                            # xT exposure per attack in this zone
    severity: Literal["critical", "high", "medium"]


class PitchControlSummary(BaseModel):
    alerts: list[PitchControlAlert]               # only zones that crossed math-layer thresholds
    avg_defensive_line_height: float = Field(ge=0.0, le=100.0)  # normalized pitch length
    notes: list[str] = Field(default_factory=list)


class TacticalVerdictInput(BaseModel):
    ingestion: IngestionMetadata
    threats: RankedThreatList                     # Phase 02
    zones: ZonePriorityMap                        # Phase 03
    pattern: BuildupPattern                       # Phase 04
    pitch_control: PitchControlSummary            # math layer
```

### 3.2 Output — `CoachBrief` (same file)

```python
class DefensiveInstruction(BaseModel):
    severity: Severity
    title: str                                    # short imperative; <= 80 chars
    body: str                                     # 2-4 sentences; MUST cite at least one digit AND one player_name or zone_id
    target_player_id: int | None = None
    target_zone_ids: list[int] = Field(default_factory=list)


class UISchemaMatrix(BaseModel):
    """Compact echo of upstream findings; the frontend renders this as the heatmap overlay."""
    danger_creator_id: int                        # echoed from threats.danger_creator_id
    secondary_target_ids: list[int]               # echoed from threats.secondary_targets
    critical_zone_ids: list[int]                  # the zone_ids of every priority_zones entry where priority == "critical"
    critical_corridors: list[Corridor]            # echoed from zones.critical_corridors
    pattern_signature: str                        # echoed from pattern.pattern_signature
    pattern_confidence: float                     # echoed from pattern.confidence


class CoachBrief(BaseModel):
    opponent_id: int
    headline: str                                 # ONE sentence; MUST cite at least one digit
    summary: str                                  # 3-5 sentences; MUST cite at least one player name AND one zone_id
    instructions: list[DefensiveInstruction] = Field(min_length=3, max_length=6)
    ui_schema: UISchemaMatrix
    confidence: float = Field(ge=0.0, le=1.0)
```

---

## 4. The Agent — `src/agents/verdict.py`

```python
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
    model = os.environ.get("LLM_MODEL_VERDICT", "gemini-2.5-pro")
    return call_structured(model, prompt, CoachBrief)
```

> **Why pinned this way:** rule 1's verbatim-echo discipline keeps the dashboard's UI matrix mathematically traceable to upstream agent outputs; rule 7 propagates Phase 04's confidence so a brief built on a weak pattern cannot present itself as certain; the cliché list in rule 6 mirrors the canonical bad-output failure mode for football LLMs.

---

## 5. Test Fixture & Smoke Test

### 5.1 `tests/fixtures/verdict_input_minimal.json`

Hand-build a `TacticalVerdictInput`:

- `ingestion` — minimum shape that round-trips through `IngestionMetadata`.
- `threats` — populated `RankedThreatList` with 4 players, exactly one with `is_danger_creator: true` (rank 1), 1 entry in `secondary_targets`. Use realistic `cumulative_xt` values (e.g., `0.84`, `0.71`, `0.32`, `0.10`).
- `zones` — `ZonePriorityMap` with 5 entries in `priority_zones` (one `critical`, two `high`, two `medium`), `critical_corridors` of length 2.
- `pattern` — `BuildupPattern` with a real `pattern_signature` (not `mixed_inconclusive`), `confidence: 0.72`, `is_based_on_synthesised_input: false`, 2 key players whose `player_id`s also appear in `threats.ranked_players`.
- `pitch_control` — `PitchControlSummary` with 2 alerts (one `critical`, one `high`), each referencing a zone_id that exists in `zones.priority_zones`. `avg_defensive_line_height: 42.0`.

Validate:

```bash
python -c "from src.schemas.verdict import TacticalVerdictInput; TacticalVerdictInput.model_validate_json(open('tests/fixtures/verdict_input_minimal.json').read())"
```

### 5.2 `tests/test_verdict_agent.py`

```python
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
```

A second fixture exercising the `pattern.confidence < 0.5` cap is **out of scope here** — covered by the eval harness in the implementation track.

---

## 6. Implementation Tasks (Execute In Order)

1. Confirm Phases 01–04 are complete (`pytest tests/ -v` green).
2. Write `src/schemas/verdict.py` per §3.
3. Write `src/agents/verdict.py` per §4.
4. Hand-build `tests/fixtures/verdict_input_minimal.json` per §5.1. Validate it parses.
5. Write `tests/test_verdict_agent.py` per §5.2.
6. Run `pytest tests/test_verdict_agent.py -v` with credentials. If a structural assertion fails, **fix the prompt** — do not loosen the assertion.
7. Run full suite `pytest tests/ -v`. Phases 01–04 must still pass.
8. Commit: `Add Phase 5 LLM agent: tactical verdict`.

---

## 7. Acceptance Criteria

- [ ] All §2 files exist with the contents specified.
- [ ] `pytest tests/test_verdict_agent.py -v` passes against a real Gemini key.
- [ ] All §5.2 assertions hold; none were loosened.
- [ ] Full suite `pytest tests/ -v` passes.
- [ ] No code outside this phase added (no orchestrator, no math layer, no Cloud Function entrypoint).
- [ ] `git status` clean.

---

## 8. Out Of Scope

- The orchestrator (`main(request)`) that chains Phases 01–05 together. Lives in the implementation-track Phase 05.
- The math layer that produces `PitchControlSummary`. Lives in the implementation-track Phase 04.
- A second fixture for the low-confidence pattern cap. Covered by the eval harness.
- Persistence to Supabase, retries, structured logging — orchestrator concerns.
- Frontend rendering of the coach brief.

If you find yourself writing any of the above, stop and re-open the relevant phase file.

---

## 9. Closing Note

Phase 05 closes the LLM-agent track. Once it is green, the next work is **outside this folder**: the implementation-track phases listed in `llm-integration/overview.md` §10 — scaffold, data contracts (already largely captured by the schemas these phases produced), the math layer, the Cloud Function orchestrator (`main(request)`), `gcloud` deployment, and the eval harness. The five `run_*` entrypoints these phases produced are the public surface the orchestrator will call.
