# Implementation Overview — LLM Layer & Cloud Hosting

> **Note for Claude Code and human contributors.** This file is the **implementation contract** for the LLM/cloud layer of the project. It pins the stack, the wiring shape between agents, and the deployment target. It is **not** the spec — that lives in `PROJECT.md`.
>
> Detailed step-by-step work is broken out into `phases/phase-XX-*.md` files (see [Phase Index](#10-phase-index) at the bottom). **Each phase file is a self-contained, strict task spec.** When you start work, open the relevant phase file and treat it as the single source of truth for that step. Do not improvise across phases.
>
> Companion documents:
> - `PROJECT.md` — product spec, math model, team boundaries (authoritative for *what*).
> - `CLAUDE.md` — repo rules and architectural guardrails (authoritative for *how to work here*).

---

## 1. Locked Decisions

These four decisions are fixed for the rest of the implementation. Phase files inherit them.

| # | Decision | Value |
|---|---|---|
| 1 | **LLM access path** | `google-genai` Python SDK as the abstraction. The same SDK supports both **Vertex AI** and the **Gemini Developer API**; switch via `GOOGLE_GENAI_USE_VERTEXAI=true`. Hackathon default = Developer API. Demo/production = Vertex AI. |
| 2 | **Agent orchestration** | Plain Python sequential chain. Each phase is a function that calls `client.models.generate_content(...)` with a Pydantic `response_schema`, then passes its parsed output to the next. No LangGraph, no ADK. |
| 3 | **Math layer placement** | xT + Pitch Control run **inside the same Cloud Function**, before LLM Phase 1. One HTTP request → read Supabase → math → 5 agents → write verdict. |
| 4 | **Trigger** | HTTP (sync), Cloud Functions Gen 2, called by the frontend. |

---

## 2. Architecture

```
┌───────────────────┐
│  Frontend (UI)    │  React/Next.js dashboard (Member 1)
│  POST /analyze    │
└─────────┬─────────┘
          │  HTTP JSON: { opponent_id, match_window }
          ▼
┌────────────────────────────────────────────────────────┐
│        Google Cloud Function (Gen 2, HTTP, Python)     │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ 1. Supabase read   (match_events for window)     │  │
│  │ 2. Math layer      (xT 16×12 grid + Pitch Ctrl)  │  │
│  │ 3. Agent 1: Data Ingestion                       │  │
│  │ 4. Agent 2: xT Engine ID                         │  │
│  │ 5. Agent 3: Zone Analysis                        │  │
│  │ 6. Agent 4: Goal DNA                             │  │
│  │ 7. Agent 5: Tactical Verdict                     │  │
│  │ 8. Supabase write  (llm_verdicts row)            │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  Calls Gemini via `google-genai` SDK                   │
│  Secrets via `--set-secrets` → Secret Manager          │
└─────────────────────────────┬──────────────────────────┘
                              │
                              ▼
                  ┌────────────────────────┐
                  │  Supabase (Postgres)   │
                  │  + pgvector            │
                  └────────────────────────┘
```

This mirrors `PROJECT.md` §3 but adds the runtime/host boundaries: everything inside the dashed box is a single function deployment.

---

## 3. Stack

| Layer | Choice | Version / ID | Why |
|---|---|---|---|
| Runtime | **Google Cloud Functions Gen 2** | `gcloud functions deploy` (Gen 2 is now the default) | "Use Google products" requirement; Gen 2 supports up to 60 min HTTP timeouts and `--set-secrets` GA. |
| LLM SDK | **`google-genai` Python SDK** | `/googleapis/python-genai` v1.33.0+ | Unified SDK for both Vertex AI and Gemini Developer API. Replaces the **deprecated** `google-generativeai` package. |
| Model (phases 1–4) | **`gemini-2.5-flash`** | latest | Fast, cheap, sufficient for structured ingestion / ranking / zone analysis. |
| Model (phase 5) | **`gemini-2.5-pro`** | latest | Reasoning depth matters most for the coach-facing verdict. Overridable via env var `LLM_MODEL_VERDICT`. |
| Structured output | `response_mime_type='application/json'` + `response_schema=<Pydantic class>` | google-genai v1.x | Guaranteed schema-valid JSON; parsed via `Model.model_validate_json(response.text)`. Single pattern reused across all 5 agents. |
| Math libs | **NumPy + Pandas** | latest stable | xT 16×12 grid math + Pitch Control. CPU-only; no GPU needed (per `PROJECT.md` §2). |
| DB client | **`supabase-py`** | `/supabase/supabase-py` latest | Reads `match_events`, writes `llm_verdicts`, queries `pgvector` for build-up similarity. |
| Embeddings store | **pgvector** inside Supabase | — | Phase 5 build-up patterns + verdict embeddings. Wired in phase 07. |
| Secrets | **Secret Manager** via `--set-secrets` | GCP GA flag | No plaintext keys in source. Binds `GEMINI_API_KEY`, `SUPABASE_SERVICE_KEY`, optional Vertex SA JSON. |
| Local dev | **`functions-framework`** (Python) | latest | Runs the function on `localhost:8080` exactly as it would run in GCP. |
| Language | **Python 3.12** | `--runtime python312` | Matches the existing `convert_json_to_csv/seed.py` style; widely supported on Cloud Functions Gen 2. |

> **Removed from stack:** YOLO, OpenCV, video-frame pipelines, GPU instances. Data is scraped, not extracted from video (`PROJECT.md` §2).

---

## 4. The 5 Agents — Code-Shape Contract

Every agent has the same call shape:

```python
response = client.models.generate_content(
    model=<model_for_phase>,
    contents=<prompt_built_from_input_dataclass>,
    config=types.GenerateContentConfig(
        response_mime_type='application/json',
        response_schema=<OutputSchema>,    # Pydantic class
    ),
)
parsed = OutputSchema.model_validate_json(response.text)
```

The table below is the **I/O contract**. The actual prompt text is owned by `phases/phase-03-agent-prompts.md`. The actual Pydantic class definitions are owned by `phases/phase-02-data-contracts.md`.

| # | Agent | Input class | Output class | Model | Prompt strategy (1-line) |
|---|---|---|---|---|---|
| 1 | **Data Ingestion** | `RawScrapedBundle` (events + match metadata) | `IngestionMetadata` (matches covered, players present, completeness flags, warnings) | `gemini-2.5-flash` | Validation-style prompt: "Inspect this dataset, list what is present and what is missing, do not invent matches." |
| 2 | **xT Engine ID** | `IngestionMetadata` + `PassWithXT[]` (math layer output) | `RankedThreatList` (player → cumulative xT + reasoning + `is_danger_creator` flag) | `gemini-2.5-flash` | Ranking prompt grounded in concrete xT deltas; the "engine" is the highest cumulative xT, not the top scorer. |
| 3 | **Zone Analysis** | `IngestionMetadata` + `ZoneAggregates` (per-zone pass count + xT) | `ZonePriorityMap` (192 zones → priority + corridor classification) | `gemini-2.5-flash` | Zone-priority prompt referencing the 16×12 grid; output drives the heatmap and the "pitch is split into squares" view from `CLAUDE.md`. |
| 4 | **Goal DNA** | Last-5-goals `PassNetworkGraph[]` (or "potential scoring attack" graph if no goals scored) | `BuildupPattern` (signature + confidence score + sample goal IDs) | `gemini-2.5-flash` | Pattern-extraction prompt over overlaid graphs; if 0 goals were scored in the window, work from a synthesised representative attack. |
| 5 | **Tactical Verdict** | Outputs of agents 2–4 | `CoachBrief` (plain-language summary + `UISchema` matrix + cited xT/zone/player references) | `gemini-2.5-pro` | Coach-facing brief constrained to cite concrete numbers — no clichés. This is the only agent whose output is shown directly to the user. |

Phase 5's `CoachBrief` is what the frontend renders. Agents 1–4 exist solely to ground it in evidence.

---

## 5. Cloud Function Entrypoint Shape

Pseudocode for `main(request)`. The real implementation lands in `phases/phase-05-cloud-function-glue.md`.

```python
def main(request):
    # 1. Parse + validate request body
    body = request.get_json()  # { "opponent_id": str, "match_window": [str, str] }

    # 2. Pull scraped events from Supabase
    events = supabase_client.fetch_events(body["opponent_id"], body["match_window"])

    # 3. Math layer (NumPy / Pandas)
    passes_with_xt = math.compute_xt_deltas(events)
    zone_aggregates = math.aggregate_by_zone(passes_with_xt)
    pitch_control   = math.compute_pitch_control(events)
    goal_graphs     = math.extract_last_n_goal_networks(events, n=5)

    # 4. Sequential 5-agent chain
    ingestion = agent_1_ingestion(events_meta=...)
    ranked    = agent_2_xt_engine(ingestion, passes_with_xt)
    zones     = agent_3_zone_analysis(ingestion, zone_aggregates)
    dna       = agent_4_goal_dna(goal_graphs)
    verdict   = agent_5_verdict(ranked, zones, dna, pitch_control)

    # 5. Persist + return
    supabase_client.insert_verdict(opponent_id=body["opponent_id"], verdict=verdict)
    return verdict.model_dump_json(), 200, {"Content-Type": "application/json"}
```

Each `agent_N_*` function follows the same call shape from §4. No retries / no backoff at this layer — error handling is owned by phase 05.

---

## 6. Deployment

The full `gcloud` command lives in `phases/phase-06-deployment.md`. Skeleton for reference:

```bash
gcloud functions deploy analyze-opponent \
  --gen2 \
  --runtime=python312 \
  --region=europe-west1 \
  --source=. \
  --entry-point=main \
  --trigger-http \
  --allow-unauthenticated \           # only for hackathon demo; tighten later
  --memory=1Gi \
  --timeout=540s \
  --set-secrets=GEMINI_API_KEY=gemini-api-key:latest,SUPABASE_SERVICE_KEY=supabase-service-key:latest
```

- **`--gen2`** is now the default for `gcloud functions deploy`, but pass it explicitly so older `gcloud` versions in CI don't fall back to Gen 1.
- **`--memory=1Gi`** gives the math layer headroom for NumPy ops over a full 5–10 match window.
- **`--timeout=540s`** is conservative; Gen 2 HTTP supports up to 3600s if scraping or Phase 5 needs more. Tune later.
- **`--set-secrets`** binds Secret Manager entries directly to env vars at runtime — never commit a key file.

To switch to Vertex AI for the demo, add:
```
--set-env-vars=GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_PROJECT=<id>,GOOGLE_CLOUD_LOCATION=europe-west1
```
and remove `GEMINI_API_KEY`. The same Python code keeps working — that is the point of `google-genai` as the abstraction.

---

## 7. Local Development

```bash
pip install -r requirements.txt
functions-framework --target=main --source=main.py --debug
# Function listens on http://localhost:8080
```

Minimum `requirements.txt` shape (final list owned by phase 01):

```
functions-framework
google-genai>=1.33.0
supabase
pydantic>=2
numpy
pandas
```

Local-only env (do **not** commit):
```
GEMINI_API_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
# Optional, to mirror prod path:
# GOOGLE_GENAI_USE_VERTEXAI=true
# GOOGLE_CLOUD_PROJECT=...
# GOOGLE_CLOUD_LOCATION=europe-west1
```

---

## 8. Evaluation Harness (Placeholder)

Member 3's responsibility per `PROJECT.md` §6. Wired in `phases/phase-07-eval-harness.md`. Goal: 5–10 fixed scraped JSON fixtures + golden expected `CoachBrief` shapes. Re-run on every prompt change to catch regressions before they reach the dashboard.

---

## 9. Cross-References

- **`PROJECT.md` §3** — pipeline (web scraper → math → LLM → UI).
- **`PROJECT.md` §4** — agent table; Section 4 here is the implementation mirror of that spec.
- **`PROJECT.md` §6** — team boundaries. Phase files indicate which member owns each step.
- **`CLAUDE.md`** — repo rules; in particular, the constraint that the Tactical Verdict Agent must cite concrete xT values, zone IDs, and player names rather than clichés.
- **`convert_json_to_csv/seed.py`** — current Supabase row shape for `match_events`. The Phase 02 Pydantic schemas must align with these columns: `match_id, player_id, event_type, timestamp, start_x, start_y, end_x, end_y, is_success, xt_value`.

---

## 10. Phase Index

The phase files break the implementation above into ordered, self-contained tasks for Claude Code to execute. **Each phase file is the strict guideline for that step.** Do not start phase N until phase N−1 is complete (unless explicitly noted).

| Phase | File | Owner(s) | Scope |
|---|---|---|---|
| 01 | `phases/phase-01-scaffold.md` | Cloud (M4) | Repo layout for the function source, `requirements.txt`, local-run instructions, `.env.example`. |
| 02 | `phases/phase-02-data-contracts.md` | LLM + Cloud + DB (M3 + M4 + M2) | Pydantic schemas for every agent's I/O + Supabase row shapes. The joint cross-boundary contract. |
| 03 | `phases/phase-03-agent-prompts.md` | LLM (M3) | The actual prompt text for each of the 5 agents, with `response_schema` attached. |
| 04 | `phases/phase-04-math-layer.md` | Cloud (M4) | xT 16×12 grid implementation + Pitch Control function. Pure NumPy. |
| 05 | `phases/phase-05-cloud-function-glue.md` | Cloud (M4) | The `main(request)` orchestrator, Supabase reads/writes, error handling, retries. |
| 06 | `phases/phase-06-deployment.md` | Cloud (M4) | `gcloud` commands, Secret Manager wiring, IAM, Vertex-vs-Developer-API toggle. |
| 07 | `phases/phase-07-eval-harness.md` | LLM (M3) | Fixtures + a CLI runner for prompt regression checks. |

Phase files will be created in a follow-up planning round, one per row in this table.
