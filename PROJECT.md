# Opponent Attack Analysis — AI-Powered Defensive Anticipation System

> Hackathon project memory document. This file is the shared source of truth for the team **and** for any AI agent assisting with planning, scaffolding, or implementation. Read this before writing code, designing UI, or making architectural decisions.

---

## 1. Project Summary

We are building an AI system that **inverts the Expected Threat (xT) metric** to analyze the opponent rather than our own attack. Instead of asking "where do we score from?", the system asks: *"where does the opponent generate danger from, who is their real playmaker, and where does our defense break?"*

The system ingests structured match data **via a web scraping pipeline** (no local video processing), combines two mathematical models — **Expected Threat (xT)** and **Pitch Control** — and runs the output through a 5-phase LLM agent that produces actionable defensive instructions for the coaching staff.

### Core value proposition
- **Anticipate** opponent attacks before they reach the finishing phase.
- **Identify** the real "danger creators" (highest xT contribution from passes/carries), not just the goal scorers.
- **Locate** the defensive black holes where our team loses spatial control.
- **Decode** the goal DNA — the recurring build-up patterns from the opponent's last scored goals.

### Reference case study
Initial reference team is **"U" Cluj**, used to anchor examples in the business logic (e.g., the defensive midfielder gap in front of the penalty box). The system itself is team-agnostic.

---

## 2. Data Acquisition Strategy — Web Scraping (NOT Computer Vision)

> **Important pivot.** The project originally planned to extract player coordinates from match video using YOLOv10. After hitting hardware limits (long processing times on a laptop, incomplete player identification), the data acquisition layer has been **replaced with direct web scraping** of public statistical providers.

The mathematical model, the 16x12 grid, the xT logic, and all tactical outputs remain unchanged. Only the input layer has been simplified.

### Why scraping
- Eliminates GPU/CV processing — runs on any laptop.
- Returns clean, pre-validated event data (no occlusion errors, no misidentified players).
- Reduces analysis turnaround from hours to minutes.
- Lets the staff get a tactical brief *before* a match instead of days later.

### Data sources
- **FBref** — progressive passes, carry data, advanced metrics.
- **Sofascore** — pass maps, heatmaps, per-match player positions.
- **Understat** — xG shot maps and event sequences.
- **Whoscored** — touch maps and player ratings.

### Scraper output (input to the math + LLM layers)
A normalized JSON containing, per match in the chosen window (typically last 5–10 fixtures):
- Pass origin and destination coordinates `(x, y)`.
- Player IDs and names.
- Event type (`pass`, `shot`, `carry`, `dribble`).
- Match timestamp.
- Outcome flag (success/failure).

This output is mapped onto the standard 16x12 grid (192 zones) before being passed to the calculation engine.

---

## 3. The Workflow (What the AI Actually Does)

The pipeline is now three layers; the LLM agent runs in 5 sequential phases at the end.

```
[ Web Scraper ] → [ xT + Pitch Control Engine ] → [ LLM Agent (5 phases) ] → [ UI ]
```

### Phase 1 — Tactical Map Construction
- Divide the pitch into a **16x12 grid (192 zones)**.
- Assign xT values per zone in **defensive mode**: values increase as zones approach our own goal.
  - Zone in front of our goal: `xT ≈ 0.256`
  - Center of pitch: `xT ≈ 0.010`

### Phase 2 — Opponent Offensive Scanning
- Aggregate the scraped event positions of opposing attackers across the chosen match window.
- Generate an **offensive heatmap** showing the opponent's preferred zones for crossing, shooting, and through balls.

### Phase 3 — Finding the "Engine" (xT on Passes)
- Scan all successful opponent passes from the scraped dataset.
- Pass value = `xT(destination zone) - xT(start zone)`.
- The player with the **highest accumulated xT** is flagged as the **primary target for tight marking** — even if they have 0 goals on paper.

### Phase 4 — Defensive Vulnerability Detector (Pitch Control Alert)
- Overlay our team's Pitch Control over the opponent's reconstructed attacking patterns.
- If an opposing attacker controls space in a high-xT zone (e.g., Zone 14, in front of our box) → trigger critical alert.
- LLM generates a verdict in plain language. Example:
  > *"The defensive midfielder does not drop back enough during the defensive phase, leaving a control gap in front of the penalty box with an xT exposure of 0.15 per attack."*
- Verdict criterion: the LLM cross-references the scraped history of opposing attackers — where they stay the most, where they make dangerous passes, and from where they score goals.

### Phase 5 — Visual Reconstruction of Goals (Pass Network Map)
For the opponent's **last 5 scored goals**:
- Isolate the **15–20 seconds** of possession before each goal, using the timestamps in the scraped event feed.
- Build a vector pass-network graph: players = nodes, passes = arrows, arrow thickness = traffic.
- LLM scans the 5 overlaid graphs and extracts the **common build-up pattern** with a confidence score.

