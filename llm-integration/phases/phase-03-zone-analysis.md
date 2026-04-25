# Phase 03 — Zone Analysis Agent

> **Strict task spec for Claude Code.** Execute the steps in order. Do not start this phase until **Phase 01 and Phase 02 are complete** — `src/agents/base.py` must already exist.

| Field | Value |
|---|---|
| **Phase** | 03 — third of 5 LLM agent phases |
| **Owner** | Member 3 (LLM Architecture) |
| **Companion files** | `llm-integration/overview.md`, phases 01–02, `PROJECT.md` §3 (Phases 2 & 4) + §4, `CLAUDE.md` |
| **LLM agent role** | Classify zones in the 16×12 grid by danger priority and corridor membership. Output drives the frontend heatmap and the Phase 5 verdict's spatial citations. |
| **Model** | `gemini-2.5-flash` (override via `LLM_MODEL_ZONES`) |
| **Dependency** | Input `ZoneAggregates` is produced by the **math layer (Phase 04 in the implementation track)**. Phase 03 ships a stubbed fixture so the agent can be implemented in isolation. |
| **Done when** | `run_zone_analysis(payload)` returns a `ZonePriorityMap` whose `priority_zones` cover at least the top-K active zones, every entry has a corridor and a numerically-cited reason, and `critical_corridors` is non-empty. |

---

## 1. Goal

The agent classifies the opponent's offensive geography. It does **not** invent activity for empty zones; the math layer (Phase 04) hands it a pre-aggregated `ZoneAggregates` covering all 192 cells. The agent picks the cells that matter and labels them.

Two outputs the downstream Tactical Verdict Agent will quote:

- **`priority_zones`** — only zones with meaningful activity, each tagged `critical` / `high` / `medium`, with a corridor and a one-line reason citing concrete numbers (pass count or xT sum).
- **`critical_corridors`** — 1–3 corridors (left wing, left halfspace, central, right halfspace, right wing) where the opponent concentrates threat.

Zones not in `priority_zones` are implicitly low priority. The frontend treats them as baseline. Keeping the output sparse avoids 192-row hallucinations.

---

## 2. Deliverables

```
llm-integration/
├── src/
│   ├── agents/zones.py                NEW
│   └── schemas/zones.py               NEW
└── tests/
    ├── fixtures/zones_input_minimal.json   NEW
    └── test_zones_agent.py            NEW
```

No edits to base helper, ingestion / xt_engine modules, or `requirements.txt`.

---

## 3. Pydantic Schemas (Pinned)

> `ZoneAggregates` is the contract the math layer must honour. **Do not rename fields.**

### 3.1 Input — `ZoneAnalysisInput` (`src/schemas/zones.py`)

```python
from pydantic import BaseModel, Field
from typing import Literal
from src.schemas.ingestion import IngestionMetadata

Corridor = Literal["left_wing", "left_halfspace", "central", "right_halfspace", "right_wing"]
Priority = Literal["critical", "high", "medium"]


class ZoneAggregate(BaseModel):
    """Per-zone aggregates over the match window. Math-layer output."""
    zone_id: int                  # 0..191; zone_id = grid_y * 16 + grid_x
    grid_x: int                   # 0..15 (column, attacking left-to-right toward our goal)
    grid_y: int                   # 0..11 (row)
    corridor: Corridor            # math-layer assigns this from grid_x
    pass_destination_count: int   # opponent passes ENDING in this zone
    pass_origin_count: int        # opponent passes ORIGINATING in this zone
    shot_count: int
    xt_sum: float                 # cumulative xT_delta of passes ending here (defensive-mode xT)
    avg_xt_delta: float           # xt_sum / pass_destination_count, math-layer computed; 0.0 if no passes


class ZoneAggregates(BaseModel):
    aggregates: list[ZoneAggregate] = Field(min_length=192, max_length=192)


class ZoneAnalysisInput(BaseModel):
    ingestion: IngestionMetadata
    zones: ZoneAggregates
```

### 3.2 Output — `ZonePriorityMap` (same file)

```python
class ZonePriority(BaseModel):
    zone_id: int
    grid_x: int
    grid_y: int
    corridor: Corridor
    priority: Priority
    reasoning: str                # 1 sentence; MUST cite at least one concrete number


class ZonePriorityMap(BaseModel):
    opponent_id: int
    priority_zones: list[ZonePriority]   # sparse; ordered by priority desc, then xT desc
    critical_corridors: list[Corridor] = Field(min_length=1, max_length=3)
    summary: str                  # 1-2 sentences; cites at least one corridor or zone_id
```

---

## 4. The Agent — `src/agents/zones.py`

```python
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
```

> **Why pinned this way:** explicit numeric thresholds in rule 1 prevent the LLM from inventing priorities for empty zones; rule 2's verbatim-echo discipline matches Phase 02's pattern and keeps the heatmap renderer trustworthy; rule 3 makes corridor selection mechanical so the LLM cannot drift on the headline finding.

