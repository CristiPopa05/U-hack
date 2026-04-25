 Recap — Phase 2: xT Engine Identification Agent

  What I built

  The second agent in the 5-agent chain. Its job: from per-player xT aggregates (which the math layer in Phase 4 will eventually compute), produce a ranked threat list and identify exactly one danger creator —
   the opponent player to mark tightly, even if they have zero goals. The agent contributes judgment + narrative, never arithmetic — the spec forbids re-summing or altering cumulative_xt, and forces every
  reasoning string to cite a concrete number from the input.

  Files created (everything from Phase 1 reused as-is)

  - llm-integration/src/schemas/xt_engine.py — pinned models:
    - Input: TopPassExample, PlayerXTAggregate, XTEngineInput (which embeds IngestionMetadata from Phase 1)
    - Output: PlayerThreatEntry, RankedThreatList (with dense ranks, single danger creator, ≤2 secondary targets)
  - llm-integration/src/agents/xt_engine.py — run_xt_engine(payload) → RankedThreatList, using the shared call_structured helper from Phase 1's base.py. The prompt's hard rules:
    a. echo cumulative_xt verbatim (no arithmetic drift),
    b. default sort by cumulative_xt desc, override only with stated tactical reason,
    c. exactly one is_danger_creator and they're rank 1,
    d. every reasoning cites a concrete number,
    e. secondary targets ≤2 only when data clearly supports it.
  - llm-integration/tests/fixtures/xt_engine_input_minimal.json — stub for the math layer:
    - Player A (101, Andrei Popescu) — clear engine, cum_xt=0.84, 35 passes, top deltas 0.18/0.12/0.07
    - Player B (202, Vlad Stan) — volume trap, cum_xt=0.71 but avg only 0.0084, 85 passes (the LLM should rank this #2, not get fooled)
    - Player C (102, Mihai Ionescu) — low-volume killer, cum_xt=0.32 but avg=0.046, top delta 0.20 (plausible secondary target)
    - Player D (201, Cristian Dumitru) — filler, cum_xt=0.05
    - Spans both team_side values, sorted desc by cum_xt as the contract requires. Verified to parse against XTEngineInput.
  - llm-integration/tests/test_xt_engine_agent.py — smoke test asserting:
    - exactly one danger creator, who is rank 1 and matches danger_creator_id,
    - dense ranks [1..N],
    - every cumulative_xt echoed verbatim from input (no drift),
    - every reasoning contains at least one digit (proxy for "cites a number"),
    - secondary targets ≤2 and disjoint from danger creator.

  Untouched: src/agents/base.py, src/schemas/ingestion.py, requirements.txt, .env.example. The Phase 1 scaffold was already sufficient.

  Out of scope (kept untouched, per spec §8): Phases 3–5, math-layer implementation, Supabase, Cloud Function entrypoint, retries (orchestrator concern), frontend.

  Run the live test once before considering Phase 2 done

  pytest llm-integration/tests/test_xt_engine_agent.py -v
  pytest llm-integration/tests/ -v   # full suite, also re-runs Phase 1

  If a structural assertion fails, fix the prompt — the spec explicitly forbids loosening assertions. (If you hit a Gemini structured-output gotcha analogous to the Phase 1 additionalProperties issue, the same
   pattern applies: make the schema explicit and/or post-process the deterministic invariant in run_xt_engine.)

  ---
  ⚠️ Where to put your API keys

  No new keys required for Phase 2. It reuses the same Gemini credentials configured in Phase 1.

  In llm-integration/.env, you should already have one of:

  Path A — Gemini Developer API (recommended):
  GEMINI_API_KEY=<your-key-from-https://aistudio.google.com/apikey>

  Path B — Vertex AI on GCP:
  GOOGLE_GENAI_USE_VERTEXAI=true
  GOOGLE_CLOUD_PROJECT=<your-gcp-project-id>
  GOOGLE_CLOUD_LOCATION=europe-west1

  Optional model override for this phase only (defaults to gemini-2.5-flash):
  LLM_MODEL_XT_ENGINE=gemini-2.5-flash

  .env remains gitignored. No Supabase, no third-party services touched in this phase — Phase 3 (Zone Analysis) will follow the same pattern, and Phase 4 (Goal DNA) is when Supabase keys come into play.