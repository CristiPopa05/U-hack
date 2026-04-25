Phase 1 Recap

  Goal of Phase 1: Lock the contract that the React UI will consume — the typed shape every downstream piece (FastAPI server, Supabase reader, frontend renderers) is built against. No infrastructure, no LLM
  calls, no Supabase — just schemas + a pure deterministic assembler + tests.

  Files created

  ┌──────────────────────────────────────────┬────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │                   File                   │                                                                          What's in it                                                                          │
  ├──────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │                                          │ DashboardPayload root + 5 panel schemas (XTGridPanel, DangerCreatorPanel, VulnerabilityAlertsPanel, GoalDNAPanel, TacticalVerdictPanel), PhaseSummary, and the │
  │ llm-integration/src/schemas/dashboard.py │  discriminated union Panel keyed on type. Also defines TeamSpatialRow / PlayerSpatialRow / PlayerLookup — the typed inputs the assembler accepts (these mirror │
  │                                          │  what Phase 2's Supabase reader will produce).                                                                                                                 │
  ├──────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ llm-integration/src/assembler.py         │ assemble_dashboard(...) — pure Python, no LLM. Builds all 5 panels and the honest Panel D (each tactical-verdict card pulls verbatim from its source agent:    │
  │                                          │ xt_engine → zones → goal_dna → verdict).                                                                                                                       │
  ├──────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ llm-integration/tests/test_assembler.py  │ 7 tests covering: all five panel types present, xt_grid dimensions/range, danger_creator sort + is_primary flag, instructions carryover, goal_dna              │
  │                                          │ graph+pattern, honest Panel D source mapping, and JSON round-trip with discriminator.                                                                          │
  └──────────────────────────────────────────┴────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

  Honest Panel D wiring (the spec's key invariant)

  Verified by test_tactical_verdict_phases_pull_from_correct_source:

  - Phase 1&2 card ← top of RankedThreatList.ranked_players (name + cumulative xT + reasoning)
  - Phase 3 card ← first priority="critical" entry of ZonePriorityMap.priority_zones
  - Phase 4 card ← BuildupPattern.description verbatim
  - Phase 5 card ← CoachBrief.headline + first sentence of CoachBrief.summary

  Test result

  7 passed in 0.39s

  DashboardPayload.model_validate_json(payload.model_dump_json()) round-trips, confirming Phase 1's "Done when" condition is met.

  API keys — where they live (and where they don't)

  Phase 1 itself needs no API keys — schemas + a deterministic function are offline. Below is the inventory of where keys will be read once Phases 2–4 light up. None are committed to the repo for the LLM
  integration; they all read from environment variables.

  ┌─────────────────────────────────────────────┬─────────────────────────────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────────────────────┐
  │                     Key                     │                           Where it's consumed in code                           │                                   Why                                    │
  ├─────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
  │                                             │ llm-integration/src/agents/base.py:22 —                                         │ Powers all 5 LLM phases (1–4 on Flash, 5 on Pro). Loaded by              │
  │ GEMINI_API_KEY                              │ genai.Client(api_key=os.environ["GEMINI_API_KEY"])                              │ tests/conftest.py from llm-integration/.env. Not used by Phase 1, but    │
  │                                             │                                                                                 │ Phases 3+ need it.                                                       │
  ├─────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
  │ GOOGLE_GENAI_USE_VERTEXAI /                 │                                                                                 │ Alternative auth path when running on GCP (Vertex AI) instead of the     │
  │ GOOGLE_CLOUD_PROJECT /                      │ llm-integration/src/agents/base.py:16-21                                        │ Developer API.                                                           │
  │ GOOGLE_CLOUD_LOCATION                       │                                                                                 │                                                                          │
  ├─────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
  │ LLM_MODEL_VERDICT                           │ Read in llm-integration/src/agents/verdict.py (referenced in spec at            │ Lets Phase 5 swap to gemini-2.5-pro. Phase 3 of ui_schema_design.md will │
  │                                             │ verdict.py:40)                                                                  │  set this in .env.                                                       │
  ├─────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
  │ SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY    │ Will be added in Phase 2 — llm-integration/src/db/supabase_client.py (does not  │ Used by the to-be-built Supabase reader to fetch matches, players,       │
  │                                             │ exist yet). Naming matches the cloud function.                                  │ passes, match_events, spatial_analysis.                                  │
  ├─────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
  │                                             │                                                                                 │ Pre-existing security flag called out in the spec — owned by the         │
  │ ⚠️ Hardcoded Supabase key                   │ baza_de_date_json/upload_supabase.py                                            │ database teammate, not in scope for this plan. Do not propagate it into  │
  │                                             │                                                                                 │ llm-integration/.                                                        │
  └─────────────────────────────────────────────┴─────────────────────────────────────────────────────────────────────────────────┴──────────────────────────────────────────────────────────────────────────┘

  Loading: tests/conftest.py:11-12 calls load_dotenv(llm-integration/.env) so any pytest in this package picks up keys without manual export. For local dev, drop GEMINI_API_KEY=... into llm-integration/.env.

  Next up (out of scope here): Phase 2 of ui_schema_design.md — build src/db/supabase_client.py and src/db/bundle.py to feed real data into this assembler.