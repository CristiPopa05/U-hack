Recap — Phase 5: Tactical Verdict Agent (Final Phase)

  What this agent does: the closing link of the 5-agent chain — the only one whose output the coach reads directly. It synthesises the outputs of Phases 02–04 plus a PitchControlSummary from the math layer
  into a coach-readable brief: headline, narrative summary, 3–6 ranked defensive instructions, and a compact UI schema for the dashboard.

  Files created (4, no edits to existing code):

  1. llm-integration/src/schemas/verdict.py
    - PitchControlAlert, PitchControlSummary — math-layer contract (per-zone control %, xT exposure, severity, defensive line height).
    - TacticalVerdictInput — combines IngestionMetadata + RankedThreatList (Phase 2) + ZonePriorityMap (Phase 3) + BuildupPattern (Phase 4) + PitchControlSummary.
    - DefensiveInstruction — single coaching cue with severity, title, body, optional target player/zones.
    - UISchemaMatrix — verbatim echo of upstream agent outputs for the frontend heatmap overlay.
    - CoachBrief — final output: headline, summary, 3–6 instructions, ui_schema, confidence.
  2. llm-integration/src/agents/verdict.py
    - VERDICT_PROMPT with 8 hard rules. Highlights: rule 1 (verbatim echo of upstream IDs into ui_schema so the dashboard stays mathematically traceable), rule 4 (instructions sorted critical → high → medium →
   info, every body cites a digit and a player/zone), rule 6 (cliché ban — "playmaker", "stay compact", "high press" forbidden unless paired with a number/name), rule 7 (confidence propagation: if
  pattern.confidence < 0.5 then verdict confidence < 0.7).
    - run_tactical_verdict(payload) calls call_structured() with model gemini-2.5-pro (override via LLM_MODEL_VERDICT) — note this is pro not flash, because synthesis depth matters more than throughput here.
  3. llm-integration/tests/fixtures/verdict_input_minimal.json
    - 4 ranked players (Marian Crisan as danger creator @ 0.84 cumulative xT, descending to 0.10).
    - 5 priority zones (1 critical = zone 152, 2 high, 2 medium); critical_corridors = central + right_halfspace.
    - Pattern: central_progression_through_halfspace @ confidence 0.72; key_players reference IDs that exist in threats (9001, 9002).
    - Pitch control: 2 alerts (critical zone 152, high zone 170); avg defensive line height 42.0.
  4. llm-integration/tests/test_verdict_agent.py
    - Asserts: ui_schema echoes match upstream verbatim, instructions count 3–6, severity sorted descending, headline cites a digit, summary cites a digit and a known player name, every target_player_id and
  target_zone_ids references inputs (no fabrication), every instruction body cites a digit, confidence in [0,1].

  Verified:
  - Fixture round-trips through TacticalVerdictInput.model_validate_json cleanly.
  - Full pytest suite collects 5 tests (the LLM-agent track is now complete) — all skip cleanly without GEMINI_API_KEY.

  ---
  API key — where to set it

  Same flow as before, no new services were added in Phase 5:

  1. Copy .env.example → .env (gitignored, holds real secrets).
  2. Fill in:
  GEMINI_API_KEY=your-key-here
  3. Optional override in .env: LLM_MODEL_VERDICT=gemini-2.5-pro (default already, but pinnable).
  4. Run with the env loaded — same patterns as Phase 4:

  4. Bash:
  cd llm-integration
  export $(grep -v '^#' .env | xargs)
  ./venv/Scripts/python.exe -m pytest tests/test_verdict_agent.py -v

  4. PowerShell:
  cd llm-integration
  $env:GEMINI_API_KEY = "your-key-here"
  .\venv\Scripts\python.exe -m pytest tests\test_verdict_agent.py -v

  4. Or run all 5 phases at once: pytest tests/ -v.

  Get the Gemini key from https://aistudio.google.com/apikey. The same key works for all 5 phases via src/agents/base.py::get_client().

  Heads up about cost/latency: Phase 5 uses gemini-2.5-pro instead of flash, so this single test will be noticeably slower and pricier than the others. That's intentional — see the spec: "reasoning depth
  matters more than throughput here."

  Files are untracked — when ready, the spec recommends commit message: Add Phase 5 LLM agent: tactical verdict.

  This closes the LLM-agent track. Per phase-05-tactical-verdict.md §9, the next work moves outside the phases/ folder into the implementation track in llm-integration/overview.md §10: scaffold finalisation,
  the math layer (which produces PitchControlSummary and PassNetworkGraph), the Cloud Function orchestrator (main(request)), gcloud deployment, and the eval harness.