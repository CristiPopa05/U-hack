 Recap — Phase 3: Zone Analysis Agent

  What I built

  The third agent in the 5-agent chain. It receives pre-aggregated stats for all 192 cells of the 16×12 pitch grid (math layer's job in Phase 4) and produces a sparse priority map: only zones that exceed
  numeric thresholds, each tagged critical/high/medium, plus the 1–3 most critical corridors. The output drives the frontend heatmap and gives the Phase 5 verdict spatial citations.

  The agent is constrained to judgment + naming, never arithmetic: thresholds are explicit in the prompt, echoed fields (zone_id, grid_x, grid_y, corridor) must come verbatim from the input, and every
  reasoning string must cite a concrete number.

  Files created (no edits to Phase 1 / 2 modules)

  - llm-integration/src/schemas/zones.py — pinned models:
    - Input: ZoneAggregate (per-cell stats including the math-layer-assigned corridor), ZoneAggregates (min_length=192, max_length=192), ZoneAnalysisInput (embeds IngestionMetadata from Phase 1)
    - Output: ZonePriority, ZonePriorityMap (sparse priority_zones, critical_corridors with 1–3 entries, summary)
    - Type aliases: Corridor (5 values: left_wing / left_halfspace / central / right_halfspace / right_wing), Priority (3 values).
  - llm-integration/src/agents/zones.py — run_zone_analysis(payload) → ZonePriorityMap using call_structured from Phase 1's base.py. Prompt's hard rules:
    a. Numeric priority thresholds baked into the prompt: critical ⇐ xt_sum ≥ 0.30 OR shot_count ≥ 3; high ⇐ xt_sum ≥ 0.15 OR pass_dest ≥ 20; medium ⇐ xt_sum ≥ 0.05 OR pass_dest ≥ 8. Below all → omit.
    b. Echoed fields must match input verbatim — no fabricated zones, no relabelled corridors.
    c. critical_corridors ranked by combined xt_sum across each corridor's 32 cells, descending.
    d. Every reasoning sentence cites a number; no clichés.
    e. summary mentions a corridor name or zone_id.
  - llm-integration/tests/fixtures/zones_input_minimal.json — generated programmatically:
    - All 192 cells present, zone_id = grid_y * 16 + grid_x, corridors mapped from the canonical 16-element list.
    - Planted: zone 168 central (xt_sum=0.42, shot=4 → critical), zones 173 & 157 right_wing (xt_sum=0.20 / 0.18, pass_dest=22/25 → high), zones 152 central and 131 left_halfspace (xt_sum=0.07 / 0.06 →
  medium). Everything else zeroed.
    - Verified to parse against ZoneAnalysisInput.
  - llm-integration/tests/test_zones_agent.py — smoke test asserting:
    - sparsity (3 ≤ priority_zones ≤ 30, well under 192),
    - critical_corridors size 1–3,
    - every echoed (zone_id, grid_x, grid_y, corridor) matches the input row exactly (no drift),
    - every reasoning contains a digit,
    - summary mentions a corridor name or a digit.

  Untouched: src/agents/base.py, src/schemas/ingestion.py, src/schemas/xt_engine.py, requirements.txt, .env.example.

  Out of scope (kept untouched, per spec §8): Phases 4–5, math-layer implementation, frontend heatmap rendering, Supabase, retries / orchestrator concerns.

  Run before considering Phase 3 done

  pytest llm-integration/tests/test_zones_agent.py -v
  pytest llm-integration/tests/ -v   # full suite — Phases 1, 2, 3 must all pass

  If a structural assertion fails, fix the prompt — the spec explicitly forbids loosening assertions. If you hit a Gemini structured-output gotcha (Phase 1 had the additionalProperties issue), apply the same
  pattern: tighten the schema and/or post-process deterministic invariants in run_zone_analysis.

  ---
  ⚠️ Where to put your API keys

  No new keys required for Phase 3. It reuses the same Gemini credentials configured in Phase 1.

  In llm-integration/.env, you should already have one of:

  Path A — Gemini Developer API:
  GEMINI_API_KEY=<your-key-from-https://aistudio.google.com/apikey>

  Path B — Vertex AI on GCP:
  GOOGLE_GENAI_USE_VERTEXAI=true
  GOOGLE_CLOUD_PROJECT=<your-gcp-project-id>
  GOOGLE_CLOUD_LOCATION=europe-west1

  Optional model override for this phase only (defaults to gemini-2.5-flash):
  LLM_MODEL_ZONES=gemini-2.5-flash

  .env remains gitignored. No Supabase, no third-party services touched in this phase — Phase 4 (Goal DNA) is the next agent in the chain; the math layer / Supabase keys come into play later in the
  implementation track.