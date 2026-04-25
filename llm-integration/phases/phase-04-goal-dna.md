# Phase 04 — Goal DNA Pattern Recognition Agent

> **Strict task spec for Claude Code.** Execute in order. Do not start until **Phases 01–03 are complete** — `src/agents/base.py` must already exist and the prior agents' tests must pass.

| Field | Value |
|---|---|
| **Phase** | 04 — fourth of 5 LLM agent phases |
| **Owner** | Member 3 (LLM Architecture) |
| **Companion files** | `llm-integration/overview.md`, phases 01–03, `PROJECT.md` §3 (Phase 5) + §4, `CLAUDE.md` |
| **LLM agent role** | Inspect 1–5 pass-network graphs (the 15–20s of possession before each of the opponent's last scored goals) and extract a single recurring build-up pattern with a confidence score. |
| **Model** | `gemini-2.5-flash` (override via `LLM_MODEL_GOAL_DNA`) |
| **Dependency** | Pass-network graphs are produced by the **math layer (implementation-track Phase 04)**. Phase 04 here ships a stubbed fixture so the agent can be implemented in isolation. |
| **Done when** | `run_goal_dna(payload)` returns a `BuildupPattern` with a valid `pattern_signature`, confidence in `[0, 1]`, and key players / zones that all reference IDs present in the input graphs. |

---

## 1. Goal

The agent looks at 1–5 graphs, each one representing the 15–20 seconds before a goal. Players are nodes, passes are weighted edges. The agent's job is to extract the **single recurring build-up signature** that explains how this opponent scores — not to describe every graph.

Two real-world shapes the agent must handle:

- **Standard case** — between 1 and 5 graphs from real scored goals.
- **Zero-goals fallback** — opponent scored zero goals in the window. The math layer instead synthesises one representative attacking sequence (longest dangerous possession that did not end in a goal) and flags it `is_synthesised=True`. When the entire input is synthesised, the agent must cap confidence at `0.4` to signal the result is a hypothesis, not an observed pattern.

---

## 2. Deliverables

```
llm-integration/
├── src/
│   ├── agents/goal_dna.py             NEW
│   └── schemas/goal_dna.py            NEW
└── tests/
    ├── fixtures/goal_dna_input_minimal.json   NEW
    └── test_goal_dna_agent.py         NEW
```

No edits to base helper, prior agents, or `requirements.txt`.

---

## 3. Pydantic Schemas (Pinned)

> `PassNetworkGraph` is the contract the math layer must honour. **Do not rename fields.**

### 3.1 Input — `GoalDNAInput` (`src/schemas/goal_dna.py`)

```python
from pydantic import BaseModel, Field
from typing import Literal
from src.schemas.ingestion import IngestionMetadata


class PassEdge(BaseModel):
    from_player_id: int
    from_player_name: str
    to_player_id: int
    to_player_name: str
    from_zone_id: int                    # 0..191 in the 16x12 grid
    to_zone_id: int
    timestamp_offset: float              # seconds relative to the goal; negative = before
    weight: int = 1                      # traffic count if edges are aggregated; 1 otherwise


class PassNetworkGraph(BaseModel):
    match_id: int
    goal_scorer_id: int | None           # null when is_synthesised=True
    goal_timestamp: int | None           # match-clock seconds; null when is_synthesised=True
    duration_seconds: float              # typically 15-20
    edges: list[PassEdge] = Field(min_length=1)
    is_synthesised: bool = False         # True for the zero-goals fallback graph


class GoalDNAInput(BaseModel):
    ingestion: IngestionMetadata
    graphs: list[PassNetworkGraph] = Field(min_length=1, max_length=5)
```

### 3.2 Output — `BuildupPattern` (same file)

```python
PatternSignature = Literal[
    "wide_overload_to_central_finish",
    "central_progression_through_halfspace",
    "fast_transition_counter",
    "set_piece_secondary",
    "deep_buildup_long_switch",
    "individual_dribble_initiated",
    "mixed_inconclusive",
]

PlayerRole = Literal["originator", "progressor", "finisher", "decoy", "switcher"]


class KeyPlayer(BaseModel):
    player_id: int
    player_name: str
    role: PlayerRole


class BuildupPattern(BaseModel):
    opponent_id: int
    pattern_signature: PatternSignature
    confidence: float = Field(ge=0.0, le=1.0)
    description: str                              # 2-3 sentences; cites at least one zone_id AND one player name
    key_players: list[KeyPlayer] = Field(min_length=2, max_length=4)
    starting_zones: list[int] = Field(min_length=1, max_length=3)   # zones where build-ups originate
    finishing_zones: list[int] = Field(min_length=1, max_length=3)  # zones where shots originate
    is_based_on_synthesised_input: bool           # MUST mirror whether all input graphs were synthesised
    notes: list[str] = Field(default_factory=list)
```

---

## 4. The Agent — `src/agents/goal_dna.py`

```python
import os
from src.agents.base import call_structured
from src.schemas.goal_dna import GoalDNAInput, BuildupPattern

GOAL_DNA_PROMPT = """You are a tactical-analysis agent in step 4 of a 5-agent football opponent-analysis chain.

You receive a JSON payload with:
1. `ingestion` — validated metadata about the scraped match window (Phase 1 output).
2. `graphs` — 1 to 5 pass-network graphs, each representing the 15-20 seconds of opponent possession before a scored goal. Players are nodes; passes are weighted edges with from/to zone IDs (0..191 in the 16x12 grid) and a timestamp_offset (negative = before the goal). If `is_synthesised` is True, the graph is a representative dangerous attack that did not end in a goal — used when the opponent scored zero goals in the window.

Your job: identify the SINGLE recurring build-up signature that best explains how this opponent scores, with a confidence score.

HARD RULES — these override anything else:
1. `pattern_signature` MUST be one of the allowed literal values. If no consistent pattern emerges across the graphs, use `mixed_inconclusive` — do not stretch a label to fit.
2. `confidence` is in [0, 1]. If ALL input graphs have `is_synthesised: true`, confidence MUST NOT exceed 0.4 — the result is a hypothesis, not an observed pattern. Set `is_based_on_synthesised_input: true` in this case.
3. Every `key_players[].player_id` MUST appear as either a from_player_id or to_player_id in at least one input edge. Do not invent players.
4. Every `starting_zones[]` and `finishing_zones[]` zone_id MUST appear as a from_zone_id or to_zone_id in at least one input edge. Do not invent zones.
5. `description` is 2-3 sentences and MUST cite at least one concrete zone_id AND at least one player name from the input. Generic phrases ("they build through the middle", "incisive passing") without numerical/named citation are forbidden.
6. `notes` are short factual strings — e.g., "pattern present in 4 of 5 goals", "single synthesised graph; low confidence". No coaching prescriptions.
7. Stay in scope. You are NOT ranking players (Phase 2), classifying zones (Phase 3), or producing the coach brief (Phase 5).

Input:
{input_json}
"""


def run_goal_dna(payload: GoalDNAInput) -> BuildupPattern:
    prompt = GOAL_DNA_PROMPT.format(input_json=payload.model_dump_json())
    model = os.environ.get("LLM_MODEL_GOAL_DNA", "gemini-2.5-flash")
    return call_structured(model, prompt, BuildupPattern)
```

> **Why pinned this way:** rule 2's confidence cap turns the synthesised-fallback case into a numerically verifiable invariant; rules 3 and 4 make hallucinated players and zones impossible to slip past the smoke test; the constrained `PatternSignature` literal lets the frontend map the verdict to a visual template.

---

## 5. Test Fixture & Smoke Test

### 5.1 `tests/fixtures/goal_dna_input_minimal.json`

Hand-build a `GoalDNAInput` representing the **standard case** (not the synthesised fallback):

- `ingestion` — minimum shape that round-trips through `IngestionMetadata` (mirror Phase 01's fixture).
- `graphs` — exactly **2 entries**, both `is_synthesised: false`, with distinct `match_id`s.
- Across both graphs, plant a recurring shape so the LLM can find a pattern: at least one shared `from_player_id` acting as a progressor (e.g., player 9001 carrying the ball from a halfspace zone like `zone_id=120` into a central zone like `zone_id=152`), and at least one shared `to_zone_id` near the box (e.g., `zone_id=170`).
- Each graph: 4–6 edges, plausible `timestamp_offset` values from `-18.0` up to `0.0`, weights `1`.
- All `from_zone_id` / `to_zone_id` in `0..191`. All player IDs and names internally consistent.

Validate:

```bash
python -c "from src.schemas.goal_dna import GoalDNAInput; GoalDNAInput.model_validate_json(open('tests/fixtures/goal_dna_input_minimal.json').read())"
```

### 5.2 `tests/test_goal_dna_agent.py`

```python
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
```

A second fixture for the synthesised-fallback path (with a single `is_synthesised: true` graph and an assertion that `confidence <= 0.4`) is **out of scope here** — it lands in the implementation-track Phase 07 (eval harness).

---

## 6. Implementation Tasks (Execute In Order)

1. Confirm Phases 01–03 are complete (`pytest tests/ -v` green).
2. Write `src/schemas/goal_dna.py` per §3.
3. Write `src/agents/goal_dna.py` per §4.
4. Hand-build `tests/fixtures/goal_dna_input_minimal.json` per §5.1. Validate it parses.
5. Write `tests/test_goal_dna_agent.py` per §5.2.
6. Run `pytest tests/test_goal_dna_agent.py -v` with credentials. If a structural assertion fails, **fix the prompt** — do not loosen the assertion.
7. Run full suite `pytest tests/ -v`. Phases 01–03 must still pass.
8. Commit: `Add Phase 4 LLM agent: goal DNA pattern recognition`.

---

## 7. Acceptance Criteria

- [ ] All §2 files exist with the contents specified.
- [ ] `pytest tests/test_goal_dna_agent.py -v` passes against a real Gemini key.
- [ ] All §5.2 assertions hold; none were loosened.
- [ ] Full suite `pytest tests/ -v` passes.
- [ ] No code outside this phase added (no Phase 05 stubs, no math-layer code).
- [ ] `git status` clean.

---

## 8. Out Of Scope

- Phase 05 (Tactical Verdict).
- The math layer that produces `PassNetworkGraph` from raw events.
- A separate fixture / test for the synthesised-fallback path — covered later by the eval harness.
- Multi-pattern detection. The agent emits ONE signature; if patterns conflict, the answer is `mixed_inconclusive`.
- Persistence, retries, logging — orchestrator concerns.

If you find yourself writing any of the above, stop and re-open the relevant phase file.

---

## 9. Notes For The Next Phase

Phase 05 (Tactical Verdict Agent) consumes the outputs of Phases 02, 03, and 04 — `RankedThreatList`, `ZonePriorityMap`, `BuildupPattern` — plus a `PitchControlSummary` from the math layer, and produces the coach-facing brief. It is the only agent whose output is shown directly to the user. Use `gemini-2.5-pro` for that phase, not `flash`, because reasoning depth matters more than throughput.
