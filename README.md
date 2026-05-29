# ⚽ U-hack: AI-Powered Opponent Tactical Analysis System

[![Hackathon Project](https://img.shields.io/badge/Hackathon-U--Cluj-blue.svg)](#)
[![Tech Stack](https://img.shields.io/badge/Tech-React%20%7C%20Python%20%7C%20Supabase%20%7C%20Gemini-green.svg)](#)

**U-hack** is an advanced football analytics platform developed during the U-Cluj Hackathon to assist coaching staffs in anticipating opponent attacks. The system goes beyond basic statistics, utilizing mathematical models and a multi-agent AI pipeline to uncover the opponent's true tactical engine and expose defensive vulnerabilities.

## 🚀 The Core Innovation: Inverting Expected Threat (xT)
Traditional Expected Threat (xT) models ask, *"Where do we score from?"*. **U-hack inverts this logic** to ask:
- **Where does the opponent generate their highest danger?**
- **Who is their real "Engine"?** (Identifying the primary playmaker based on xT created through passes and carries, not just the goalscorers).
- **Where are our Defensive Black Holes?** We overlay Pitch Control data to identify exact zones where our team loses spatial dominance against specific attacking patterns.

## 🧠 Architecture: 5-Phase LLM Agent Pipeline
The system relies on a sequential chain of specialized Large Language Model (LLM) agents powered by **Google Gemini 2.5**. This pipeline transforms raw, numerical football data into actionable coaching instructions:
1. **Data Ingestion Agent:** Validates and normalizes the scraped event bundle.
2. **xT Engine ID Agent:** Ranks opposing players based on their cumulative threat contribution.
3. **Zone Analysis Agent:** Divides the pitch into a 16x12 grid (192 zones) to classify attacking corridors based on threat density.
4. **Goal DNA Agent:** Uses Vector Pass-Network Graphs to automatically extract the signature build-up patterns from the opponent's last 5 goals.
5. **Tactical Verdict Agent:** Generates the final, coach-readable brief, strictly constrained to cite concrete numbers and zones (e.g., *"Player X generates 0.15 xT/pass from Zone 14"*).

## 🛠️ Tech Stack
- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Shadcn UI, Recharts (for interactive heatmaps and pass network visualization).
- **Backend & AI:** Python 3.12, GCP Cloud Functions (Gen 2), Google GenAI SDK.
- **Data & Math:** NumPy & Pandas (for xT Grid & Pitch Control calculations), Supabase (PostgreSQL) + **pgvector** (for build-up pattern similarity embeddings).
- **Data Acquisition:** Custom Python/Selenium Web Scraper targeting event data, player ratings, and match incidents from Sofascore, FBref, and Understat.

## 📂 Project Structure
```text
├── frontend/                # React dashboard with interactive pitch maps and reports
├── llm-integration/         # The core engine: Math models and 5-phase AI pipeline
│   ├── src/agents/          # Individual LLM agent logic
│   └── src/math/            # NumPy implementations for xT and Pitch Control
├── sofascore_scraper.py     # Automated data acquisition layer (Selenium)
└── Functions/               # Serverless GCP Cloud Functions entrypoints
