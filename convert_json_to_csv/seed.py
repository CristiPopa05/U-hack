import json
import urllib.request
import urllib.error
import sys

import os

API_URL = "https://pecngylchgphppasuvpk.supabase.co/rest/v1"
API_KEY = os.environ.get("SUPABASE_API_KEY", "YOUR_SUPABASE_KEY_HERE")
HEADERS = {
    "apikey": API_KEY,
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

def post_data(table, data):
    url = f"{API_URL}/{table}"
    req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers=HEADERS, method='POST')
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        print(f"Error POSTing to {table}: {e.code} - {e.read().decode('utf-8')}")
        return None

def main():
    try:
        with open('combined_15698584.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print("Failed to load JSON file:", e)
        return

    # Check if the file has the Sofascore structure
    if "matchInfo" not in data:
        print("JSON file doesn't seem to have the new structure (matchInfo missing). Make sure you saved the file!")
        return

    # 1. Matches
    match_id = data.get('matchId')
    match_info = data.get('matchInfo', {})
    
    match_payload = {
        "id": match_id,
        "tournament_name": match_info.get('tournament', {}).get('name', 'Unknown'),
        "home_team": match_info.get('homeTeam', {}).get('name', 'Unknown'),
        "away_team": match_info.get('awayTeam', {}).get('name', 'Unknown'),
    }
    
    print("Uploading Match...")
    res = post_data('matches', match_payload)
    if res: print("Match uploaded successfully!")

    # 2. Players
    players_payload = []
    lineups = data.get('lineups', {})
    if 'home' in lineups and 'players' in lineups['home']:
        for p in lineups['home']['players']:
            pi = p.get('player', {})
            players_payload.append({
                "id": pi.get('id'),
                "match_id": match_id,
                "name": pi.get('name'),
                "team_side": "home",
                "position": pi.get('position')
            })
            
    if 'away' in lineups and 'players' in lineups['away']:
        for p in lineups['away']['players']:
            pi = p.get('player', {})
            players_payload.append({
                "id": pi.get('id'),
                "match_id": match_id,
                "name": pi.get('name'),
                "team_side": "away",
                "position": pi.get('position')
            })

    print(f"Uploading {len(players_payload)} players...")
    # Supabase allows bulk inserts by posting an array
    res = post_data('players', players_payload)
    if res: print("Players uploaded successfully!")

    events_payload = []
    
    # Check incidents for passing network actions (goals)
    # The JSON structure places passing networks inside specific incidents
    incidents = data.get('incidents', {}).get('incidents', [])
    for incident in incidents:
        if 'footballPassingNetworkAction' in incident:
            for action in incident['footballPassingNetworkAction']:
                player_id = action.get('player', {}).get('id')
                # Optional: We could assign a random id or let db generate if it is SERIAL.
                # However from PostgREST schema id is an integer PK, let's omit it to auto increment
                ev = {
                    "match_id": match_id,
                    "player_id": player_id,
                    "event_type": action.get("eventType"),
                    "timestamp": action.get("time"),
                    "start_x": action.get("playerCoordinates", {}).get("x"),
                    "start_y": action.get("playerCoordinates", {}).get("y"),
                    "end_x": action.get("passEndCoordinates", {}).get("x"),
                    "end_y": action.get("passEndCoordinates", {}).get("y"),
                    "is_success": True,
                    "xt_value": 0.0
                }
                # Handle goal events without end coords
                if ev["event_type"] == "goal":
                    ev["end_x"] = action.get("goalShotCoordinates", {}).get("x")
                    ev["end_y"] = action.get("goalShotCoordinates", {}).get("y")
                    
                events_payload.append(ev)

    events_list = data.get('events', [])
    if not events_payload and not events_list:
        print("No 'events' or passing networks found! Check dataset completeness.")
    else:
        # Also process top-level events if they existed
        for e in events_list:
            pass # implement if real events exist
            
        print(f"Found {len(events_payload)} goal build-up events to process.")
        if events_payload:
            res = post_data('match_events', events_payload)
            if res: print("Match events uploaded successfully!")

if __name__ == '__main__':
    main()
