"""FastAPI server — exposes the LLM pipeline over HTTP for the React frontend.

Phase 4 of `ui_schema_design.md`.

Routes
------
GET /api/health
    Lightweight liveness check. Returns ``{"status": "ok"}``.

GET /api/analysis/{match_id}
    Runs the full 5-phase pipeline (Supabase → LLM chain → assembler) and
    returns a ``DashboardPayload`` JSON response.  Slow (~30-90 s) because it
    makes 5 sequential LLM calls.

GET /api/analysis/{match_id}?demo=1
    Serves a pre-cached ``DashboardPayload`` from ``llm-integration/cache/``
    **without** hitting any LLM or Supabase.  Use this on demo day to avoid
    latency / quota issues.

CORS
----
Allows ``http://localhost:8080`` (Vite dev server) and ``http://localhost:5173``
(Vite default) so the frontend can fetch during local development.

Start
-----
    cd llm-integration
    uvicorn src.api.server:app --reload --port 8000
"""
from __future__ import annotations

import json
import logging
import os
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.schemas.dashboard import DashboardPayload

# ---------------------------------------------------------------------------
# Bootstrap: load .env so GEMINI_API_KEY / SUPABASE_* are available to agents
# ---------------------------------------------------------------------------
_env_path = Path(__file__).resolve().parent.parent.parent / ".env"
load_dotenv(_env_path)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger("src.api.server")

# ---------------------------------------------------------------------------
# Cache directory for demo payloads
# ---------------------------------------------------------------------------
CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "cache"

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="U-Hack Opponent Analysis API",
    description=(
        "Exposes the 5-phase LLM pipeline as a single HTTP endpoint.  "
        "The React frontend calls GET /api/analysis/{match_id} to obtain "
        "a DashboardPayload containing all panel data."
    ),
    version="0.1.0",
)

# CORS — allow the Vite dev server during local development
_ALLOWED_ORIGINS = [
    "http://localhost:8080",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:8080",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    """Lightweight liveness probe."""
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get(
    "/api/analysis/{match_id}",
    response_model=DashboardPayload,
    responses={
        404: {"description": "Demo cache file not found (demo=1 mode)"},
        500: {"description": "Pipeline execution failed"},
    },
)
async def get_analysis(
    match_id: int,
    demo: int = Query(0, description="Set to 1 to serve cached demo payload"),
    opponent_side: Literal["home", "away"] = Query(
        "away",
        description="Which side is the opponent? Defaults to 'away'.",
    ),
):
    """Run the analysis pipeline or serve a cached demo payload.

    **Live mode** (default): calls ``run_pipeline(match_id)`` which fetches
    data from Supabase and chains 5 LLM calls.  Expect ~30-90 s latency.

    **Demo mode** (``?demo=1``): reads
    ``llm-integration/cache/demo_{match_id}.json`` from disk.  Zero latency,
    no API keys required.
    """
    if demo == 1:
        return _serve_demo_payload(match_id)

    return await _run_live_pipeline(match_id, opponent_side)


# ---------------------------------------------------------------------------
# Demo-cache helper
# ---------------------------------------------------------------------------

def _serve_demo_payload(match_id: int) -> JSONResponse:
    """Read a pre-cached DashboardPayload from the cache directory."""
    cache_file = CACHE_DIR / f"demo_{match_id}.json"

    if not cache_file.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                f"No demo cache for match_id={match_id}.  "
                f"Expected file: {cache_file.name}.  "
                f"Generate it with: python -c "
                f"\"from src.pipeline import run_pipeline; "
                f"import json, pathlib; "
                f"p = run_pipeline({match_id}); "
                f"pathlib.Path('cache/demo_{match_id}.json')"
                f".write_text(p.model_dump_json(indent=2))\""
            ),
        )

    try:
        raw = cache_file.read_text(encoding="utf-8")
        # Validate it parses as a DashboardPayload (catches stale caches)
        payload = DashboardPayload.model_validate_json(raw)
        return JSONResponse(
            content=json.loads(payload.model_dump_json()),
            headers={"X-Demo-Cache": "true"},
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load demo cache {cache_file.name}: {exc}",
        )


# ---------------------------------------------------------------------------
# Live pipeline helper
# ---------------------------------------------------------------------------

async def _run_live_pipeline(
    match_id: int,
    opponent_side: Literal["home", "away"],
) -> DashboardPayload:
    """Execute the full pipeline.  Runs synchronously (the LLM calls block)."""
    # Lazy import to avoid circular imports & heavy init on startup
    from src.pipeline import run_pipeline

    logger.info("Starting live pipeline for match_id=%d (opponent=%s)", match_id, opponent_side)
    start = time.monotonic()

    try:
        payload = run_pipeline(match_id, opponent_team_side=opponent_side)
    except ValueError as exc:
        # ValueError covers missing match, missing spatial rows, etc.
        logger.error("Pipeline ValueError for match %d: %s", match_id, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.error(
            "Pipeline failed for match %d:\n%s", match_id, traceback.format_exc()
        )
        raise HTTPException(
            status_code=500,
            detail=f"Pipeline execution failed: {type(exc).__name__}: {exc}",
        )

    elapsed = time.monotonic() - start
    logger.info(
        "Pipeline complete for match_id=%d in %.1fs — %d panels",
        match_id,
        elapsed,
        len(payload.panels),
    )
    return payload


# ---------------------------------------------------------------------------
# Startup event — log useful info
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def _on_startup():
    has_gemini = bool(os.environ.get("GEMINI_API_KEY"))
    has_vertex = os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "").lower() == "true"
    has_supabase = bool(
        os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    )

    logger.info("=" * 60)
    logger.info("U-Hack Opponent Analysis API starting")
    logger.info("  Gemini API key:  %s", "✅ set" if has_gemini else "❌ missing")
    logger.info("  Vertex AI:       %s", "✅ enabled" if has_vertex else "⬜ not used")
    logger.info("  Supabase:        %s", "✅ configured" if has_supabase else "❌ missing")
    logger.info("  Cache dir:       %s", CACHE_DIR)
    logger.info("  Demo payloads:   %s", _list_demo_caches())
    logger.info("=" * 60)


def _list_demo_caches() -> str:
    if not CACHE_DIR.exists():
        return "(cache dir not found)"
    files = sorted(CACHE_DIR.glob("demo_*.json"))
    if not files:
        return "(none)"
    return ", ".join(f.stem for f in files)
