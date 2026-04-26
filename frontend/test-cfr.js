const url = 'https://pecngylchgphppasuvpk.supabase.co/rest/v1';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlY25neWxjaGdwaHBwYXN1dnBrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA0MDA3NCwiZXhwIjoyMDkyNjE2MDc0fQ.UoM_ianLSZwmexNDmO9Pz-qzmBI7FQK9LYQwePAFCMQ';

async function test() {
  const headers = { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' };

  try {
    const r1 = await fetch(url + '/teams?select=id,name,short_name&name=eq.CFR%20Cluj', { headers });
    const teams = await r1.json();
    const teamId = teams[0].id;
    console.log("CFR ID:", teamId);
    
    const r2 = await fetch(url + '/matches?select=id,home_team,away_team&or=(home_team.eq.CFR%20Cluj,away_team.eq.CFR%20Cluj)&order=match_date.desc&limit=5', { headers });
    const matches = await r2.json();
    const matchIds = matches.map(m => m.id);
    const matchIdsStr = matchIds.join(',');

    const r3 = await fetch(url + '/players?select=id,name,team_id&team_id=eq.' + teamId + '&match_id=in.(' + matchIdsStr + ')', { headers });
    const players = await r3.json();
    
    console.log('Player count for CFR:', players.length);
    console.log(players.slice(0, 5).map(p => p.name));
    
    // Check if Alexandru Musi is here
    const musi = players.find(p => p.name.includes("Musi"));
    console.log("Musi in CFR?", musi);
  } catch (e) {
    console.error(e);
  }
}
test();
