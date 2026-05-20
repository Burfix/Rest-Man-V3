const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  'https://bdzcydhrdjprdzywjbeu.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkemN5ZGhyZGpwcmR6eXdqYmV1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzMwMjUzNSwiZXhwIjoyMDg4ODc4NTM1fQ.mTnTAP3SpuzDN7KEI0sBusYS36WmZzjcOXvQInWMlh8'
);

async function check() {
  const { data: lastSync } = await sb
    .from('micros_sync_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(3);

  console.log('=== Last 3 micros_sync_runs ===');
  if (lastSync && lastSync.length) {
    lastSync.forEach(r => {
      console.log('  ' + r.created_at + ' | ' + r.status + ' | records: ' + r.records_synced + ' | err: ' + (r.error_message || 'none'));
    });
  } else {
    console.log('  (no sync runs found)');
  }

  const { data: lastSales } = await sb
    .from('micros_sales_daily')
    .select('business_date, net_sales, synced_at')
    .order('business_date', { ascending: false })
    .limit(5);

  console.log('');
  console.log('=== Last 5 micros_sales_daily ===');
  if (lastSales && lastSales.length) {
    lastSales.forEach(r => {
      console.log('  ' + r.business_date + ' | net_sales: ' + r.net_sales + ' | synced: ' + r.synced_at);
    });
  } else {
    console.log('  (no sales data found)');
  }

  const { data: conn } = await sb
    .from('micros_connections')
    .select('id, loc_ref, status, last_sync_at, token_expires_at')
    .limit(1)
    .maybeSingle();

  console.log('');
  console.log('=== MICROS Connection ===');
  if (conn) {
    console.log('  id: ' + conn.id);
    console.log('  loc_ref: ' + conn.loc_ref);
    console.log('  status: ' + conn.status);
    console.log('  last_sync_at: ' + conn.last_sync_at);
    console.log('  token_expires: ' + conn.token_expires_at);
    var expired = conn.token_expires_at ? new Date(conn.token_expires_at) < new Date() : true;
    console.log('  token_expired: ' + expired);
  } else {
    console.log('  (no connection found)');
  }

  // Check V2 sync_runs
  const { data: v2Runs } = await sb
    .from('sync_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(3);

  console.log('');
  console.log('=== V2 sync_runs ===');
  if (v2Runs && v2Runs.length) {
    v2Runs.forEach(r => {
      console.log('  ' + r.created_at + ' | ' + r.status + ' | type: ' + r.sync_type + ' | err: ' + (r.error_message || 'none'));
    });
  } else {
    console.log('  (no V2 sync runs yet)');
  }
}

check();
