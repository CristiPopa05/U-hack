# Phase 01 — Data Ingestion Agent

> **Strict task spec for Claude Code.** Execute the steps in order. Do not skip ahead to other agent phases. Do not improvise schema fields or prompt text — both are pinned below.

| Field | Value |
|---|---|
| **Phase** | 01 — first of 5 LLM agent phases |
| **Owner** | Member 3 (LLM Architecture) |
| **Companion files** | `llm-integration/overview.md`, `PROJECT.md` §3 + §4, `CLAUDE.md` |
| **LLM agent role** | First in the 5-agent chain. Validates the scraped JSON and emits a metadata schema that downstream agents trust. |
| **Model** | `gemini-2.5-flash` (overridable via env `LLM_MODEL_INGESTION`) |
| **Prerequisites** | None. This is the first phase; it sets up the scaffold the rest of the chain reuses. |
| **Status when done** | Calling `run_ingestion(bundle)` from a Python REPL with a fixture returns a populated `IngestionMetadata` object with no exceptions. |

---

## 1. Goal

Build the first agent in the LLM chain. The agent has **one job**: take a `RawScrapedBundle` (events + match metadata for an opponent over a window) and emit an `IngestionMetadata` summary that downstream phases (xT Engine ID, Zone Analysis, Goal DNA, Verdict) can rely on.

The agent is a **validator**, not an analyst:

- It lists what is in the bundle (matches, players, event-type counts).
- It flags what is missing or below quality thresholds.
- It must **never invent** matches, players, or events that are not in the input. This is the one rule the prompt enforces hardest.

Because this is the first phase being implemented, it also delivers the **shared scaffold** every later phase reuses: a single `call_structured(...)` helper that wraps `google-genai` + Pydantic structured output.

---

## 2. Deliverables

By the end of this phase, the repo contains:

```
llm-integration/
├── overview.md                         (already exists)
├── phases/
│   └── phase-01-data-ingestion.md      (this file)
├── requirements.txt                    NEW
├── .env.example                        NEW
├── src/
│   ├── __init__.py                     NEW
│   ├── agents/
│   │   ├── __init__.py                 NEW
│   │   ├── base.py                     NEW  ← shared Gemini client + call_structured
│   │   └── ingestion.py                NEW  ← Phase 1 agent
│   └── schemas/
│       ├── __init__.py                 NEW
│       └── ingestion.py                NEW  ← RawScrapedBundle + IngestionMetadata
└── tests/
    ├── __init__.py                     NEW
    ├── fixtures/
    │   └── ingestion_bundle_minimal.json  NEW  ← hand-built fixture
    └── test_ingestion_agent.py         NEW  ← smoke test
```

No Cloud Function deployment yet. That is phase 06.

---

## 3. Pydantic Schemas (Pinned)

> These schemas are the contract between the math layer (which produces the bundle) and the LLM agent. **Do not add or rename fields.** If a field genuinely needs to change, raise it as a contract change first — do not silently drift.

### 3.1 Input — `RawScrapedBundle` (`src/schemas/ingestion.py`)

```python
from pydantic import BaseModel, Field
from typing import Literal

class ScrapedEvent(BaseModel):
    match_id: int
    player_id: int | None
    event_type: Literal["pass", "shot", "carry", "dribble", "goal"]
    timestamp: int                         # match-clock seconds
    start_x: float | None                  # 0-100 normalized pitch coords
    start_y: float | None
    end_x: float | None
    end_y: float | None
    is_success: bool

class MatchMetadata(BaseModel):
    match_id: int
    date: str                              # ISO 8601 (YYYY-MM-DD)
    home_team: str
    away_team: str
    tournament: str

class PlayerMetadata(BaseModel):
    id: int
    name: str
    team_side: Literal["home", "away"]
    position: str | None

class RawScrapedBundle(BaseModel):
    opponent_id: int
    opponent_name: str
    match_window: tuple[str, str]          # (from_date, to_date), ISO 8601
    matches: list[MatchMetadata]
    players: list[PlayerMetadata]
    events: list[ScrapedEvent]
```

### 3.2 Output — `IngestionMetadata` (same file)

```python
class MatchSummary(BaseModel):
    match_id: int
    date: str
    opponent: str                          # the team facing our opponent in that match
    event_count: int
    is_complete: bool                      # True iff event_count >= 200 AND lineup present AND coords present for >= 90% of passes

class PlayerSummary(BaseModel):
    id: int
    name: str
    team_side: Literal["home", "away"]
    appearance_count: int                  # how many matches in window the player appears in

class CompletenessFlags(BaseModel):
    has_all_lineups: bool
    has_coordinates_for_all_passes: bool
    minimum_events_per_match: bool         # all matches >= 200 events
    missing_match_ids: list[int]           # matches the user requested but the bundle does not contain

class IngestionMetadata(BaseModel):
    matches_covered: list[MatchSummary]
    players_present: list[PlayerSummary]
    event_type_breakdown: dict[str, int]   # e.g. {"pass": 1234, "shot": 56, ...}
    total_events: int
    completeness: CompletenessFlags
    warnings: list[str] = Field(default_factory=list)  # human-readable strings
```

