Phase 2 Recap

  Goal of Phase 2: Read everything the pipeline needs from Supabase and join it into the typed inputs the LLM agents consume — without hardcoding API keys and without committing the same security flag the
  existing baza_de_date_json/upload_supabase.py carries.

  Files created / edited

  ┌───────────────────────────────────────────────┬────────┬──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │                     File                      │ Status │                                                                   What it does                                                                   │
  ├───────────────────────────────────────────────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ llm-integration/src/db/__init__.py            │ NEW    │ Re-exports the public surface: SupabaseClient, the five fetch_* functions, get_default_client, build_raw_bundle.                                 │
  ├───────────────────────────────────────────────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │                                               │        │ httpx-based wrapper over Supabase's PostgREST API. SupabaseClient class (pooled connection, context manager) + module-level fetch_match /        │
  │ llm-integration/src/db/supabase_client.py     │ NEW    │ fetch_players / fetch_passes / fetch_match_events / fetch_spatial_analysis. Pagination built-in for passes / match_events (1000-row pages,       │
  │                                               │        │ capped at 50k). Raises SupabaseConfigError if creds missing.                                                                                     │
  ├───────────────────────────────────────────────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │                                               │        │ build_raw_bundle(match_id, *, opponent_team_side="away", client=None) -> RawScrapedBundle. Joins match + players + passes + match_events into    │
  │ llm-integration/src/db/bundle.py              │ NEW    │ the existing RawScrapedBundle schema. Hashes team uuid → stable int (stable_int_from_uuid) so the schema's int opponent_id is satisfied. Drops   │
  │                                               │        │ match_events rows whose event_type isn't in the agent's Literal.                                                                                 │
  ├───────────────────────────────────────────────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ llm-integration/tests/test_supabase_reader.py │ NEW    │ 9 tests: credential validation, httpx.MockTransport checks of URL/headers/pagination, bundle joining for both opponent sides, error paths, and a │
  │                                               │        │  live integration test gated on env vars.                                                                                                        │
  ├───────────────────────────────────────────────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ llm-integration/requirements.txt              │ EDIT   │ Added httpx>=0.27.                                                                                                                               │
  ├───────────────────────────────────────────────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ llm-integration/.env.example                  │ EDIT   │ Documents SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and an optional SUPABASE_TEST_MATCH_ID for the live test.                                     │
  └───────────────────────────────────────────────┴────────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

  Test result

  15 passed, 1 skipped in 0.24s

  The skipped one is the live Supabase test — it auto-skips because SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_TEST_MATCH_ID aren't in .env. Set those three to opt in.

  Design choices worth flagging

  - uuid → int hash for opponent_id. The RawScrapedBundle schema (Phase 1 LLM contract) keys teams by int, but Supabase stores team ids as uuids. stable_int_from_uuid (sha256, top 63 bits) is deterministic
  across runs — same team always maps to the same int — without changing the schemas the agents already validate against.
  - No supabase-py dependency. Plain httpx over PostgREST keeps the dep footprint small and works identically against the cloud function's Supabase project.
  - opponent_team_side is a parameter, not auto-detected. Phase 3 (orchestrator) will set it from match context. Defaults to "away" because the reference team is typically the home side.
  - No writes. This module reads only — the cloud function (calculateTxPerPas) owns all writes to passes.xt and spatial_analysis.

  API keys — where they live (and where they don't)

  Phase 2 introduces no new hardcoded keys. Everything reads from environment.

  ┌─────────────────────────────────────────────────────────────────┬────────────────────────────────────────────────────────────────────────────────────────────┬───────────────────────────────────────────┐
  │                               Key                               │                                Where it's consumed in code                                 │              Phase using it               │
  ├─────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────┤
  │ SUPABASE_URL                                                    │ llm-integration/src/db/supabase_client.py:38 (constructor), :42 (raise)                    │ Phase 2 — the reader                      │
  ├─────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────┤
  │ SUPABASE_SERVICE_ROLE_KEY                                       │ llm-integration/src/db/supabase_client.py:39 (constructor), :42 (raise), :50               │ Phase 2 — the reader                      │
  │                                                                 │ (Authorization header)                                                                     │                                           │
  ├─────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────┤
  │ SUPABASE_TEST_MATCH_ID                                          │ llm-integration/tests/test_supabase_reader.py:268                                          │ Optional — opt-in for the live            │
  │                                                                 │                                                                                            │ integration test                          │
  ├─────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────┤
  │ GEMINI_API_KEY                                                  │ llm-integration/src/agents/base.py:22                                                      │ Phase 3+ (LLM phases)                     │
  ├─────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────┤
  │ GOOGLE_GENAI_USE_VERTEXAI / GOOGLE_CLOUD_PROJECT /              │ llm-integration/src/agents/base.py:16-21                                                   │ Alternative auth path on GCP              │
  │ GOOGLE_CLOUD_LOCATION                                           │                                                                                            │                                           │
  ├─────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────┤
  │ LLM_MODEL_VERDICT                                               │ Read in llm-integration/src/agents/verdict.py                                              │ Phase 3 — lets Phase 5 swap to            │
  │                                                                 │                                                                                            │ gemini-2.5-pro                            │
  └─────────────────────────────────────────────────────────────────┴────────────────────────────────────────────────────────────────────────────────────────────┴───────────────────────────────────────────┘

  Loading. llm-integration/tests/conftest.py:11-12 calls load_dotenv(llm-integration/.env) so any pytest in this package picks up keys without manual export. For local pipeline runs, keys load from the same
  .env.

  ⚠️ Pre-existing security flag (still out of scope, unchanged by Phase 2): baza_de_date_json/upload_supabase.py:7-8 still has the Supabase URL and service-role key hardcoded. The ui_schema_design.md plan
  calls this out as a separate cleanup task owned by the database teammate. We did not import or propagate that key into llm-integration/.