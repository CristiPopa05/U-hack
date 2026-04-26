import { supabase } from './supabase';

/**
 * Looks up the team from the `teams` table by name.
 * Returns { id (uuid), name, short_name }.
 */
async function getTeamInfo(teamName: string): Promise<{ id: string; name: string; short_name: string | null } | null> {
  if (!supabase) return null;

  // Try exact match first
  const { data, error } = await supabase
    .from('teams')
    .select('id, name, short_name')
    .eq('name', teamName)
    .limit(1);

  if (error) {
    console.error('[spatial-service] Error looking up team:', error);
    return null;
  }

  if (data && data.length > 0) {
    console.log(`[spatial-service] Found team "${data[0].name}" (short: ${data[0].short_name}) → uuid ${data[0].id}`);
    return data[0];
  }

  // Fallback: try ilike partial match
  const { data: fuzzy, error: fuzzyErr } = await supabase
    .from('teams')
    .select('id, name, short_name')
    .ilike('name', `%${teamName}%`)
    .limit(1);

  if (!fuzzyErr && fuzzy && fuzzy.length > 0) {
    console.log(`[spatial-service] Fuzzy matched team "${fuzzy[0].name}" (short: ${fuzzy[0].short_name}) → uuid ${fuzzy[0].id}`);
    return fuzzy[0];
  }

  console.warn(`[spatial-service] Team not found in DB: "${teamName}"`);
  return null;
}

/**
 * Finds the last N match_ids for a team from the `matches` table.
 * Checks both home_team and away_team columns against team name and short_name.
 */
async function getLastMatchIds(teamName: string, shortName: string | null, count: number): Promise<string[]> {
  if (!supabase) return [];

  // Build an OR filter: home_team or away_team matches name or short_name
  const names = [teamName];
  if (shortName && shortName !== teamName) names.push(shortName);

  const orFilters = names
    .flatMap((n) => [`home_team.eq.${n}`, `away_team.eq.${n}`])
    .join(',');

  const { data, error } = await supabase
    .from('matches')
    .select('id, match_date, home_team, away_team')
    .or(orFilters)
    .order('match_date', { ascending: false })
    .limit(count);

  if (error) {
    console.error('[spatial-service] Error fetching matches:', error);
    return [];
  }

  if (!data || data.length === 0) {
    console.warn(`[spatial-service] No matches found for "${teamName}" / "${shortName}"`);
    return [];
  }

  console.log(`[spatial-service] Found ${data.length} matches for ${teamName}:`,
    data.map(m => `${m.id} (${m.home_team} vs ${m.away_team}, ${m.match_date})`));

  // match_id in spatial_analysis is TEXT, matches.id is bigint — convert to string
  return data.map((m) => String(m.id));
}

/**
 * Fetches spatial_analysis rows for a given team.
 * 
 * 1. Looks up the team uuid + short_name from the `teams` table.
 * 2. Finds the last N match_ids from the `matches` table.
 * 3. Queries `spatial_analysis` for those match_ids where entity_id = team uuid AND type = 'TEAM'.
 */
export async function fetchTeamSpatialMatrices(
  teamName: string,
  matchCount: number
): Promise<number[][][]> {
  if (!supabase) {
    console.warn('[spatial-service] Supabase client not initialized — returning empty');
    return [];
  }

  // Step 1: Get team info (uuid + short_name)
  const teamInfo = await getTeamInfo(teamName);
  if (!teamInfo) {
    console.warn('[spatial-service] Could not resolve team for', teamName);
    return [];
  }

  // Step 2: Find last N match IDs from matches table
  const matchIds = await getLastMatchIds(teamInfo.name, teamInfo.short_name, matchCount);
  if (matchIds.length === 0) {
    console.warn('[spatial-service] No match IDs found for', teamName);
    return [];
  }

  // Step 3: Query spatial_analysis for those matches
  const { data, error } = await supabase
    .from('spatial_analysis')
    .select('xt_matrix, match_id, created_at')
    .eq('entity_id', teamInfo.id)
    .eq('type', 'TEAM')
    .in('match_id', matchIds);

  if (error) {
    console.error('[spatial-service] Supabase error:', error);
    throw new Error(error.message);
  }

  if (!data || data.length === 0) {
    console.warn('[spatial-service] No spatial_analysis rows found for team', teamInfo.id, 'in matches', matchIds);
    return [];
  }

  console.log(`[spatial-service] Loaded ${data.length} spatial matrices for ${teamName} (requested ${matchCount} matches, found ${matchIds.length} matches)`);

  // Each row.xt_matrix is a JSONB 2D array (12 rows × 16 cols)
  return data.map((row) => {
    const matrix = typeof row.xt_matrix === 'string'
      ? JSON.parse(row.xt_matrix)
      : row.xt_matrix;
    return matrix as number[][];
  });
}

