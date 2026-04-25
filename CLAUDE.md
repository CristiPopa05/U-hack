# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an AI-powered **opponent attack analysis system** for football coaching staff. It inverts the Expected Threat (xT) metric to analyze *opponent* danger rather than own-team attack. The core question it answers: *where does the opponent generate danger from, who is their playmaker, and where does our defense break?*

The reference team is **"U" Cluj** but the system is team-agnostic.

**Read `PROJECT.md` before writing any significant code.** It is the authoritative spec for the pipeline, math models, and LLM agent chain.

## Architecture

Three-layer pipeline:

```
[ Web Scraper ] → [ xT + Pitch Control Engine ] → [ LLM Agent (5 phases) ] → [ UI ]
```

**Data acquisition** is web scraping (FBref, Sofascore, Understat, Whoscored) — **not computer vision**. Do not propose YOLO/OpenCV/video pipelines.

**Math layer** operates on a 16×12 grid (192 zones). xT values in defensive mode increase toward own goal (Zone in front of goal ≈ 0.256, center pitch ≈ 0.010). Pass value = `xT(destination zone) − xT(start zone)`.

**LLM agent chain** — 5 sequential agents:
1. Data Ingestion Agent — validates scraped JSON, emits metadata schema
2. xT Engine Identification Agent — ranks players by xT contribution, flags "danger creator"
3. Zone Analysis Agent — Focuses on Zone Analysis. It features a map with the defensive xT showing how the rival team has been a threat to other teams by displaying the xT per section (the football field is split into squares representing different xT values). This is only one feature of the zone analysis.
4. Goal DNA Pattern Recognition Agent — Features a map showing a graph with all the passes that lead to a goal in that match. If the researched team scored more than one goal, we do a draft representation; if no goals were scored, it will show a phase of a potential scoring attack.
5. Tactical Verdict Agent — coach-readable brief + UI-ready schema

The Tactical Verdict Agent (phase 5) is what the coach sees. Agents 1–4 exist to give it grounded numerical evidence (concrete xT values, zone IDs, player names).

**Database** — Supabase (Postgres). Key tables: `matches`, `players`, `match_events`, xT zone definitions, pitch-control snapshots, LLM verdicts. Vector DB (pgvector or Pinecone) stores embedded build-up patterns and verdicts for similarity queries.

**Frontend** — coach-facing dashboard with heatmaps, pass-network visualizations, and defensive instruction cards.

## Scraper Output Contract

The normalized JSON fed into the math layer contains per-event:
```json
{ "player_id": ..., "x": ..., "y": ..., "event_type": "pass|shot|carry|dribble", "timestamp": ..., "outcome": true|false }
```
This is mapped onto the 16×12 grid before xT calculation.

## Database Seeding

`convert_json_to_csv/seed.py` — seeds Supabase from a Sofascore match JSON export. Requires `SUPABASE_API_KEY` env var. Run against a file named `combined_<matchId>.json` in the same directory:

```bash
cd convert_json_to_csv
SUPABASE_API_KEY=<key> python seed.py
```

The script POSTs to `matches`, `players`, and `match_events` tables. Goal build-up passing network actions are extracted from `incidents[].footballPassingNetworkAction`.

## Team Boundaries

Each team member owns a vertical slice (see `PROJECT.md` Section 6):
- **Member 1** — Frontend / dashboard UI
- **Member 2** — Database schema & Supabase integration
- **Member 3** — LLM agent architecture & prompts
- **Member 4** — Cloud pipeline / scraper orchestration

Cross-boundary changes require explicit coordination — flag them rather than silently crossing.

## Key Constraints

- The intermediate event schema between scraper output and LLM input is a **joint decision** between the Cloud and LLM members — don't finalize it unilaterally.
- When the xT and Pitch Control formula implementations land, link them from `PROJECT.md` Section 5 rather than reimplementing from scratch.
- Terminology in `PROJECT.md` overrides general football-analytics knowledge (e.g., "Zone 14" means the zone in front of our penalty box with high xT exposure).