---

## 4. Shared Scaffold — `src/agents/base.py`

This file is **created in this phase** and reused by phases 02–05. Implement exactly:

```python
import os
from google import genai
from google.genai import types
from pydantic import BaseModel
from typing import TypeVar

T = TypeVar("T", bound=BaseModel)

def get_client() -> genai.Client:
    """Return a Gemini client configured for either Vertex AI or the Developer API.

    The `google-genai` SDK supports both. We pick based on env so the same code
    runs in local dev (Developer API key) and in Cloud Functions on GCP (Vertex AI).
    """
    if os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "").lower() == "true":
        return genai.Client(
            vertexai=True,
            project=os.environ["GOOGLE_CLOUD_PROJECT"],
            location=os.environ.get("GOOGLE_CLOUD_LOCATION", "europe-west1"),
        )
    return genai.Client(api_key=os.environ["GEMINI_API_KEY"])


def call_structured(model: str, prompt: str, response_schema: type[T]) -> T:
    """Single call shape reused by all 5 LLM agents.

    Forces JSON output that conforms to `response_schema` (a Pydantic class) and
    parses it back into a typed instance. If the SDK ever returns text that
    cannot be validated, this raises — phase 05 (cloud function glue) decides
    the retry policy at the orchestrator level. Do NOT add retries here.
    """
    client = get_client()
    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=response_schema,
        ),
    )
    return response_schema.model_validate_json(response.text)
```

> **Why pinned this way:** the `response_mime_type="application/json"` + `response_schema=<Pydantic class>` pattern is the documented `google-genai` v1.x way to guarantee schema-valid JSON. Keeping the helper to one function prevents each agent from reinventing the call shape.

---

## 5. The Agent — `src/agents/ingestion.py`

```python
import os
from src.agents.base import call_structured
from src.schemas.ingestion import RawScrapedBundle, IngestionMetadata

INGESTION_PROMPT = """You are a sports-data validation agent in a football tactical-analysis pipeline.

You will receive a JSON bundle of scraped event data for a single opposing team across a specified match window. Your role is the FIRST step in a 5-agent chain. Downstream agents will rank player threat, analyse zones, recognise goal patterns, and produce a tactical verdict — but only if your output is trustworthy.

Your job: inspect the bundle and return a structured metadata summary describing exactly what is present.

HARD RULES — these override anything else:
1. Do NOT invent matches, players, or events. If a field is missing in the input, say so in `warnings` and set the relevant completeness flag to false. Never fabricate data to fill a gap.
2. Counts must be derived from the input. `total_events` must equal the length of the events array. `event_type_breakdown` keys must come only from event types actually present.
3. `appearance_count` for a player is the number of distinct match_ids where that player_id appears in events — not a guess.
4. A match is `is_complete = true` only if ALL of: event_count >= 200, the player lineup for that match is non-empty, and at least 90% of pass events have non-null start/end coordinates.
5. `missing_match_ids` lists match IDs the request asked for but that are absent from `bundle.matches`. If the request did not enumerate IDs, leave this empty.
6. Warnings are short, factual strings — e.g. "match 12345 has only 87 events; below 200 threshold". No coaching advice, no clichés.

You are NOT analysing tactics. You are validating data shape. Stay in scope.

Bundle:
{bundle_json}
"""

def run_ingestion(bundle: RawScrapedBundle) -> IngestionMetadata:
    """Phase 1 entrypoint. Pure function: bundle in, metadata out."""
    prompt = INGESTION_PROMPT.format(bundle_json=bundle.model_dump_json())
    model = os.environ.get("LLM_MODEL_INGESTION", "gemini-2.5-flash")
    return call_structured(model, prompt, IngestionMetadata)
```

> **Why the prompt looks like this:** rule 1 (no fabrication) is the entire reason this agent exists — its outputs become the ground truth for phases 02–05. Every other rule is a numerically-checkable invariant so the eval harness in phase 07 can verify the prompt is still behaving.

---

## 6. Test Fixture & Smoke Test

### 6.1 `tests/fixtures/ingestion_bundle_minimal.json`

Hand-build a minimal but realistic bundle: 2 matches, 4 players (2 home / 2 away), ~10 events spread across `pass`/`shot`/`carry`/`goal`. Include at least one event missing coordinates and one match below the 200-event threshold so the agent has something to flag in `warnings`.

Use `match_id` and `player_id` integers — do not use strings. Keep coordinates in 0–100 range. Wrap dates in ISO 8601.