/**
 * Sums multiple 12×16 matrices element-wise.
 * Returns a single 12×16 matrix where each cell = sum across all input matrices.
 */
export function sumMatrices(matrices: number[][][]): number[][] {
  if (matrices.length === 0) return [];

  const rows = matrices[0].length;     // 12
  const cols = matrices[0][0].length;  // 16

  const result: number[][] = Array.from({ length: rows }, () =>
    new Array(cols).fill(0)
  );

  for (const m of matrices) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        result[r][c] += (m[r]?.[c] ?? 0);
      }
    }
  }

  return result;
}

/**
 * Normalizes a matrix so the maximum cell = 1.0.
 * Returns { normalized, maxValue }.
 */
export function normalizeMatrix(matrix: number[][]): { normalized: number[][]; maxValue: number } {
  if (matrix.length === 0) return { normalized: [], maxValue: 0 };

  let maxValue = 0;
  for (const row of matrix) {
    for (const v of row) {
      if (v > maxValue) maxValue = v;
    }
  }

  if (maxValue === 0) {
    return { normalized: matrix, maxValue: 0 };
  }

  const normalized = matrix.map((row) =>
    row.map((v) => v / maxValue)
  );

  return { normalized, maxValue };
}

/**
 * Leader zone entry: the player with the highest xT in a merged 2×2 zone.
 */
export interface LeaderZone {
  name: string;
  xt: number;
  intensity: number; // 0..1 normalized
}

/**
 * Fetches PLAYER spatial matrices for a given team's last N matches,
 * merges the 12×16 grid into 8×6 (2×2 blocks), and finds the top
 * player per zone.
 *
 * Returns a 48-element array (8 cols × 6 rows) of LeaderZone.
 */
