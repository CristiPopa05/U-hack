  Recap — Phase 4: Goal DNA Pattern Recognition Agent

  What this agent does: looks at 1–5 pass-network graphs (each = the 15–20 seconds before an opponent goal) and extracts the single recurring build-up signature explaining how this opponent scores.

  Files created (4, no edits to existing code):

  1. llm-integration/src/schemas/goal_dna.py
    - PassEdge, PassNetworkGraph, GoalDNAInput — the input contract the math layer must honour (player IDs/names, from/to zone IDs in the 0–191 grid, timestamp_offset, weight, is_synthesised flag).
    - BuildupPattern — output schema with constrained literals: PatternSignature (7 allowed values incl. mixed_inconclusive) and PlayerRole (5 roles).
  2. llm-integration/src/agents/goal_dna.py
    - GOAL_DNA_PROMPT with 7 hard rules: signature must be from the literal set, confidence ≤ 0.4 when all input is synthesised, no inventing players or zones, description must cite a zone_id AND a player
  name, etc.
    - run_goal_dna(payload) calls call_structured() from base.py with model gemini-2.5-flash (override via LLM_MODEL_GOAL_DNA).
  3. llm-integration/tests/fixtures/goal_dna_input_minimal.json
    - Standard case: 2 graphs, both is_synthesised: false, distinct match_ids (2001, 2002).
    - Planted recurring shape: player 9001 (Marian Crisan) carrying from halfspace zone 120 → central zone 152 in both goals, both ending in shots from zone 170. This gives the LLM something concrete to
  converge on (likely central_progression_through_halfspace).
  4. llm-integration/tests/test_goal_dna_agent.py
    - Smoke test that skips without credentials; otherwise asserts: signature is in the allowed set, confidence in [0,1], is_based_on_synthesised_input is False, every returned player_id and zone_id appears in
   input edges, description cites a digit and a player name, key_players count between 2 and 4.

  Verified:
  - Fixture round-trips through GoalDNAInput.model_validate_json cleanly.
  - Full pytest suite collects 4 tests — all skip cleanly without GEMINI_API_KEY (same behaviour as Phases 1–3).

  ---
  API key — where to set it

  The agent reads GEMINI_API_KEY from your environment via src/agents/base.py::get_client(). There is no .env file in this repo (the base.py reads os.environ directly), so set it in your shell before running
  pytest:

  Bash (Git Bash / WSL):
  export GEMINI_API_KEY="your-key-here"
  cd llm-integration && ./venv/Scripts/python.exe -m pytest tests/test_goal_dna_agent.py -v

  PowerShell:
  $env:GEMINI_API_KEY = "your-key-here"
  cd llm-integration; .\venv\Scripts\python.exe -m pytest tests/test_goal_dna_agent.py -v

  Optional env vars:
  - LLM_MODEL_GOAL_DNA — override the default gemini-2.5-flash.
  - GOOGLE_GENAI_USE_VERTEXAI=true (with GOOGLE_CLOUD_PROJECT and optionally GOOGLE_CLOUD_LOCATION) — switches base.py to Vertex AI instead of the Developer API. Use this once the cloud function deploys; for
  local dev, sticking with GEMINI_API_KEY is simpler.

  Get the Gemini key from https://aistudio.google.com/apikey (Google AI Studio). The same key works for all 4 phases (1–4) since they all go through base.py.

  Files are untracked — when you're ready, the spec recommends commit message: Add Phase 4 LLM agent: goal DNA pattern recognition.