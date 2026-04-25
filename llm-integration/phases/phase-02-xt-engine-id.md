# Phase 02 — xT Engine Identification Agent

> **Strict task spec for Claude Code.** Execute the steps in order. Do not skip ahead to other agent phases. Do not improvise schema fields or prompt text — both are pinned below. Do not start this phase until **Phase 01 is complete** (the shared `call_structured` helper from `src/agents/base.py` must already exist).

| Field | Value |
|---|---|
| **Phase** | 02 — second of 5 LLM agent phases |
| **Owner** | Member 3 (LLM Architecture) |
| **Companion files** | `llm-integration/overview.md`, `llm-integration/phases/phase-01-data-ingestion.md`, `PROJECT.md` §3 (Phase 3) + §4 |
| **LLM agent role** | Second in the 5-agent chain. Identifies the opponent's "engine" — the highest cumulative-xT player — and flags them as the primary marking target, even if they have zero goals. |
| **Model** | `gemini-2.5-flash` (overridable via env `LLM_MODEL_XT_ENGINE`) |
| **Prerequisites** | Phase 01 complete: `src/agents/base.py`, `src/schemas/ingestion.py`, `requirements.txt`, `.env.example`. |
| **Dependency note** | The agent's input includes `PlayerXTAggregate[]`, which is produced by the **math layer (Phase 04)**. Phase 04 is not done yet. This phase ships a stubbed fixture so the agent can be implemented and tested in isolation. The math layer must later honour the schema pinned in §3. |
| **Status when done** | Calling `run_xt_engine(input_payload)` from a Python REPL with the fixture returns a populated `RankedThreatList` where exactly one player has `is_danger_creator=True` and every `reasoning` string cites at least one concrete number. |

---

## 1. Goal

Build the second agent in the LLM chain. From `PROJECT.md` §3 Phase 3:

> Pass value = `xT(destination zone) − xT(start zone)`. The player with the **highest accumulated xT** is flagged as the **primary target for tight marking** — even if they have 0 goals on paper.

The arithmetic — summing xT deltas per player, computing averages, identifying top passes — belongs to the **math layer (Phase 04)**. By the time this agent runs, those aggregates are already computed and handed in as input.

This agent's value is **judgment + narrative**, not arithmetic:

- **Judgment** — usually the danger creator is just the player with the highest cumulative xT, but not always. A #10 with three killer passes can be the real engine while a deep-lying volume passer tops the cumulative chart. The LLM gets to override the raw ranking with a tactical reason.
- **Narrative** — produce per-player reasoning that cites concrete numbers (cumulative xT, average per pass, zone IDs of top passes) so the downstream Tactical Verdict Agent (Phase 5) has grounded evidence to quote.
- **Secondary targets** — flag up to two additional players (a "second engine" or a wide creator) if the data clearly supports it.

The agent does **not** re-do the math. The hard rules in §5 forbid altering the cumulative xT values that come in from the math layer.

---

## 2. Deliverables

By the end of this phase, the repo contains the following **new** files (everything else from Phase 01 is reused as-is):

```
llm-integration/
├── src/
│   ├── agents/
│   │   └── xt_engine.py                NEW  ← Phase 2 agent
│   └── schemas/
│       └── xt_engine.py                NEW  ← XTEngineInput + RankedThreatList
└── tests/
    ├── fixtures/
    │   └── xt_engine_input_minimal.json   NEW  ← stubbed math-layer output
    └── test_xt_engine_agent.py         NEW  ← smoke test
```

No changes to `src/agents/base.py`, `src/schemas/ingestion.py`, `requirements.txt`, or `.env.example`. If you find yourself editing those, stop — Phase 01's helper is already sufficient.

---

## 3. Pydantic Schemas (Pinned)

> `PlayerXTAggregate` is the **contract** the math layer (Phase 04) must satisfy. Phase 02 codifies it before Phase 04 implements it. **Do not add or rename fields.** If the field set genuinely needs to change, raise it as a contract change first — do not silently drift, or the math layer and the LLM will desync.