---

## 4. LLM Agent Workflow (5 Sequential Sub-Phases)

The LLM does not collect or process raw data. It operates strictly on the structured numerical output of the scraping + xT engine layers, and runs five sequential sub-agents:

| # | Agent | Input | Output |
|---|---|---|---|
| 1 | **Data Ingestion Agent** | Normalized scraped JSON | Metadata schema (matches covered, players present, completeness flags) |
| 2 | **xT Engine Identification Agent** | All passes + xT deltas | Ranked player threat list with reasoning; flags the "danger creator" |
| 3 | **Heatmap & Zone Analysis Agent** | Aggregated zone-level pass data | Zone-priority schema (which corridors the opponent prefers) |
| 4 | **Goal DNA Pattern Recognition Agent** | Last 5 goal pass-network graphs | Pattern signature + confidence score |
| 5 | **Tactical Verdict Agent** | Outputs of agents 2–4 | Coach-readable brief + UI-ready schema (matrix + graph) |

The Tactical Verdict Agent is what the coach sees. The four agents before it exist to give it grounded, numerical evidence to reason from — so the verdict references concrete xT values, zone IDs, and player names rather than generic football clichés.

---

## 5. Tech Stack (Tentative)

| Layer | Tool / Service | Notes |
|---|---|---|
| Data acquisition | **Web scraper (Python)** | Scrapes FBref / Sofascore / Understat / Whoscored. Already functioning. |
| Math models | Expected Threat (xT), Pitch Control | Custom implementation on top of scraped event data |
| LLM | TBD (Claude / OpenAI / open-source) | 5-phase agent pipeline (verdict + pattern recognition) |
| Database | Supabase (Postgres) + Vector DB (pgvector or Pinecone) | Match data, embeddings of patterns/goals |
| Frontend | TBD (likely React/Next.js) | Coach-facing dashboard with heatmaps, alerts, pass networks |
| Cloud | TBD (lightweight — no GPU needed anymore) | Scraper jobs, math workers, LLM calls |

> Items marked TBD are decisions still owned by the responsible team member — see Section 6.

> **Removed from stack:** YOLOv10 / Computer Vision pipeline, GPU instances, video ingestion + frame extraction. The scraping pivot eliminated all of these.

---

## 6. Team & Responsibilities

We are 4 people. Each owns a vertical slice of the system. The original "Cloud + LLM" joint task on Computer Vision integration has been **removed** following the scraping pivot — the equivalent integration now happens between the Scraper (owned by Cloud) and the LLM agent.

### Member 1 — Frontend Designer
**Owns:** the coach-facing interface. The product is only as useful as the staff's ability to act on it during the week before a match.

Responsibilities:
- Design and implement the dashboard UI (coach view).
- Heatmap rendering for offensive scans (Phase 2) and pitch-control overlays (Phase 4).
- Pass-network visualization for Phase 5 (nodes, weighted arrows, animated playback of the 15–20s window reconstructed from event timestamps).
- Player profile view with the "primary target for marking" flag from Phase 3.
- Defensive instruction feed (live-style cards) showing LLM verdicts.
- Responsive layout — staff may consult on a tablet on the training ground.

Suggested first features to scope:
1. Static mock of the 16x12 grid with xT color coding.
2. A single-player profile card with mocked xT contribution data.
3. Pass-network playback component (driven by mocked JSON, no backend yet).

### Member 2 — Database & Backend Integration (Supabase + Vector DB)
**Owns:** persistence, retrieval, and the data model that everything else quernpies against.

Responsibilities:
- Schema design in Supabase (Postgres):
  - Matches, teams, players, **scraped events** (passes, shots, carries).
  - xT zone definitions (the 16x12 grid + values).
  - Pitch-control snapshots derived from scraped data.
  - LLM verdicts (with foreign keys to the match/phase that produced them).
- Vector database integration (pgvector inside Supabase is the simplest path; Pinecone if scale demands it). Use cases:
  - Embedding **build-up patterns** from Phase 5 so we can query "find similar goal sequences across opponents".
  - Embedding LLM verdicts for retrieval and historical comparison.
- Auth (Supabase Auth) for staff accounts — role-based: head coach, analyst, etc.
- Storage buckets for rendered heatmap images and exported reports. (Raw match clips are no longer needed.)
- Row-level security so different staff teams can't see each other's data.

Suggested first features to scope:
1. Lock the schema — pass it around the team for sign-off before anyone writes integration code.
2. Seed a fake opponent's worth of scraped events so frontend can develop against real-shaped data.
3. Define the embedding strategy (what gets embedded, dimensionality, model used).

