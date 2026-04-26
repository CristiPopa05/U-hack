# Plan — Wire 5-Phase LLM Chain to the Frontend (Schema-Driven Panels)

## Context

The project is a hackathon-stage football opponent-analysis tool. The 5 LLM agents (`ingestion`, `xt_engine`, `zones`, `goal_dna`, `verdict`) and their Pydantic schemas are implemented under `llm-integration/src/`. The React frontend (`frontend/`) renders four panels in `src/pages/Analysis.tsx` against **hardcoded mock arrays** (`TACTICAL_VERDICT`, `ALERTS`, `AI_INSIGHTS`, `PLAYMAKERS`, `generateXTGrid`).

There is no orchestrator chaining the 5 phases, no API between Python and React, and no Supabase client inside `llm-integration/` (the only Supabase code lives at `baza_de_date_json/upload_supabase.py` with a hardcoded API key — security flag, but **not in scope** for this plan).

This plan connects the existing pieces with three principles:

1. **Architecture stays as-is.** All 5 LLM phases keep running. The hackathon is in its final stretch — no demoting phases to deterministic Python now.
2. **LLM role = motor + interpreter.** Phases 1–4 produce structured findings; Phase 5 (Gemini 2.5 Pro) writes the coach-readable narrative. Numbers come from the math layer; narrative comes from agents.
3. **Honest Panel D.** The "5-Phase Tactical Verdict" panel is composed from each agent's *own* narrative output — no re-narration by Phase 5.
4. **Schema-driven panels.** Each frontend panel maps to one Pydantic schema and one React renderer keyed by `panel.type`.

## File layout

User constraint: `.py` lives under `llm-integration/src/`; the **API client** (the code the UI calls) lives under `frontend/`. The HTTP **server** lives next to the agents because that's the only place it can import the `run_*` functions.

### Backend — `llm-integration/`

| Path | Status | Purpose |
|---|---|---|
| `src/pipeline.py` | **NEW** | `run_pipeline(match_id: int) -> DashboardPayload`. Chains `run_ingestion → run_xt_engine → run_zone_analysis → run_goal_dna → run_tactical_verdict`, then calls `assemble_dashboard`. |
| `src/db/supabase_client.py` | **NEW** | `fetch_match_bundle(match_id) -> RawScrapedBundle`. Uses `SUPABASE_URL` + `SUPABASE_API_KEY` env vars (no hardcoded keys). HTTP via `httpx`. |
| `src/db/__init__.py` | **NEW** | Package init. |
| `src/schemas/dashboard.py` | **NEW** | `DashboardPayload` root model + per-panel schemas (`XTGridPanel`, `DangerCreatorPanel`, `VulnerabilityAlertsPanel`, `GoalDNAPanel`, `TacticalVerdictPanel`, `PhaseSummary`). Reuses existing schemas (`RankedThreatList`, `ZonePriorityMap`, `BuildupPattern`, `CoachBrief`, `PassNetworkGraph`). |
| `src/assembler.py` | **NEW** | `assemble_dashboard(ingestion, threats, zones, pattern, brief, math_outputs) -> DashboardPayload`. Pure deterministic Python — no LLM calls. Builds the honest Panel D by pulling narrative from each agent's existing output (see "Honest Panel D" below). |
| `src/api/server.py` | **NEW** | FastAPI app. Routes: `GET /api/analysis/{match_id} -> DashboardPayload`, `GET /api/health`. CORS allows `http://localhost:8080` (Vite dev port). |
| `src/api/__init__.py` | **NEW** | Package init. |
| `requirements.txt` | **EDIT** | Add `fastapi>=0.110`, `uvicorn[standard]>=0.27`, `httpx>=0.27`. |
| `tests/test_pipeline_e2e.py` | **NEW** | Runs full chain on a fixture match, asserts `DashboardPayload` validates and every panel is non-empty. Skipped if `GEMINI_API_KEY` absent. |

### Frontend — `frontend/`

