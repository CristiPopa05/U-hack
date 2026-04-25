import { v5 as uuidv5 } from 'uuid';

const NAMESPACE_OID = '6ba7b812-9dad-11d1-80b4-00c04fd430c8';

function getTeamUuid(teamId: number | string): string {
  return uuidv5(String(teamId), NAMESPACE_OID);
}

function getMatchPlayerId(matchId: number | string, playerId: number | string): number {
  return parseInt(String(matchId) + String(playerId), 10);
}

async function makeRequest(endpoint: string, data: any) {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const res = await fetch(`${url}/rest/v1/${endpoint}`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal, resolution=merge-duplicates'
    },
    body: JSON.stringify(data)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[${res.status}] ${text}`);
  }
}

export async function uploadMatchData(rawData: any): Promise<void> {
  // Check if it's an array of matches
  if (Array.isArray(rawData)) {
    for (const match of rawData) {
      await processMatch(match);
    }
  } else if (rawData && typeof rawData === 'object' && !rawData.matchInfo && !rawData.data?.matchInfo) {
    // Try to see if it's a dictionary of matches (e.g. combined files with matchIds as keys)
    let processedAny = false;
    for (const key of Object.keys(rawData)) {
      const item = rawData[key];
      if (item && (item.matchInfo || item.data?.matchInfo || item.incidents || item.ratingBreakdowns)) {
        await processMatch(item);
        processedAny = true;
      }
    }
    if (!processedAny) {
      await processMatch(rawData); // This will throw the "no matchId" error
    }
  } else {
    await processMatch(rawData);
  }

  console.log('Toate fișierele au fost procesate. Aștept confirmarea xT...');

  const GC_FUNCTION_URL = 'https://calculate-xt-483351897557.europe-west1.run.app';
  try {
    const xtRes = await fetch(GC_FUNCTION_URL);
    if (xtRes.ok) {
      console.log('Succes! xT-ul a fost calculat.');
    } else {
      console.error(`Eroare: ${xtRes.status}`);
    }
  } catch (e: any) {
    console.error(`Eroare la conexiune: ${e.message}`);
  }
}

async function processMatch(rawData: any): Promise<void> {
  // Sometimes the JSON has a top-level wrapper or structure
  let data = rawData;
  if (rawData.data && !rawData.matchInfo && !rawData.id) {
    data = rawData.data;
  }

  // If data itself is the match info (it has an id and homeTeam/awayTeam)
  const matchInfo = data.matchInfo || (data.id && (data.homeTeam || data.awayTeam) ? data : {});
  const matchId = matchInfo.id;

  if (!matchId) {
    throw new Error('Nu am găsit un matchId valid în acest fișier JSON. Verifică formatul fișierului. Datele trebuie să conțină măcar un id și homeTeam/awayTeam.');
  }

  // 1. Teams
  const teams = [];
  for (const side of ['homeTeam', 'awayTeam']) {
    const t = matchInfo[side] || {};
    if (t && t.id) {
      teams.push({
        id: getTeamUuid(t.id),
        name: t.name,
        short_name: t.shortName,
      });
    }
  }

  if (teams.length > 0) {
    try {
      await makeRequest('teams', teams);
      console.log('Teams upserted.');
    } catch (error: any) {
      console.error('Teams Error:', error);
      throw new Error(`Failed to upload teams: ${error.message}`);
    }
  }

  // 2. Matches
  const matchPayload = {
    id: matchId,
    tournament_name: matchInfo.tournament?.uniqueTournament?.name || '',
    home_team: matchInfo.homeTeam?.name,
    away_team: matchInfo.awayTeam?.name,
    match_date: matchInfo.startTimestamp ? new Date(matchInfo.startTimestamp * 1000).toISOString() : null,
    tactical_verdict: null,
  };

  try {
    await makeRequest('matches', matchPayload);
    console.log('Match inserted.');
  } catch (error: any) {
    console.error('Match Error:', error);
    throw new Error(`Failed to upload match: ${error.message}`);
  }

  // 3. Players
  const playersPayload = [];
  const lineups = data.lineups || {};
  for (const side of ['home', 'away']) {
    const teamId = matchInfo[`${side}Team`]?.id;
    const teamUuid = teamId ? getTeamUuid(teamId) : null;
    const playersList = lineups[side]?.players || [];

    for (const p of playersList) {
      const pi = p.player || {};
      const pId = pi.id;
      if (pId) {
        playersPayload.push({
          id: getMatchPlayerId(matchId, pId),
          match_id: matchId,
          name: pi.name,
          team_side: side,
          position: pi.position,
          avg_xt_contribution: 0.0,
          team_id: teamUuid,
        });
      }
    }
  }

  if (playersPayload.length > 0) {
    try {
      await makeRequest('players', playersPayload);
      console.log(`Players inserted. (${playersPayload.length})`);
    } catch (error: any) {
      console.error('Players Error:', error);
      throw new Error(`Failed to upload players: ${error.message}`);
    }
  }

  // 4. Passes & Match Events
  const passesPayload = [];
  const eventsPayload = [];

  const ratingBreakdowns = data.ratingBreakdowns || {};
  for (const pIdStr of Object.keys(ratingBreakdowns)) {
    if (!/^\d+$/.test(pIdStr)) continue;
    const pId = parseInt(pIdStr, 10);
    const rbDetails = ratingBreakdowns[pIdStr]?.ratingBreakdown || {};

    if (typeof rbDetails === 'object' && rbDetails !== null) {
      const passesList = rbDetails.passes || [];
      if (Array.isArray(passesList)) {
        for (const passEv of passesList) {
          passesPayload.push({
            player_id: getMatchPlayerId(matchId, pId),
            x_start: passEv.playerCoordinates?.x,
            y_start: passEv.playerCoordinates?.y,
            x_end: passEv.passEndCoordinates?.x,
            y_end: passEv.passEndCoordinates?.y,
            outcome: passEv.outcome ?? true,
            is_assist: passEv.keypass ?? false,
            match_id: matchId,
            xt: 0.0,
          });
        }
      }
    }
  }

  const incidentsList = data.incidents?.incidents || [];
  for (const inc of incidentsList) {
    const events = inc.footballPassingNetworkAction || [];
    for (const ev of events) {
      const pId = ev.player?.id;
      if (!pId) continue;

      const endX = ev.passEndCoordinates?.x ?? ev.goalShotCoordinates?.x;
      const endY = ev.passEndCoordinates?.y ?? ev.goalShotCoordinates?.y;

      eventsPayload.push({
        match_id: matchId,
        player_id: getMatchPlayerId(matchId, pId),
        event_type: ev.eventType,
        start_x: ev.playerCoordinates?.x,
        start_y: ev.playerCoordinates?.y,
        end_x: endX,
        end_y: endY,
        is_success: true,
        xt_value: 0.0,
        timestamp: String(ev.time || 0),
      });
    }
  }

  if (passesPayload.length > 0) {
    const chunkSize = 500;
    for (let i = 0; i < passesPayload.length; i += chunkSize) {
      const chunk = passesPayload.slice(i, i + chunkSize);
      try {
        await makeRequest('passes', chunk);
      } catch (error: any) {
        console.error(`Passes Chunk Error at ${i}:`, error);
      }
    }
    console.log(`Passes inserted. (${passesPayload.length})`);
  }

  if (eventsPayload.length > 0) {
    try {
      await makeRequest('match_events', eventsPayload);
      console.log(`Events inserted. (${eventsPayload.length})`);
    } catch (error: any) {
      console.error('Events Error:', error);
    }
  }
}