---

## 5. Test Fixture & Smoke Test

### 5.1 `tests/fixtures/zones_input_minimal.json`

Hand-build a `ZoneAnalysisInput`:

- Trim `ingestion` to the minimum shape that round-trips through `IngestionMetadata` (mirror the Phase 01 fixture's structure).
- `zones.aggregates` MUST be exactly **192 entries**, ordered `zone_id` 0..191. Most are zeroed out. Plant the following non-zero cells:
  - One `critical` candidate (e.g., `zone_id=170`, central corridor, `xt_sum=0.42`, `shot_count=4`, `pass_destination_count=18`).
  - Two `high` candidates in a wing corridor (e.g., `zone_id=156` and `zone_id=172`, right_wing, `xt_sum` around `0.18`, `pass_destination_count` around `25`).
  - Two `medium` candidates spread across corridors (`xt_sum` ~`0.07`, `pass_destination_count` ~`10`).
  - All other cells: zeros, with `grid_x`, `grid_y`, and `corridor` filled correctly. Use the formula `corridor = ["left_wing","left_wing","left_wing","left_halfspace","left_halfspace","left_halfspace","central","central","central","central","right_halfspace","right_halfspace","right_halfspace","right_wing","right_wing","right_wing"][grid_x]` (note: grid is 16 wide; this 16-element list is the canonical mapping).

Validate:

```bash
python -c "from src.schemas.zones import ZoneAnalysisInput; ZoneAnalysisInput.model_validate_json(open('tests/fixtures/zones_input_minimal.json').read())"
```

### 5.2 `tests/test_zones_agent.py`

```python
import os, pytest
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

    # Sparsity: at least the planted critical/high/medium zones surface, and not every cell is reported.
    assert 3 <= len(result.priority_zones) <= 30

    # critical_corridors well-formed.
    assert 1 <= len(result.critical_corridors) <= 3

    # Echoed fields match the input by zone_id (no fabricated zones, no drifted corridor labels).
    input_by_id = {z.zone_id: z for z in payload.zones.aggregates}
    for entry in result.priority_zones:
        src = input_by_id.get(entry.zone_id)
        assert src is not None, f"unknown zone_id {entry.zone_id}"
        assert entry.grid_x == src.grid_x
        assert entry.grid_y == src.grid_y
        assert entry.corridor == src.corridor

    # Every reasoning string cites a digit. summary mentions a corridor or zone_id.
    for entry in result.priority_zones:
        assert any(ch.isdigit() for ch in entry.reasoning)
    corridors = {"left_wing", "left_halfspace", "central", "right_halfspace", "right_wing"}
    summary_low = result.summary.lower()
    assert any(c in summary_low for c in corridors) or any(ch.isdigit() for ch in result.summary)
```

---

## 6. Implementation Tasks (Execute In Order)

1. Confirm Phases 01 and 02 are complete (`pytest tests/ -v` green).
2. Write `src/schemas/zones.py` per §3.
3. Write `src/agents/zones.py` per §4.
4. Hand-build `tests/fixtures/zones_input_minimal.json` per §5.1. Validate it parses.
5. Write `tests/test_zones_agent.py` per §5.2.
6. Run `pytest tests/test_zones_agent.py -v` with credentials. If a structural assertion fails, **fix the prompt** — do not loosen the assertion.
7. Run full suite: `pytest tests/ -v`. Phase 01 and 02 must still pass.
8. Commit: `Add Phase 3 LLM agent: zone analysis`.

---

## 7. Acceptance Criteria

- [ ] All §2 files exist with the contents specified.
- [ ] `pytest tests/test_zones_agent.py -v` passes against a real Gemini key.
- [ ] All §5.2 assertions hold; none were loosened.
- [ ] Full suite `pytest tests/ -v` passes.
- [ ] No code outside this phase added (no Phase 04–05 stubs, no math layer).
- [ ] `git status` clean.

---

## 8. Out Of Scope

- Phases 04 (Goal DNA) and 05 (Tactical Verdict).
- The math layer itself — the fixture is a hand-built stand-in. xT computation lives in the implementation track's Phase 04.
- Re-implementing or modifying `src/agents/base.py`.
- Frontend rendering of the heatmap.
- Persistence, retries, logging — orchestrator concerns.

If you find yourself writing any of the above, stop and re-open the relevant phase file.

---

## 9. Notes For The Next Phase

Phase 04 (Goal DNA Agent) will reuse `call_structured`, define `src/schemas/goal_dna.py` and `src/agents/goal_dna.py`, take the last 5 opponent goals as pass-network graphs (math-layer output), and emit a `BuildupPattern` with a confidence score. If the opponent scored zero goals in the window, the math layer hands in a single synthesised representative attack instead — Phase 04 must handle both shapes.