| Path | Status | Purpose |
|---|---|---|
| `src/lib/api/types.ts` | **NEW** | TypeScript types mirroring `DashboardPayload` and per-panel shapes. Manual port of the Pydantic schemas (hackathon scope; codegen optional later). |
| `src/lib/api/client.ts` | **NEW** | `fetchDashboard(matchId: number): Promise<DashboardPayload>`. Reads `VITE_API_BASE_URL` (default `http://localhost:8000`). |
| `src/hooks/useDashboard.ts` | **NEW** | React Query hook wrapping `fetchDashboard`. TanStack Query 5 is already in `package.json` — reuse it; no new deps. |
| `src/components/panels/XTGridPanel.tsx` | **NEW** | Renderer for `panel.type === "xt_grid"`. Lifted from current Pitch + `generateXTGrid` logic in `Analysis.tsx`. |
| `src/components/panels/DangerCreatorPanel.tsx` | **NEW** | Renderer for `panel.type === "danger_creator"`. Lifted from current Panel B. |
| `src/components/panels/VulnerabilityAlertsPanel.tsx` | **NEW** | Renderer for `panel.type === "vulnerability_alerts"`. Lifted from current Panel C. |
| `src/components/panels/GoalDNAPanel.tsx` | **NEW** | Renderer for `panel.type === "goal_dna_network"`. Lifted from current Pitch network layer. |
| `src/components/panels/TacticalVerdictPanel.tsx` | **NEW** | Renderer for `panel.type === "tactical_verdict"`. Lifted from current Panel D — but iterates `panels.phases` from the API instead of the hardcoded `TACTICAL_VERDICT` array. |
| `src/pages/Analysis.tsx` | **EDIT** | Replace mock imports with `useDashboard(matchId)`. Keep the existing pipeline-loading overlay and "Match window" selector. Replace direct rendering with a panel registry: `panels.map(p => RENDERERS[p.type](p))`. |
| `src/lib/mock-data.ts` | **EDIT** | Keep `TEAMS` (still static — team list isn't from Supabase yet). Delete `ALERTS`, `AI_INSIGHTS`, `PLAYMAKERS`, `MADE_PASSES_*`, `generateXTGrid`, `generateHeatmap`, `PASS_NODES`, `PASS_LINKS` once the API replaces them. |

## DashboardPayload (the contract)

```
DashboardPayload {
  match_id: int
  generated_at: datetime
  schema_version: "1"
  panels: list[Panel]   # discriminated union by .type
}
```

Five panel types, one schema each, in the order Panel A → D from `Analysis.tsx`:

- **`xt_grid`** — `grid: float[12][16]`, `range: {min, max}`, `max_xt_zone_id: int`. Source: `spatial_analysis` table, row where `match_id = ? AND entity_id = opponent_team_id AND type = 'TEAM'`. The cloud function `calculateTxPerPas` (POST mode) writes this — see `cloud_function_architecture.md`. No stub needed.
- **`danger_creator`** — `players: list[{player_id, name, position, minutes, total_xt_value, max_xt_zone_id, passes, assists, is_primary}]`. Source: `spatial_analysis` rows of `type = 'PLAYER'` for the opponent team, sorted by `total_xt_value` descending, joined with `players` for name/position. Phase 2 `RankedThreatList` selects `is_primary` and provides the LLM-authored framing; the numbers are deterministic from `spatial_analysis`.
- **`vulnerability_alerts`** — `alerts: list[DefensiveInstruction]` directly from `CoachBrief.instructions`. **LLM-authored**, already constrained by `VERDICT_PROMPT` HARD RULES.
- **`goal_dna_network`** — `graph: PassNetworkGraph`, `pattern: BuildupPattern`. Coordinates deterministic; `BuildupPattern.description` and `pattern_signature` LLM-authored.
- **`tactical_verdict`** — `phases: list[PhaseSummary]` where `PhaseSummary = {phase_label, title, body, source}`. **Honest option** — see below.

## Honest Panel D — assembly rules

The assembler builds `phases` by pulling narrative from each prior agent's *own* output. No re-narration:

| Card | `body` source | `source` field |
|---|---|---|
| Phase 1 & 2 — Engine / xT Attribution | Top entry of `RankedThreatList.ranked_players` formatted with name + xT/90 + passes-broken-line count | `xt_engine` |
| Phase 3 — Zone Analysis | First critical entry of `ZonePriorityMap.priority_zones` + corridor name | `zones` |
| Phase 4 — Goal DNA | `BuildupPattern.description` verbatim | `goal_dna` |
| Phase 5 — Tactical Verdict | `CoachBrief.headline` + first sentence of `CoachBrief.summary` | `verdict` |

If a coach asks "what does each phase contribute," the answer is literal: each card is that phase's own conclusion.

## Business logic — end-to-end flow

```
[ User clicks Start Analysis on /analysis/:teamId ]
            │
            ▼
[ Frontend resolves match_id from team_id + match_window selector ]
            │
            ▼
[ GET /api/analysis/{match_id}  (FastAPI in llm-integration/src/api/) ]
            │
            ▼
  run_pipeline(match_id):
    1. bundle = fetch_match_bundle(match_id)            # Supabase: matches, players, passes, match_events
    2. spatial = fetch_spatial_analysis(match_id)       # Supabase: spatial_analysis (cloud-fn output)
    3. ingestion = run_ingestion(bundle)                # LLM (Flash)
    4. threats   = run_xt_engine(XTEngineInput)         # LLM (Flash)
    5. zones     = run_zone_analysis(ZoneAnalysisInput) # LLM (Flash)
    6. pattern   = run_goal_dna(GoalDNAInput)           # LLM (Flash)
    7. brief     = run_tactical_verdict(TVInput)        # LLM (Pro)
    8. payload   = assemble_dashboard(..., spatial)     # deterministic
            │
            ▼
[ Frontend: panels.map(p => RENDERERS[p.type](p)) ]
```

**LLM vs deterministic boundary inside the dashboard:**
- LLM-authored: `vulnerability_alerts.alerts`, `goal_dna_network.pattern.description`, `tactical_verdict.phases[*].body`, the per-phase narrative bits.
- Deterministic: `xt_grid.grid`, `danger_creator.players`, `goal_dna_network.graph` coordinates, all numeric stats.

## Stack

- **Python** 3.10+ — `pydantic 2`, `google-genai>=1.33`, `fastapi`, `uvicorn`, `httpx`. Phase 5 model: `LLM_MODEL_VERDICT=gemini-2.5-pro` (one-line env change — `verdict.py:40` already reads this var). Phases 1–4 stay on Flash.
- **Frontend** — Vite 5 + React 18 + React Router 6 + TanStack Query 5 + shadcn/ui (all already installed).
- **Pipeline scope** — single `match_id` per run (per user choice). Match-window selector triggers N parallel calls; aggregation client-side via React Query.

## Pattern classification

This is **prompt chaining** (Anthropic, *Building Effective Agents*): a fixed sequence of LLM calls where each step's typed output gates the next step's input. Pydantic validation between phases is the deterministic gate. It is **not** an agent loop (the LLM never decides the next step) and **not** parallelization (the chain is sequential; only the match-window fan-out is parallel).

## Verification

1. **Unit / contract test** — `pytest llm-integration/tests/test_pipeline_e2e.py`. Loads a fixture match, runs full chain, asserts:
   - `DashboardPayload` validates against its Pydantic schema
   - Every panel type is present
   - `tactical_verdict.phases` has 4 entries with non-empty `body`
   - `vulnerability_alerts.alerts[*].target_zone_ids` are all referenced in the upstream `ZonePriorityMap`
2. **Manual integration check** —
   - Terminal A: `cd llm-integration && uvicorn src.api.server:app --reload --port 8000`
   - Terminal B: `cd frontend && bun dev`
   - Open `http://localhost:8080/analysis/cfr`, click **Start Analysis**, confirm:
     - All four panels render API data (not mocks)
     - Panel D shows four distinct phase narratives, each pulling from its source agent
     - Panel C alerts each cite a `target_zone_id` and a player
     - Network tab shows one `GET /api/analysis/{id}` call, not multiple
3. **Demo safety** — pre-run `run_pipeline()` for the matches you'll demo and dump JSON to `llm-integration/cache/demo_<match_id>.json`. Add a `?demo=1` query flag to `/api/analysis/{match_id}` that serves from disk. Avoids Pro latency on stage.

## Cloud function integration

The math layer is **already implemented** as a Google Cloud Function (`calculateTxPerPas`, owned by the cloud teammate; spec in `cloud_function_architecture.md`). It runs in two modes against Supabase:

- **GET** — computes `passes.xt` for unprocessed rows.
- **POST `{match_id}`** — writes `spatial_analysis` rows (`xt_matrix`, `total_xt_value`, `max_xt_zone_id`) per player and per team.

**Trigger chain (full system):**

```
1. Scraper produces JSON ─► inserts into Supabase (passes with xt=0, players, matches, match_events)
2. Scraper hits Cloud Fn GET   ─► passes.xt populated
3. Scraper hits Cloud Fn POST  ─► spatial_analysis populated
4. [event listener — colleague's job, not ours] ─► triggers our pipeline
5. Our run_pipeline(match_id) reads enriched Supabase data ─► writes DashboardPayload (returns to UI)
```

We **do not** build step 4. Our FastAPI endpoint is callable both by an eventual Supabase webhook and directly by the frontend, so we are not blocked by the listener.

## Out of scope (flagged, not implemented here)

- The Supabase → pipeline event listener (step 4 above) — cloud teammate's responsibility.
- Migrating the hardcoded Supabase API key in `baza_de_date_json/upload_supabase.py`. Security flag — handle separately.
- pgvector / similarity search across past verdicts (`PROJECT.md` Section 5). Not required for the dashboard MVP.
- Auth on the FastAPI endpoint. Hackathon scope; add before any public deployment.

## Phase breakdown (execution plan)

Six phases, ordered. Each phase is independently testable and roughly one PR's worth of work. Do **not** start the next phase until the current one's "Done when" is satisfied.

### Phase 1 — Dashboard schemas + assembler (offline)

- **Goal.** Lock the contract before any infrastructure work. Build the data shape the UI will consume.
- **Files.**
  - **NEW** `llm-integration/src/schemas/dashboard.py` — `DashboardPayload`, `XTGridPanel`, `DangerCreatorPanel`, `VulnerabilityAlertsPanel`, `GoalDNAPanel`, `TacticalVerdictPanel`, `PhaseSummary`, discriminated union by `panel.type`.
  - **NEW** `llm-integration/src/assembler.py` — `assemble_dashboard(ingestion, threats, zones, pattern, brief, spatial_team_row, spatial_player_rows, players_by_id) -> DashboardPayload`. Pure deterministic Python.
  - **NEW** `llm-integration/tests/test_assembler.py` — feeds hand-crafted Pydantic inputs, asserts every panel type is present and the honest-Panel-D mapping (Phase 1&2/3/4/5 cards) pulls from the correct source.
- **Dependencies.** None. No Supabase, no FastAPI, no LLM calls.
- **Done when.** `pytest tests/test_assembler.py` passes and `DashboardPayload.model_validate_json(...)` round-trips a fixture.

### Phase 2 — Supabase reader

- **Goal.** Read everything the pipeline needs from Supabase, build the typed inputs each phase consumes.
- **Files.**
  - **NEW** `llm-integration/src/db/__init__.py`, `llm-integration/src/db/supabase_client.py` — `httpx`-based REST client. Functions: `fetch_match(match_id)`, `fetch_players(match_id)`, `fetch_passes(match_id)`, `fetch_match_events(match_id)`, `fetch_spatial_analysis(match_id)`. Reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env vars (matching the cloud function's naming).
  - **NEW** `llm-integration/src/db/bundle.py` — `build_raw_bundle(match_id) -> RawScrapedBundle` (existing schema in `src/schemas/ingestion.py`).
  - **EDIT** `llm-integration/requirements.txt` — add `httpx>=0.27`.
  - **NEW** `llm-integration/tests/test_supabase_reader.py` — hits a live Supabase against a known match_id, asserts shapes (skipped if env vars absent).
- **Dependencies.** Phase 1 schemas exist (the reader doesn't depend on them but the next phases will).
- **Done when.** Given a real `match_id` already populated by the cloud function, all five fetch functions return non-empty data and `build_raw_bundle` validates.

### Phase 3 — Pipeline orchestrator

- **Goal.** Chain the 5 phases end-to-end and produce a `DashboardPayload`.
- **Files.**
  - **NEW** `llm-integration/src/pipeline.py` — `run_pipeline(match_id: int) -> DashboardPayload`. Calls reader → 5 agents → assembler. Threads the `spatial_analysis` rows into the assembler.
  - **EDIT** `.env.example` (or wherever env is documented) — set `LLM_MODEL_VERDICT=gemini-2.5-pro`. Phases 1–4 stay on Flash.
  - **NEW** `llm-integration/tests/test_pipeline_e2e.py` — runs the full chain on one fixture match. Skipped if `GEMINI_API_KEY` absent.
- **Dependencies.** Phases 1, 2.
- **Done when.** `python -c "from src.pipeline import run_pipeline; print(run_pipeline(<id>).model_dump_json())"` produces a valid payload with all five panels populated.

### Phase 4 — FastAPI server

- **Goal.** Expose the pipeline over HTTP for the frontend.
- **Files.**
  - **NEW** `llm-integration/src/api/__init__.py`, `llm-integration/src/api/server.py` — FastAPI app. Routes: `GET /api/health`, `GET /api/analysis/{match_id}` (calls `run_pipeline`), `GET /api/analysis/{match_id}?demo=1` (serves cached JSON from `llm-integration/cache/`). CORS allows `http://localhost:8080`.
  - **EDIT** `llm-integration/requirements.txt` — add `fastapi>=0.110`, `uvicorn[standard]>=0.27`.
  - **NEW** `llm-integration/cache/.gitkeep` — directory for demo payloads.
- **Dependencies.** Phase 3.
- **Done when.** `uvicorn src.api.server:app` starts; `curl localhost:8000/api/analysis/<id>` returns a valid `DashboardPayload`; `?demo=1` serves cached JSON without invoking the LLM.

### Phase 5 — Frontend types, client, panel components

- **Goal.** Build the UI side of the contract without yet wiring it to live data.
- **Files.**
  - **NEW** `frontend/src/lib/api/types.ts` — manual TypeScript port of `DashboardPayload` and per-panel schemas.
  - **NEW** `frontend/src/lib/api/client.ts` — `fetchDashboard(matchId)` using `VITE_API_BASE_URL` (default `http://localhost:8000`).
  - **NEW** `frontend/src/hooks/useDashboard.ts` — TanStack Query wrapper.
  - **NEW** `frontend/src/components/panels/{XTGrid,DangerCreator,VulnerabilityAlerts,GoalDNA,TacticalVerdict}Panel.tsx` — each lifted from the corresponding section of the current `Analysis.tsx`, props match the schema.
- **Dependencies.** Phase 1 (so the TS types mirror the Pydantic ones).
- **Done when.** Each panel component renders against hand-crafted props in isolation (e.g. a Storybook-like dev page or a temporary `/panels-demo` route); `useDashboard` returns data when pointed at the FastAPI from Phase 4.

### Phase 6 — Wire it up + delete mocks + demo cache

- **Goal.** Replace mock data with live API and prepare the demo.
- **Files.**
  - **EDIT** `frontend/src/pages/Analysis.tsx` — replace `TEAMS`/`PLAYMAKERS`/`ALERTS`/`TACTICAL_VERDICT`/`generateXTGrid` imports with `useDashboard(matchId)`. Render via the panel registry: `panels.map(p => RENDERERS[p.type](p))`. Keep the loading overlay; show real progress if streaming, otherwise the existing fake steps.
  - **EDIT** `frontend/src/lib/mock-data.ts` — keep `TEAMS`, delete `ALERTS`, `AI_INSIGHTS`, `PLAYMAKERS`, `MADE_PASSES_*`, `generateXTGrid`, `generateHeatmap`, `PASS_NODES`, `PASS_LINKS`.
  - **NEW** `llm-integration/cache/demo_<match_id>.json` per match in the demo script — pre-run `run_pipeline()`, dump the payload.
- **Dependencies.** Phases 4, 5.
- **Done when.** `bun dev` + `uvicorn` running, click **Start Analysis** in the UI, all four panels render real data; toggling `?demo=1` works for the demo matches.
