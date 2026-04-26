const url = 'https://pecngylchgphppasuvpk.supabase.co/rest/v1';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlY25neWxjaGdwaHBwYXN1dnBrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA0MDA3NCwiZXhwIjoyMDkyNjE2MDc0fQ.UoM_ianLSZwmexNDmO9Pz-qzmBI7FQK9LYQwePAFCMQ';

async function test() {
  const headers = { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' };

  try {
    const r1 = await fetch(url + '/teams?select=id,name,short_name&name=eq.FCSB', { headers });
    const teams = await r1.json();
    const teamId = teams[0].id;
    
    const r2 = await fetch(url + '/matches?select=id,home_team,away_team&or=(home_team.eq.FCSB,away_team.eq.FCSB)&order=match_date.desc&limit=5', { headers });
    const matches = await r2.json();
    const matchIds = matches.map(m => m.id);
    const matchIdsStr = matchIds.join(',');

    const r3 = await fetch(url + '/players?select=id,name&team_id=eq.' + teamId + '&match_id=in.(' + matchIdsStr + ')', { headers });
    const players = await r3.json();
    
    const playerIds = players.map(p => p.id).join(',');
    
    console.log('Player IDs length:', players.length);
    if (players.length > 0) {
      const r4 = await fetch(url + '/spatial_analysis?select=entity_id,xt_matrix&type=eq.PLAYER&match_id=in.(' + matchIdsStr + ')&entity_id=in.(' + playerIds + ')', { headers });
      const spatial = await r4.json();
      console.log('Spatial Analysis Error:', spatial.error ? spatial : 'No error');
      console.log('Spatial Analysis Length:', spatial.length);
    }
  } catch (e) {
    console.error(e);
  }
}
test();
