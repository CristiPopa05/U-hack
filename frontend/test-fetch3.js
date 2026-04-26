const url = 'https://pecngylchgphppasuvpk.supabase.co/rest/v1';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlY25neWxjaGdwaHBwYXN1dnBrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA0MDA3NCwiZXhwIjoyMDkyNjE2MDc0fQ.UoM_ianLSZwmexNDmO9Pz-qzmBI7FQK9LYQwePAFCMQ';

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(url, key);

// Just copy pasting the logic for fetchTeamPasses
async function test() {
  const matchIds = ['14060334','14060365','14065018','14065026'];
  const playerIds = ["14054752867545"]; // Dummy
  
  try {
      const { data: passes, error: passesErr } = await supabase
        .from('passes')
        .select('x_start, y_start, x_end, y_end, outcome, match_id')
        .in('match_id', matchIds)
        .limit(5);

      if (passesErr) throw passesErr;
      
      console.log('Passes:', passes);
      
      passes.map(p => ({
        match_id: String(p.match_id),
        from: { x: p.x_start / 100, y: p.y_start / 100 },
        to: { x: p.x_end / 100, y: p.y_end / 100 },
        success: p.outcome === true || String(p.outcome).toLowerCase() === 'successful'
      }));
      console.log("Team passes worked");
  } catch(e) {
      console.error("FAILED", e);
  }
}
test();