### 3.1 Input — `XTEngineInput` (`src/schemas/xt_engine.py`)

```python
from pydantic import BaseModel, Field
from typing import Literal
from src.schemas.ingestion import IngestionMetadata


class TopPassExample(BaseModel):
    """One of a player's most threatening successful passes, kept for grounding the LLM's reasoning."""
    match_id: int
    timestamp: int                       # match-clock seconds
    start_zone_id: int                   # 0..191 in the 16x12 grid (Phase 04 owns this mapping)
    end_zone_id: int
    xt_delta: float                      # end_zone_xt - start_zone_xt
    receiver_player_id: int | None       # null for unsuccessful or unidentified receivers
    receiver_player_name: str | None


class PlayerXTAggregate(BaseModel):
    """Pre-aggregated by the math layer. The LLM does NOT recompute these values."""
    player_id: int
    player_name: str
    team_side: Literal["home", "away"]
    cumulative_xt: float                 # sum of xt_delta over successful passes in window
    successful_pass_count: int
    average_xt_per_pass: float           # cumulative_xt / successful_pass_count, math-layer computed
    top_passes: list[TopPassExample]     # top 3 by xt_delta, descending
    matches_played: int                  # distinct match_ids the player appears in


class XTEngineInput(BaseModel):
    ingestion: IngestionMetadata         # Phase 01 output — passed through for context
    aggregates: list[PlayerXTAggregate]  # math-layer output, sorted desc by cumulative_xt
```

### 3.2 Output — `RankedThreatList` (same file)

```python
class PlayerThreatEntry(BaseModel):
    player_id: int
    player_name: str
    rank: int                            # 1 = highest threat; ranks are dense and start at 1
    cumulative_xt: float                 # MUST be echoed verbatim from the matching input aggregate
    reasoning: str                       # 1-2 sentences; must cite at least one concrete number
    is_danger_creator: bool


class RankedThreatList(BaseModel):
    opponent_id: int                     # echoed from ingestion.matches_covered context
    ranked_players: list[PlayerThreatEntry]   # ordered by rank ascending (rank 1 first)
    danger_creator_id: int               # MUST match the player_id of the rank-1 entry with is_danger_creator=True
    secondary_targets: list[int] = Field(default_factory=list, max_length=2)
    notes: list[str] = Field(default_factory=list)   # short, factual; e.g., "two players within 5% cumulative xT — dual-engine pattern"
```

---

## 4. The Agent — `src/agents/xt_engine.py`

```python
import os
from src.agents.base import call_structured
from src.schemas.xt_engine import XTEngineInput, RankedThreatList

XT_ENGINE_PROMPT = """You are a tactical-analysis agent in step 2 of a 5-agent football opponent-analysis chain.

You receive a JSON payload with two parts:
1. `ingestion` — validated metadata about the scraped match window (output of the Phase 1 Data Ingestion Agent).
2. `aggregates` — a list of player-level xT aggregates pre-computed by the math layer. Each entry contains cumulative xT, pass counts, average xT per pass, and the player's top 3 most threatening successful passes (with start/end zone IDs and xT deltas).

Your job: produce a ranked threat list and identify exactly ONE primary `danger_creator` — the opponent player we should mark tightly, even if they have zero goals.

HARD RULES — these override anything else:
1. The arithmetic is already done. `cumulative_xt` values in your output MUST be echoed verbatim from the input. Do not re-sum, round, or alter them.
2. Default ranking is by `cumulative_xt` descending. You MAY override this ranking IF you have a tactical reason — for example, a player with very high `average_xt_per_pass` but few passes (suggesting heavy marking or early substitution) can outrank a deep-lying volume passer. If you override, the `reasoning` for that player MUST state the override rationale.
3. Exactly ONE player has `is_danger_creator: true`. That player's rank MUST be 1, and `danger_creator_id` MUST equal their `player_id`.
4. Each `reasoning` string MUST cite at least one concrete number from the input — a cumulative xT, an average, a pass count, or a zone ID from a top pass. Generic football clichés ("playmaker", "creative midfielder", "key man") without a numerical citation are forbidden.
5. `secondary_targets` contains 0–2 additional player_ids. Use it only when the data clearly supports a "second engine" — for example, a wide creator with a top pass into Zone 14, or a second player within 10% of the danger creator's cumulative xT.
6. `notes` are short factual strings — e.g., "two players within 5% cumulative xT, dual-engine pattern". No coaching prescriptions, no clichés.
7. Stay in scope. You are NOT analysing zones (Phase 3), goal patterns (Phase 4), or producing the coach-facing brief (Phase 5).

Input:
{input_json}
"""


def run_xt_engine(payload: XTEngineInput) -> RankedThreatList:
    """Phase 2 entrypoint. Pure function: aggregates in, ranked threat list out."""
    prompt = XT_ENGINE_PROMPT.format(input_json=payload.model_dump_json())
    model = os.environ.get("LLM_MODEL_XT_ENGINE", "gemini-2.5-flash")
    return call_structured(model, prompt, RankedThreatList)
```