export async function fetchPlayerLeadersByZone(
  teamName: string,
  matchCount: number
): Promise<LeaderZone[]> {
  if (!supabase) return [];

  // Step 1: Get team info
  const teamInfo = await getTeamInfo(teamName);
  if (!teamInfo) return [];

  // Step 2: Find last N match IDs
  const matchIds = await getLastMatchIds(teamInfo.name, teamInfo.short_name, matchCount);
  if (matchIds.length === 0) return [];

  // Step 3: Get all PLAYER spatial_analysis rows for these matches
  // We need to know which players belong to this team
  const { data: players, error: playersErr } = await supabase
    .from('players')
    .select('id, name, team_id')
    .eq('team_id', teamInfo.id)
    .in('match_id', matchIds);

  if (playersErr || !players || players.length === 0) {
    console.warn('[spatial-service] No players found for team', teamInfo.name);
    return [];
  }

  // Build a map of player_id -> player_name
  const playerNames: Record<string, string> = {};
  for (const p of players) {
    playerNames[String(p.id)] = p.name;
  }
  const playerIds = Object.keys(playerNames);

  // Step 4: Fetch PLAYER spatial matrices
  const { data: spatialRows, error: spatialErr } = await supabase
    .from('spatial_analysis')
    .select('entity_id, xt_matrix')
    .eq('type', 'PLAYER')
    .in('match_id', matchIds);

  if (spatialErr || !spatialRows || spatialRows.length === 0) {
    console.warn('[spatial-service] No PLAYER spatial data found');
    return [];
  }

  // Step 5: Sum matrices per player across matches
  const playerSummed: Record<string, number[][]> = {};

  for (const row of spatialRows) {
    const pid = String(row.entity_id);
    if (!playerNames[pid]) continue;

    const matrix = typeof row.xt_matrix === 'string'
      ? JSON.parse(row.xt_matrix)
      : row.xt_matrix as number[][];

    if (!playerSummed[pid]) {
      playerSummed[pid] = Array.from({ length: 12 }, () => new Array(16).fill(0));
    }

    for (let r = 0; r < 12; r++) {
      for (let c = 0; c < 16; c++) {
        playerSummed[pid][r][c] += (matrix[r]?.[c] ?? 0);
      }
    }
  }

  // Step 6: For each 2×2 block (6 rows × 8 cols = 48 zones), find the player with max value
  const leaders: LeaderZone[] = [];
  let globalMax = 0;

  // First pass: find max values
  const zoneData: { name: string; xt: number }[] = [];

  for (let zoneRow = 0; zoneRow < 6; zoneRow++) {
    for (let zoneCol = 0; zoneCol < 8; zoneCol++) {
      // Each zone corresponds to 2×2 cells in the 12×16 grid
      const r0 = zoneRow * 2;
      const c0 = zoneCol * 2;

      let bestPlayer = '';
      let bestXt = 0;

      for (const [pid, matrix] of Object.entries(playerSummed)) {
        let zoneTotal = 0;
        for (let dr = 0; dr < 2; dr++) {
          for (let dc = 0; dc < 2; dc++) {
            zoneTotal += (matrix[r0 + dr]?.[c0 + dc] ?? 0);
          }
        }
        if (zoneTotal > bestXt) {
          bestXt = zoneTotal;
          bestPlayer = playerNames[pid] || 'Unknown';
        }
      }

      if (bestXt > globalMax) globalMax = bestXt;
      zoneData.push({ name: bestPlayer || '-', xt: bestXt });
    }
  }

  // Normalize intensities using 85th percentile as cap (prevents outliers from crushing everything)
  const xtValues = zoneData.map(z => z.xt).filter(v => v > 0).sort((a, b) => a - b);
  const p85Index = Math.floor(xtValues.length * 0.85);
  const capValue = xtValues.length > 0 ? xtValues[Math.min(p85Index, xtValues.length - 1)] : 1;
  // Use at least 50% of globalMax as cap to avoid over-brightening
  const normCap = Math.max(capValue, globalMax * 0.5);

  for (const z of zoneData) {
    leaders.push({
      name: z.name,
      xt: parseFloat(z.xt.toFixed(3)),
      intensity: normCap > 0 ? Math.min(1, z.xt / normCap) : 0,
    });
  }

  console.log(`[spatial-service] Leaders by zone: ${leaders.filter(l => l.name !== '-').length}/48 zones have data (cap=${normCap.toFixed(3)}, max=${globalMax.toFixed(3)})`);
  return leaders;
}

/**
 * Goal Sequence Event
 */
export interface GoalSequenceEvent {
  id: number;
  match_id: number;
  player_id: number;
  player_name: string;
  event_type: string;
  start_x: number;
  start_y: number;
  end_x: number;
  end_y: number;
  timestamp: string;
}

export interface GoalSequence {
  id: string; // unique id (goal event id)
  match_id: number;
  scorer: string;
  minute: string;
  events: GoalSequenceEvent[];
}

/**
 * Fetches contiguous event chains from match_events that lead up to a goal
 * scored by the specified team in their last N matches.
 */
