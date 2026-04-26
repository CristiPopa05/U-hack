import json

with open('meciuri/combined_15698584.json', 'r', encoding='utf-8-sig') as f:
    d = json.load(f)

evts = d.get('incidents', {}).get('incidents', [])
goals = [e for e in evts if e.get('incidentType') == 'goal']
print(f'Goals found: {len(goals)}')

for i, g in enumerate(goals):
    player = g.get('player', {}).get('name', '?')
    time = g.get('time', '?')
    is_home = g.get('isHome', None)
    print(f'\nGoal {i+1}: {player} at {time}min (isHome={is_home})')
    
    acts = g.get('footballPassingNetworkAction', [])
    print(f'  Chain length: {len(acts)} actions')
    for j, a in enumerate(acts):
        pname = a.get('player', {}).get('name', '?')
        coords = a.get('playerCoordinates', {})
        end_coords = a.get('passEndCoordinates') or a.get('goalShotCoordinates') or {}
        etype = a.get('eventType', '?')
        print(f'  [{j}] {pname} ({coords.get("x","?")},{coords.get("y","?")}) -> ({end_coords.get("x","?")},{end_coords.get("y","?")}) type={etype}')
    print('---')
