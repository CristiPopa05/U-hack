import { fetchTopPlaymakers, fetchTeamPasses, fetchPlayerPasses } from './src/lib/spatial-service';

async function test() {
  try {
    console.log('Fetching passes...');
    const tPasses = await fetchTeamPasses('FCSB', 5);
    console.log('Team passes:', tPasses.length);
    
    console.log('Fetching top playmakers...');
    const pms = await fetchTopPlaymakers('FCSB', 5);
    console.log('Playmakers:', pms.length);
  } catch(e) {
    console.error('ERROR OCCURRED:', e);
  }
}

test();
