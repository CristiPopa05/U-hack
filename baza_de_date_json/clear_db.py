import urllib.request
import json

URL = "https://pecngylchgphppasuvpk.supabase.co/rest/v1/"
API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlY25neWxjaGdwaHBwYXN1dnBrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA0MDA3NCwiZXhwIjoyMDkyNjE2MDc0fQ.UoM_ianLSZwmexNDmO9Pz-qzmBI7FQK9LYQwePAFCMQ"

headers = {
    "apikey": API_KEY,
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}

# Order matters: child tables first, parent tables last
tables = [
    "spatial_analysis",
    "passes",
    "match_events",
    "players",
    "matches",
    "teams"
]

for table in tables:
    # DELETE with a filter that matches all rows (id not equal to impossible value)
    delete_url = f"{URL}{table}?id=neq.00000000-0000-0000-0000-000000000000"
    if table in ["matches"]:
        delete_url = f"{URL}{table}?id=gt.0"
    elif table in ["match_events", "players"]:
        delete_url = f"{URL}{table}?id=gt.0"
    
    req = urllib.request.Request(delete_url, method="DELETE", headers=headers)
    try:
        response = urllib.request.urlopen(req)
        print(f"[OK] {table} - cleared")
    except urllib.error.HTTPError as e:
        print(f"[ERR] {table} - {e.code}: {e.read().decode('utf-8')}")

print("\nDone! All tables cleared.")
