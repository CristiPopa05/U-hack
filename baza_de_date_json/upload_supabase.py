import json
import urllib.request
import datetime
import os
import uuid

URL = "https://pecngylchgphppasuvpk.supabase.co/rest/v1/"
API_KEY = "sb_secret_iBxvqj89IeiU06HvhSZGHA_rxLU2gdW"

headers = {
    "apikey": API_KEY,
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal, resolution=merge-duplicates"
}

def make_request(endpoint, data):
    req = urllib.request.Request(URL + endpoint, json.dumps(data).encode('utf-8'), headers)
    try:
        response = urllib.request.urlopen(req)
        return response.getcode(), response.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8')

def get_team_uuid(team_id):
    return str(uuid.uuid5(uuid.NAMESPACE_OID, str(team_id)))

def get_match_player_id(match_id, player_id):
    return int(str(match_id) + str(player_id))

import glob
import time

MECIURI_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "meciuri")
files = sorted(glob.glob(os.path.join(MECIURI_DIR, "combined_*.json")))

print(f"Found {len(files)} JSON files in meciuri/\n")

for file_idx, file in enumerate(files, 1):
    if not os.path.exists(file):
        print(f"File {file} not found")
        continue

    print(f"[{file_idx}/{len(files)}] Processing {os.path.basename(file)}...")
    
    data = None
    for enc in ['utf-8-sig', 'utf-8', 'utf-16', 'utf-16le', 'latin1']:
        try:
            with open(file, 'r', encoding=enc) as f:
                data = json.load(f)
            break
        except Exception:
            pass

    if data is None:
        print(f"Failed to load JSON from {file} with any encoding")
        continue
        
    match_info = data.get("matchInfo", {})
    match_id = match_info.get("id")
    if not match_id:
        print("No matchId found.")
        continue
    
    # 1. Teams
    teams = []
    for side in ["homeTeam", "awayTeam"]:
        t = match_info.get(side, {})
        if t and t.get("id"):
            teams.append({
                "id": get_team_uuid(t.get("id")),
                "name": t.get("name"),
                "short_name": t.get("shortName")
            })
    if teams:
        status, text = make_request("teams", teams)
        if status not in [200, 201]:
            print("Teams Error:", status, text)
        else:
            print("Teams upserted.")
        
    # 2. Matches
    match_payload = {
        "id": match_id,
        "tournament_name": match_info.get("tournament", {}).get("uniqueTournament", {}).get("name", ""),
        "home_team": match_info.get("homeTeam", {}).get("name"),
        "away_team": match_info.get("awayTeam", {}).get("name"),
        "match_date": datetime.datetime.fromtimestamp(match_info.get("startTimestamp", 0)).isoformat() if match_info.get("startTimestamp") else None,
        "tactical_verdict": None
    }
    status, text = make_request("matches", match_payload)
    if status not in [200, 201]:
        print("Match Error:", status, text)
    else:
        print("Match inserted.")
    
    # 3. Players
    players_payload = []
    lineups = data.get("lineups", {})
    for side in ["home", "away"]:
        team_id = match_info.get(f"{side}Team", {}).get("id")
        team_uuid = get_team_uuid(team_id) if team_id else None
        for p in lineups.get(side, {}).get("players", []):
            pi = p.get("player", {})
            p_id = pi.get("id")
            if p_id:
                players_payload.append({
                    "id": get_match_player_id(match_id, p_id),
                    "match_id": match_id,
                    "name": pi.get("name"),
                    "team_side": side,
                    "position": pi.get("position"),
                    "avg_xt_contribution": 0.0,
                    "team_id": team_uuid
                })
    if players_payload:
        status, text = make_request("players", players_payload)
        if status not in [200, 201]:
            print("Players Error:", status, text)
        else:
            print(f"Players inserted. ({len(players_payload)})")
        
    # 4. Passes & Match Events
    passes_payload = []
    events_payload = []
    
    rating_breakdowns = data.get("ratingBreakdowns", {})
    for p_id_str, rb_data in rating_breakdowns.items():
        if not p_id_str.isdigit(): continue
        p_id = int(p_id_str)
        rb_details = rb_data.get("ratingBreakdown", {})
        if isinstance(rb_details, dict):
            passes_list = rb_details.get("passes", [])
            if isinstance(passes_list, list):
                for pass_ev in passes_list:
                    passes_payload.append({
                        "player_id": get_match_player_id(match_id, p_id),
                        "x_start": pass_ev.get("playerCoordinates", {}).get("x"),
                        "y_start": pass_ev.get("playerCoordinates", {}).get("y"),
                        "x_end": pass_ev.get("passEndCoordinates", {}).get("x"),
                        "y_end": pass_ev.get("passEndCoordinates", {}).get("y"),
                        "outcome": pass_ev.get("outcome", True),
                        "is_assist": pass_ev.get("keypass", False),
                        "match_id": match_id,
                        "xt": 0.0
                    })
                    
    incidents = data.get("incidents", {}).get("incidents", [])
    for inc in incidents:
        events = inc.get("footballPassingNetworkAction", [])
        for ev in events:
            p_id = ev.get("player", {}).get("id")
            if not p_id: continue
            end_x = ev.get("passEndCoordinates", {}).get("x") if ev.get("passEndCoordinates") else ev.get("goalShotCoordinates", {}).get("x")
            end_y = ev.get("passEndCoordinates", {}).get("y") if ev.get("passEndCoordinates") else ev.get("goalShotCoordinates", {}).get("y")
            
            events_payload.append({
                "match_id": match_id,
                "player_id": get_match_player_id(match_id, p_id),
                "event_type": ev.get("eventType"),
                "start_x": ev.get("playerCoordinates", {}).get("x"),
                "start_y": ev.get("playerCoordinates", {}).get("y"),
                "end_x": end_x,
                "end_y": end_y,
                "is_success": True,
                "xt_value": 0.0,
                "timestamp": str(ev.get("time", 0))
            })
            
    if passes_payload:
        status, text = make_request("passes", passes_payload)
        if status not in [200, 201]:
            print("Passes Error:", status, text)
            chunk_size = 500
            for i in range(0, len(passes_payload), chunk_size):
                s, t = make_request("passes", passes_payload[i:i+chunk_size])
                if s not in [200, 201]:
                     print(f"Passes Chunk Error at {i}:", s, t)
            print(f"Passes inserted in chunks. ({len(passes_payload)})")
        else:
            print(f"Passes inserted. ({len(passes_payload)})")
        
    if events_payload:
        status, text = make_request("match_events", events_payload)
        if status not in [200, 201]:
            print("Events Error:", status, text)
        else:
            print(f"Events inserted. ({len(events_payload)})")
    
    print("-" * 20)

    # ===== PASUL 5: Calculăm xT per pasă (GET) =====
    print(f"[{file}] Calculăm xT pentru pase (GET)...")
    GC_FUNCTION_URL = "https://calculate-xt-483351897557.europe-west1.run.app"

    try:
        req = urllib.request.Request(GC_FUNCTION_URL)
        response = urllib.request.urlopen(req, timeout=120)
        result = json.loads(response.read().decode('utf-8'))
        print(f"[{file}] GET xT result: {result.get('message', 'OK')}")
    except Exception as e:
        print(f"[{file}] Eroare GET xT: {str(e)}")

    # ===== PASUL 6: Generăm analiza spațială (POST cu match_id) =====
    print(f"[{file}] Generăm matricea spațială pentru match_id={match_id} (POST)...")

    try:
        post_data = json.dumps({"match_id": match_id}).encode('utf-8')
        post_headers = {
            "Content-Type": "application/json"
        }
        req = urllib.request.Request(GC_FUNCTION_URL, post_data, post_headers)
        response = urllib.request.urlopen(req, timeout=120)
        result = json.loads(response.read().decode('utf-8'))
        print(f"[{file}] POST spatial result: {result.get('message', 'OK')}")
    except Exception as e:
        print(f"[{file}] Eroare POST spatial: {str(e)}")

    print(f"===== {file} COMPLET =====\n")

print("Toate fișierele au fost procesate cu succes!")