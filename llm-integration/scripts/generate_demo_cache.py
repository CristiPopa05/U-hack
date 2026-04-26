"""Generate a demo cache payload for a given match.

Usage:
    cd llm-integration
    python scripts/generate_demo_cache.py <match_id>

Requires GEMINI_API_KEY + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.

The output is written to  cache/demo_<match_id>.json  and can be served by
the FastAPI server with  GET /api/analysis/<match_id>?demo=1
"""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure the project root is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from src.pipeline import run_pipeline


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python scripts/generate_demo_cache.py <match_id>")
        sys.exit(1)

    match_id = int(sys.argv[1])
    cache_dir = Path(__file__).resolve().parent.parent / "cache"
    cache_dir.mkdir(exist_ok=True)
    out_file = cache_dir / f"demo_{match_id}.json"

    print(f"Running pipeline for match_id={match_id}...")
    payload = run_pipeline(match_id)

    out_file.write_text(payload.model_dump_json(indent=2), encoding="utf-8")
    print(f"✅ Wrote {out_file}  ({out_file.stat().st_size:,} bytes)")
    print(f"   Serve with:  GET /api/analysis/{match_id}?demo=1")


if __name__ == "__main__":
    main()