### 6.2 `tests/test_ingestion_agent.py`

```python
import json
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

    # Structural checks — these are invariants the prompt is supposed to enforce.
    assert isinstance(result, IngestionMetadata)
    assert result.total_events == len(bundle.events)
    assert sum(result.event_type_breakdown.values()) == result.total_events
    # The minimal fixture has at least one issue, so warnings must be non-empty.
    assert len(result.warnings) > 0
```

The skip-marker means CI without Gemini credentials still passes; only contributors with a key run the live call. A pure-mock test for the prompt formatting can be added later but is **out of scope** for this phase.

---

## 7. `requirements.txt`

```
google-genai>=1.33.0
pydantic>=2.7
python-dotenv>=1.0.0      # local dev only, ignored in cloud
pytest>=8.0               # tests
```

`functions-framework`, `numpy`, `pandas`, and `supabase` are intentionally **omitted**. They land in the phases that need them (04, 05).

---

## 8. `.env.example`

```
# One of these two paths must be configured.

# Path A — Gemini Developer API (hackathon default, simplest)
GEMINI_API_KEY=

# Path B — Vertex AI on GCP (demo / production-style)
# GOOGLE_GENAI_USE_VERTEXAI=true
# GOOGLE_CLOUD_PROJECT=
# GOOGLE_CLOUD_LOCATION=europe-west1

# Optional model override
# LLM_MODEL_INGESTION=gemini-2.5-flash
```

Commit `.env.example`. **Never commit a real `.env`.** Add `.env` to `.gitignore` if not already ignored.

---

## 9. Implementation Tasks (Execute In Order)

1. Create the directory tree from §2. Add empty `__init__.py` files where shown.
2. Write `requirements.txt` (§7) and install: `pip install -r llm-integration/requirements.txt`.
3. Write `.env.example` (§8). Update `.gitignore` to include `.env` if not already covered.
4. Write `src/schemas/ingestion.py` exactly as specified in §3.
5. Write `src/agents/base.py` exactly as specified in §4.
6. Write `src/agents/ingestion.py` exactly as specified in §5.
7. Hand-build `tests/fixtures/ingestion_bundle_minimal.json` per §6.1. Validate it parses: `python -c "from src.schemas.ingestion import RawScrapedBundle; import json; RawScrapedBundle.model_validate_json(open('tests/fixtures/ingestion_bundle_minimal.json').read())"`.
8. Write `tests/test_ingestion_agent.py` per §6.2.
9. With a `GEMINI_API_KEY` in the environment, run `pytest tests/test_ingestion_agent.py -v`. Confirm the test passes (or is skipped if no key — but the maintainer running this phase MUST run the live test once before marking the phase done).
10. Commit. Suggested message: `Add Phase 1 LLM agent: data ingestion validator`.

---

## 10. Acceptance Criteria

This phase is **done** when **all** of the following are true:

- [ ] All files in §2 exist with the contents specified.
- [ ] `pytest tests/test_ingestion_agent.py -v` passes against a real Gemini key (not skipped).
- [ ] The smoke-test assertions hold: `total_events` matches the bundle, breakdown sums correctly, warnings are non-empty for the deliberately-imperfect fixture.
- [ ] No agent code outside this phase has been added (no Phase 02–05 stubs creep).
- [ ] No Cloud Function code, no Supabase client, no math layer code has been added (those belong to later phases).
- [ ] `git status` is clean after the commit.

---

## 11. Out Of Scope (Do Not Do In This Phase)

- Phase 2–5 agents (xT Engine ID, Zone Analysis, Goal DNA, Verdict). Even tempting "just stub it" placeholders.
- Math layer (xT grid, Pitch Control). The bundle arrives with raw events; xT computation lives in phase 04.
- Supabase client wiring. The agent is a pure function — `bundle in, metadata out`. No DB I/O at this layer.
- Cloud Function entrypoint (`main(request)`). That is phase 05.
- `gcloud` deployment. That is phase 06.
- Eval harness with golden outputs. That is phase 07. The smoke test in §6.2 is intentionally minimal.
- Retries, exponential backoff, structured logging. The orchestrator in phase 05 owns these concerns.
- Frontend integration.

If you find yourself writing any of the above, stop and re-open the relevant phase file instead.

---

## 12. Notes For The Next Phase

Phase 02 (xT Engine Identification Agent) will:

- Import `call_structured` from `src/agents/base.py` (the helper exists after this phase).
- Define new schemas in `src/schemas/xt_engine.py` and a new agent in `src/agents/xt_engine.py`.
- Take an `IngestionMetadata` (from this phase) plus math-layer output as input.

The math layer output it depends on is built in **phase 04**, so phase 02 will work against a stubbed math input until phase 04 lands. Document that explicitly when phase 02 is written.