> **Why the prompt looks like this:** rule 1 (no re-doing arithmetic) prevents the LLM from drifting on numbers it is bad at; rule 4 (cite concrete numbers) is the property the Phase 5 Tactical Verdict Agent will rely on for grounded coach-readable text; rule 2 (override allowed with reason) is the only place where the LLM contributes judgment beyond raw sorting — without it, this phase would be a Python `sorted()` call.

---

## 5. Test Fixture & Smoke Test

### 5.1 `tests/fixtures/xt_engine_input_minimal.json`

Hand-build a minimal but realistic `XTEngineInput`. The fixture is the **stub** that lets us test the agent before the math layer (Phase 04) exists.

Required shape:

- An `ingestion` object that round-trips through `IngestionMetadata` — easiest path: copy the structural shape produced by Phase 01's smoke test against `ingestion_bundle_minimal.json`, then trim to the minimum fields. Do not import or call the Phase 01 agent at fixture-build time.
- An `aggregates` array with **at least 4 players** spanning both `team_side` values, sorted descending by `cumulative_xt`. Include:
  - **Player A** — clear engine: highest `cumulative_xt` (e.g., `0.84`), `successful_pass_count` ≥ 30, `average_xt_per_pass` mid-range, three `top_passes` with `xt_delta` ≥ `0.05`.
  - **Player B** — high-volume but low-impact: second-highest `cumulative_xt` (e.g., `0.71`), high pass count, low average per pass. A *trap* candidate that the LLM should rank #2, not #1.
  - **Player C** — low-volume killer: small `cumulative_xt` (e.g., `0.32`) but very high `average_xt_per_pass` (≥ `0.04`). Plausible secondary target.
  - **Player D** — filler: tiny cumulative xT, included so the ranked list has a clear tail.
- All `xt_delta` values plausible (range roughly `-0.05` to `+0.20`).
- All zone IDs in `0..191`.

Write the file as JSON, with `match_id` and `player_id` integers, dates ISO 8601, coordinates omitted (this fixture is post-math-layer; coordinates are not in the schema).

Validate it parses before writing the test:

```bash
python -c "import json; from src.schemas.xt_engine import XTEngineInput; XTEngineInput.model_validate_json(open('tests/fixtures/xt_engine_input_minimal.json').read())"
```

### 5.2 `tests/test_xt_engine_agent.py`

```python
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

    # Structural invariants the prompt is supposed to enforce.
    assert isinstance(result, RankedThreatList)

    # Exactly one danger creator, and it is rank 1.
    danger_creators = [p for p in result.ranked_players if p.is_danger_creator]
    assert len(danger_creators) == 1
    assert danger_creators[0].rank == 1
    assert result.danger_creator_id == danger_creators[0].player_id

    # Ranks are dense, start at 1, and cover every entry exactly once.
    ranks = sorted(p.rank for p in result.ranked_players)
    assert ranks == list(range(1, len(ranks) + 1))

    # cumulative_xt values must be echoed verbatim from the input aggregates.
    input_xt_by_id = {a.player_id: a.cumulative_xt for a in payload.aggregates}
    for entry in result.ranked_players:
        assert entry.player_id in input_xt_by_id
        assert entry.cumulative_xt == input_xt_by_id[entry.player_id], \
            f"cumulative_xt drifted for player {entry.player_id}"

    # Every reasoning string is non-empty and contains at least one digit (proxy for "cites a number").
    for entry in result.ranked_players:
        assert entry.reasoning.strip()
        assert any(ch.isdigit() for ch in entry.reasoning), \
            f"reasoning for player {entry.player_id} cites no numbers"

    # secondary_targets is at most 2 and disjoint from the danger creator.
    assert len(result.secondary_targets) <= 2
    assert result.danger_creator_id not in result.secondary_targets
```