### Member 3 — LLM Architecture
**Owns:** turning math (xT scores, pitch-control gaps, pass networks) into language the coach acts on.

Responsibilities:
- Design the **5 sequential agents** described in Section 4 — prompts, input contracts, output schemas.
- Prompt design for the **Phase 4 verdict generator** — the model must reference concrete numbers (xT values, zone IDs, player names) and avoid generic football clichés.
- Prompt design for the **Phase 5 pattern recognizer** — given 5 pass-network graphs, output the recurring pattern in plain language.
- Define the input format the LLM expects from the math layer (structured JSON: zones, players, xT deltas, control percentages).
- Decide on model choice (hosted API vs. self-hosted) and fallback behavior.
- Evaluation harness: a small set of known scenarios with expected verdict shape, run on every prompt change.
- **Joint task with Cloud:** see below.

Suggested first features to scope:
1. Hand-write the JSON contract: what does each of the 5 agents receive and emit? Lock this with the Cloud + Database members.
2. Build a CLI prototype that takes a scraped JSON file and returns a verdict — no UI, no cloud, just prove the agent chain works.
3. Write 5–10 evaluation cases.

### Member 4 — Cloud Architecture
**Owns:** the pipeline that takes a scraping target (opponent name + match window) and ends with structured data in Supabase + an LLM-ready payload.

Responsibilities:
- **Scraper orchestration** — schedule and run the web scraping script on demand for a given opponent and match window.
- Compute environment for the math models (xT calculation, Pitch Control). These are CPU-bound and run as lightweight workers.
- Pipeline orchestration: Scraper → Math → LLM Phase 1 → 2 → 3 → 4 → 5 must run in order, with checkpoints so a failure mid-pipeline doesn't restart from zero.
- Secrets management, logging, monitoring.
- Rate-limit handling and politeness for the scraper (caching, retries, source rotation).
- **Joint task with LLM:** see below.

Suggested first features to scope:
1. Pick the cloud provider and document why (cost, free-tier for hackathon — note GPU is no longer required).
2. Build the dumbest possible pipeline: trigger the scraper for one opponent → run the math → write event data + xT deltas to Supabase. No optimization yet.
3. Define the queue/orchestration mechanism (could be as simple as Supabase Edge Functions + a job table for the hackathon).

### Joint Task — LLM + Cloud: Scraper-to-LLM Integration
This is explicitly a **2-person task**. The scraper output is the bridge between the cloud pipeline and the LLM, so neither role can finish it alone.

What this joint task covers:
- **Cloud member** delivers normalized scraper output: event-level JSON with `(player_id, x, y, event_type, timestamp, outcome)` per row.
- **LLM member** consumes this output (after the math layer applies xT + Pitch Control) and converts it into the structured JSON the LLM agents expect.
- Together they decide:
  - The intermediate format between raw scraper output and LLM input (probably a "match event" schema co-owned with the Database member).
  - Where the math models (xT, Pitch Control) execute — in the cloud worker, or in a step closer to the LLM call.
  - How event data is sampled (every event? aggregated per zone? per possession sequence?).
  - How to handle scraper failures or partial data (missing matches, source down) — does the LLM see a confidence flag?

Recommended sync cadence during the hackathon: a 15-minute checkpoint at the start and end of each working day between these two members.

---



## 7. How Agents Should Use This Document

If you are an AI agent (Claude, Cursor, Copilot, etc.) reading this file:

- Treat Section 3 (workflow) and Section 4 (LLM agent chain) as the authoritative spec. Do not invent phases.
- Treat Section 6 (responsibilities) as a boundary. If a request from one team member touches another member's domain, flag it and propose a contract change rather than silently crossing the boundary.
- The data acquisition layer is **web scraping, not Computer Vision**. Do not propose YOLO, OpenCV, or video-frame pipelines unless explicitly asked to revisit this decision.
- The xT and Pitch Control formulas are not yet committed to this repo — when they are, link them from Section 5 and reference them rather than reimplementing.
- When in doubt about terminology (xT, Pitch Control, Zone 14, Pass Network), the meaning in this document overrides any general football-analytics knowledge.

---

## 8. Open Questions

These are unresolved and should be decided by the responsible owner in the first day:

- Which LLM provider, and is the project budget compatible with per-call cost (5 sequential agents per analysis)? *(LLM)*
- pgvector vs. dedicated vector DB? *(Database)*
- Cloud provider — note GPU is no longer required, so the cheapest option likely wins. *(Cloud)*
- Frontend framework — React + Next.js, or something lighter for a hackathon timeline? *(Frontend)*
- Which scraping source is most reliable for our target leagues? Do we hit one source or aggregate across multiple? *(Cloud + Team)*
- Do we demo on a real "U" Cluj opponent or on synthetic scraped data? *(Team)*
