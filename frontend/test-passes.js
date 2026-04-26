const url = 'https://pecngylchgphppasuvpk.supabase.co/rest/v1';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlY25neWxjaGdwaHBwYXN1dnBrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA0MDA3NCwiZXhwIjoyMDkyNjE2MDc0fQ.UoM_ianLSZwmexNDmO9Pz-qzmBI7FQK9LYQwePAFCMQ';

async function test() {
  const headers = { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' };

  try {
    const r1 = await fetch(url + '/passes?select=outcome&outcome=neq.true&limit=20', { headers });
    const passes = await r1.json();
    console.log("Neq True Outcomes:", passes);
  } catch (e) {
    console.error(e);
  }
}
test();
