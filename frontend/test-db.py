import urllib.request
import json

URL = "https://pecngylchgphppasuvpk.supabase.co/rest/v1/"
API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlY25neWxjaGdwaHBwYXN1dnBrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA0MDA3NCwiZXhwIjoyMDkyNjE2MDc0fQ.UoM_ianLSZwmexNDmO9Pz-qzmBI7FQK9LYQwePAFCMQ"

headers = {
    "apikey": API_KEY,
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

req = urllib.request.Request(f"{URL}spatial_analysis?select=entity_id,match_id&type=eq.PLAYER&match_id=in.(14060334,14060365,14065018,14065026)&limit=10", headers=headers)
try:
    response = urllib.request.urlopen(req)
    data = json.loads(response.read().decode('utf-8'))
    print("PLAYER spatial analysis rows for FCSB matches:", data)
except Exception as e:
    print(e)
