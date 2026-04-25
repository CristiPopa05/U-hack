 Recap — Phase 1: Data Ingestion Agent

  What I built

  A first-of-five LLM agents whose only job is to validate a scraped match-event bundle and emit a structured metadata summary that downstream agents (xT engine ID, zone analysis, goal DNA, tactical verdict)
  can trust. The agent is a validator, not an analyst — it must never invent matches/players/events.

  Files created

  - llm-integration/requirements.txt — google-genai, pydantic, python-dotenv, pytest
  - llm-integration/.env.example — template for credentials
  - llm-integration/src/schemas/ingestion.py — pinned Pydantic models: RawScrapedBundle (input contract) and IngestionMetadata (output contract), plus their nested types
  - llm-integration/src/agents/base.py — shared scaffold reused by phases 2–5: get_client() (auto-switches between Gemini Developer API and Vertex AI based on env) and call_structured(model, prompt, schema)
  (forces schema-valid JSON via response_mime_type="application/json" + response_schema=<Pydantic class>)
  - llm-integration/src/agents/ingestion.py — run_ingestion(bundle) → IngestionMetadata, with the pinned INGESTION_PROMPT whose hard rules forbid fabrication and pin numerically-checkable invariants
  (total_events, breakdown sums, completeness flags)
  - llm-integration/tests/fixtures/ingestion_bundle_minimal.json — 2 matches, 4 players, 10 events; deliberately includes one pass with null coords, one event with null player_id, and both matches well below
  the 200-event threshold so the agent has things to flag in warnings. Verified to parse against RawScrapedBundle.
  - llm-integration/tests/test_ingestion_agent.py — smoke test that skips if no Gemini creds, otherwise asserts total_events matches, breakdown sums correctly, and warnings is non-empty
  - .gitignore (root) — ignores .env, __pycache__, venv dirs, IDE files
  - __init__.py files across src/, src/agents/, src/schemas/, tests/


  Next step before the smoke test will run live

  pip install -r llm-integration/requirements.txt
  pytest llm-integration/tests/test_ingestion_agent.py -v

  ---
  ⚠️ Where to put your API keys

  Copy llm-integration/.env.example to llm-integration/.env and fill one of the two paths:

  Path A — Gemini Developer API (recommended for hackathon, simplest):
  GEMINI_API_KEY=<your-key-from-https://aistudio.google.com/apikey>

  Path B — Vertex AI on GCP (production-style, uses ADC, no API key in file):
  GOOGLE_GENAI_USE_VERTEXAI=true
  GOOGLE_CLOUD_PROJECT=<your-gcp-project-id>
  GOOGLE_CLOUD_LOCATION=europe-west1

  Optional override: LLM_MODEL_INGESTION=gemini-2.5-flash (default already gemini-2.5-flash).

  .env is already in .gitignore — never commit it. Only .env.example is checked in. When phase 5 wires up the Cloud Function and phase 4 brings in Supabase, additional keys (e.g. SUPABASE_API_KEY) will join
  the same .env file.