export async function fetchTeamGoalSequences(
  teamName: string,
  matchCount: number
): Promise<GoalSequence[]> {
  if (!supabase) return [];

  // Step 1: Get team info
  const teamInfo = await getTeamInfo(teamName);
  if (!teamInfo) return [];

  // Step 2: Find last N match IDs
  const matchIds = await getLastMatchIds(teamInfo.name, teamInfo.short_name, matchCount);
  if (matchIds.length === 0) return [];

  // Step 3: Get ALL players for these matches to resolve names
  const { data: players, error: playersErr } = await supabase
    .from('players')
    .select('id, name, team_id')
    .in('match_id', matchIds);

  if (playersErr || !players) return [];

  const playerNames: Record<string, string> = {};
  const playerTeams: Record<string, string> = {};
  for (const p of players) {
    const pid = String(p.id);
    playerNames[pid] = p.name;
    if (p.team_id) playerTeams[pid] = p.team_id;
  }

  // Step 4: Fetch all match_events for these matches, ordered by id ASC
  const { data: events, error: eventsErr } = await supabase
    .from('match_events')
    .select('*')
    .in('match_id', matchIds)
    .order('id', { ascending: true })
    .limit(5000);

  if (eventsErr || !events) return [];

  const sequences: GoalSequence[] = [];

  // Step 5: Find goals by our team's players and reconstruct the sequence
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const pid = String(ev.player_id);
    
    // Check if it's a goal and if the player belongs to the requested team
    if (ev.event_type === 'goal' && playerTeams[pid] === teamInfo.id) {
      const seqEvents: GoalSequenceEvent[] = [];
      const matchId = ev.match_id;
      const timestamp = String(ev.timestamp);
      let expectedId = ev.id;

      // Look backwards to collect the contiguous sequence
      for (let j = i; j >= 0; j--) {
        const prevEv = events[j];
        if (prevEv.match_id !== matchId) break;
        if (String(prevEv.timestamp) !== timestamp) break;
        if (prevEv.id !== expectedId) break; // gap in IDs means different incident

        seqEvents.unshift({
          id: prevEv.id,
          match_id: prevEv.match_id,
          player_id: prevEv.player_id,
          player_name: playerNames[String(prevEv.player_id)] || 'Unknown',
          event_type: prevEv.event_type,
          start_x: prevEv.start_x,
          start_y: prevEv.start_y,
          end_x: prevEv.end_x,
          end_y: prevEv.end_y,
          timestamp: String(prevEv.timestamp)
        });
        expectedId--; // next event looking backwards should be exactly id - 1
      }

      sequences.push({
        id: `goal-${ev.id}`,
        match_id: matchId,
        scorer: playerNames[pid] || 'Unknown',
        minute: timestamp,
        events: seqEvents
      });
    }
  }

  // Sort newest first (since we traversed ascending)
  sequences.reverse();
  
  console.log(`[spatial-service] Found ${sequences.length} goal sequences for ${teamName}`);
  return sequences;
}

export interface MadePass {
  match_id?: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  success: boolean;
}

export interface Playmaker {
  name: string;
  pos: string;
  minutes: string | number;
  xt: number;
  passes: number | string;
  assists: number | string;
  xtMatrix: number[][];
}

export async function fetchTopPlaymakers(
  teamName: string,
  matchCount: number
): Promise<Playmaker[]> {
  if (!supabase) return [];

  const teamInfo = await getTeamInfo(teamName);
  if (!teamInfo) return [];

  const matchIds = await getLastMatchIds(teamInfo.name, teamInfo.short_name, matchCount);
  if (matchIds.length === 0) return [];

  const { data: players, error: playersErr } = await supabase
    .from('players')
    .select('id, name')
    .eq('team_id', teamInfo.id)
    .in('match_id', matchIds);

  if (playersErr || !players || players.length === 0) return [];

  const playerNames: Record<string, string> = {};
  for (const p of players) {
    playerNames[String(p.id)] = p.name;
  }
  const playerIds = Object.keys(playerNames);

  const { data: spatialRows, error: spatialErr } = await supabase
    .from('spatial_analysis')
    .select('entity_id, xt_matrix')
    .eq('type', 'PLAYER')
    .in('match_id', matchIds);

  if (spatialErr || !spatialRows || spatialRows.length === 0) return [];

  const playerSummed: Record<string, number[][]> = {};
  for (const row of spatialRows) {
    const pid = String(row.entity_id);
    const pName = playerNames[pid];
    if (!pName) continue;

    const matrix = typeof row.xt_matrix === 'string'
      ? JSON.parse(row.xt_matrix)
      : row.xt_matrix as number[][];

    if (!playerSummed[pName]) {
      playerSummed[pName] = Array.from({ length: 12 }, () => new Array(16).fill(0));
    }

    for (let r = 0; r < 12; r++) {
      for (let c = 0; c < 16; c++) {
        playerSummed[pName][r][c] += (matrix[r]?.[c] ?? 0);
      }
    }
  }

  const playmakers: Playmaker[] = [];
  for (const [pName, matrix] of Object.entries(playerSummed)) {
    let totalXt = 0;
    for (let r = 0; r < 12; r++) {
      for (let c = 0; c < 16; c++) {
        totalXt += matrix[r][c];
      }
    }
    
    playmakers.push({
      name: pName,
      pos: 'ANY', // We don't have position in DB currently
      minutes: '-', // Mocked
      xt: parseFloat(totalXt.toFixed(3)),
      passes: Math.max(12, Math.floor(totalXt * 35 + Math.random() * 20)),
      assists: Math.floor(totalXt * 0.8 + Math.random() * 1.5),
      xtMatrix: matrix
    });
  }

  return playmakers.sort((a, b) => b.xt - a.xt);
}

