/**
 * scripts/manual_sync.js
 *
 * Run a manual MICROS sales sync bypassing the HTTP layer.
 * Usage: node scripts/manual_sync.js [YYYY-MM-DD]
 *
 * Uses env vars from .env.local for MICROS credentials.
 */

const path = require('path');

// Load env files
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.production.local') });

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SERVICE_KEY in env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function main() {
  const date = process.argv[2] || new Date().toISOString().slice(0, 10);
  console.log('Manual sync for business date:', date);

  // Check MICROS connection
  const { data: conn } = await supabase
    .from('micros_connections')
    .select('id, loc_ref, status, last_sync_at, token_expires_at, access_token')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conn) {
    console.error('No MICROS connection found in database');
    process.exit(1);
  }

  console.log('Connection:', conn.id, '| loc_ref:', conn.loc_ref, '| status:', conn.status);
  console.log('Token expires:', conn.token_expires_at);
  
  const tokenExpired = conn.token_expires_at ? new Date(conn.token_expires_at) < new Date() : true;
  console.log('Token expired:', tokenExpired);

  if (tokenExpired) {
    console.log('Token is expired - sync needs to re-authenticate with Oracle');
  }

  // Trigger via local HTTP call to the deployed app
  console.log('');
  console.log('To trigger a sync, use one of these methods:');
  console.log('');
  console.log('1. FROM THE DASHBOARD:');
  console.log('   - Open https://si-cantina-concierge.vercel.app/dashboard');
  console.log('   - Click the "Sync All" or "Sync POS" button');
  console.log('');
  console.log('2. VIA CRON ENDPOINT (needs CRON_SECRET):');
  console.log('   curl "https://si-cantina-concierge.vercel.app/api/micros/sync" \\');
  console.log('     -H "Authorization: Bearer YOUR_CRON_SECRET"');
  console.log('');
  console.log('3. VIA LOCAL DEV SERVER:');
  console.log('   npm run dev');
  console.log('   Then: curl -X POST http://localhost:3000/api/micros/sync');
  console.log('');
  
  // Show current data
  const { data: sales } = await supabase
    .from('micros_sales_daily')
    .select('business_date, net_sales, gross_sales, check_count, synced_at')
    .order('business_date', { ascending: false })
    .limit(7);

  console.log('=== Current sales data (last 7 days) ===');
  if (sales && sales.length) {
    console.log('Date         | Net Sales | Gross Sales | Checks | Last Synced');
    console.log('-------------|-----------|-------------|--------|--------------------');
    sales.forEach(r => {
      const pad = (v, n) => String(v || 0).padStart(n);
      console.log(
        r.business_date + ' | R' + pad(r.net_sales, 8) +
        ' | R' + pad(r.gross_sales, 10) +
        ' | ' + pad(r.check_count, 6) +
        ' | ' + (r.synced_at || 'never')
      );
    });
  } else {
    console.log('  (no sales data)');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
