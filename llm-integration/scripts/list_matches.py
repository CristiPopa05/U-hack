"""Quick helper to list match IDs in the Supabase database."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
from src.db.supabase_client import get_default_client

c = get_default_client()

print("Matches with spatial_analysis data (ready for pipeline):")
try:
    import httpx
    r = c._client.get(
        c._base_url + "/spatial_analysis",
        headers=c._headers,
        params={"select": "match_id", "type": "eq.TEAM", "limit": "10"},
    )
    rows = r.json()
    seen = set()
    for row in rows:
        mid = row["match_id"]
        if mid not in seen:
            seen.add(mid)
            print(f"  match_id = {mid}")
    if not seen:
        print("  (none found - has the cloud function run?)")
except Exception as e:
    print(f"  Error: {e}")