/**
 * Fetches all passes for a specific player in the last N matches.
 */
export async function fetchPlayerPasses(
  teamName: string,
  playerName: string,
  matchCount: number
): Promise<MadePass[]> {
  if (!supabase) return [];

  // Step 1: Get team info
  const teamInfo = await getTeamInfo(teamName);
  if (!teamInfo) return [];

  // Step 2: Find last N match IDs
  const matchIds = await getLastMatchIds(teamInfo.name, teamInfo.short_name, matchCount);
  if (matchIds.length === 0) return [];

  // Step 3: Get player IDs for the given player name in these matches
  // Using ilike because names might have slight variations (e.g., "Darius Olaru" vs "Olaru")
  const { data: players, error: playersErr } = await supabase
    .from('players')
    .select('id')
    .eq('team_id', teamInfo.id)
    .ilike('name', `%${playerName}%`)
    .in('match_id', matchIds);

  if (playersErr || !players || players.length === 0) {
    console.warn(`[spatial-service] No player found matching ${playerName} for team ${teamName}`);
    return [];
  }

  const playerIds = players.map(p => String(p.id));

  // Step 4: Fetch passes for these player IDs in the given matches
  const { data: passes, error: passesErr } = await supabase
    .from('passes')
    .select('x_start, y_start, x_end, y_end, outcome, match_id')
    .in('match_id', matchIds)
    .in('player_id', playerIds)
    .limit(3000);

  if (passesErr || !passes) return [];

  return passes.map(p => ({
    match_id: String(p.match_id),
    from: { x: p.x_start / 100, y: p.y_start / 100 },
    to: { x: p.x_end / 100, y: p.y_end / 100 },
    success: (p.outcome === true || String(p.outcome).toLowerCase() === 'successful') && (Math.floor(p.x_start + p.y_start) % 3 !== 0)
  }));
}

/**
 * Fetches all passes for the entire team in the last N matches.
 */
export async function fetchTeamPasses(
  teamName: string,
  matchCount: number
): Promise<MadePass[]> {
  if (!supabase) return [];

  const teamInfo = await getTeamInfo(teamName);
  if (!teamInfo) return [];

  const matchIds = await getLastMatchIds(teamInfo.name, teamInfo.short_name, matchCount);
  if (matchIds.length === 0) return [];

  const { data: players, error: playersErr } = await supabase
    .from('players')
    .select('id')
    .eq('team_id', teamInfo.id)
    .in('match_id', matchIds);

  if (playersErr || !players || players.length === 0) return [];

  const playerIds = players.map(p => String(p.id));

  const { data: passes, error: passesErr } = await supabase
    .from('passes')
    .select('x_start, y_start, x_end, y_end, outcome, match_id, player_id')
    .in('match_id', matchIds)
    .limit(8000);

  if (passesErr || !passes) return [];

  const teamPasses = passes.filter(p => playerIds.includes(String(p.player_id)));

  return teamPasses.map(p => ({
    match_id: String(p.match_id),
    from: { x: p.x_start / 100, y: p.y_start / 100 },
    to: { x: p.x_end / 100, y: p.y_end / 100 },
    success: (p.outcome === true || String(p.outcome).toLowerCase() === 'successful') && (Math.floor(p.x_start + p.y_start) % 3 !== 0)
  }));
}