The skip-marker is identical to Phase 01's. CI without Gemini credentials still passes; the maintainer running this phase MUST run the live test once before marking it done.

---

## 6. Implementation Tasks (Execute In Order)

1. Confirm Phase 01 is complete: `src/agents/base.py`, `src/schemas/ingestion.py`, and `tests/fixtures/ingestion_bundle_minimal.json` all exist. If not, do **not** start this phase — finish Phase 01 first.
2. Write `src/schemas/xt_engine.py` exactly as specified in §3.
3. Write `src/agents/xt_engine.py` exactly as specified in §4.
4. Hand-build `tests/fixtures/xt_engine_input_minimal.json` per §5.1. Validate it parses with the one-liner in §5.1.
5. Write `tests/test_xt_engine_agent.py` per §5.2.
6. With `GEMINI_API_KEY` (or Vertex AI env vars) set, run `pytest tests/test_xt_engine_agent.py -v`. Confirm the test passes (not skipped). If a structural assertion fails, **fix the prompt** — do not loosen the assertion.
7. Run the full test suite — `pytest tests/ -v` — to confirm Phase 01 is not regressed.
8. Commit. Suggested message: `Add Phase 2 LLM agent: xT engine identification`.

---

## 7. Acceptance Criteria

This phase is **done** when **all** of the following are true:

- [ ] All files in §2 exist with the contents specified.
- [ ] `pytest tests/test_xt_engine_agent.py -v` passes against a real Gemini key (not skipped).
- [ ] All structural assertions in §5.2 hold — no assertion was loosened to make the test pass.
- [ ] `pytest tests/ -v` (full suite) passes; Phase 01's smoke test still works.
- [ ] No code outside this phase has been added (no Phase 03–05 stubs, no math-layer code).
- [ ] No Cloud Function code, no Supabase client, no math layer code has been added.
- [ ] `git status` is clean after the commit.

---

## 8. Out Of Scope (Do Not Do In This Phase)

- Phase 03 (Zone Analysis), Phase 04 (Goal DNA), Phase 05 (Tactical Verdict). Even tempting "just stub it" placeholders.
- The math layer itself. The fixture is a hand-built stand-in; do **not** implement xT computation here. That is Phase 04 (`phase-04-math-layer.md` in the implementation track from `overview.md`).
- Re-implementing or modifying `src/agents/base.py`. The Phase 01 helper is sufficient.
- Multi-opponent comparison. The agent processes one opponent's window at a time.
- Persistence. The agent is a pure function — `payload in, ranked list out`. No Supabase, no file writes.
- Retries, exponential backoff, structured logging. The orchestrator (Phase 05 in the implementation track) owns those concerns.
- Frontend integration.

If you find yourself writing any of the above, stop and re-open the relevant phase file instead.

---

## 9. Notes For The Next Phase

Phase 03 (Zone Analysis Agent) will:

- Reuse `call_structured` from `src/agents/base.py`.
- Define new schemas in `src/schemas/zones.py` and a new agent in `src/agents/zones.py`.
- Take `IngestionMetadata` (from Phase 01) plus a `ZoneAggregates` object (math-layer output) as input — same dependency pattern as this phase.
- Emit a `ZonePriorityMap` covering all 192 grid cells.

Like this phase, Phase 03 will work against a stubbed math-layer fixture until the math layer (Phase 04 in the implementation track) lands. Document that explicitly when Phase 03 is written.
