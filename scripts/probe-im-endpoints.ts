/**
 * Probe Oracle MICROS server for Inventory Management endpoints.
 * Uses the existing BI API OAuth token (RNA credentials).
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });
dotenv.config({ path: path.resolve(__dirname, '..', '.env.production.local') });

for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (process.env[key]) process.env[key] = process.env[key]!.replace(/\\n$/g, '').trim();
}

async function main() {
  // 1. Get the existing OAuth token from DB
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: conn } = await sb.from('micros_connections')
    .select('access_token, token_expires_at, app_server_url, auth_server_url, org_identifier, loc_ref')
    .eq('loc_ref', '2000002')
    .single();

  if (!conn?.access_token) {
    console.error('No access token found in micros_connections');
    process.exit(1);
  }

  console.log('Token expires:', conn.token_expires_at);
  console.log('BI server:', conn.app_server_url);
  console.log('Org:', conn.org_identifier);
  console.log('Loc ref:', conn.loc_ref);

  const token = conn.access_token;
  const biServer = (process.env.MICROS_BI_SERVER || conn.app_server_url || '').replace(/\/$/, '');
  const org = process.env.MICROS_ORG_SHORT_NAME || conn.org_identifier || 'SCS';
  const locRef = conn.loc_ref || '2000002';

  // 2. Try different endpoint paths for GetStockOnHandList
  const paths = [
    `/bi/v1/${org}/GetStockOnHandList`,
    `/bi/v1/${org}/getStockOnHandList`,
    `/im/v1/${org}/GetStockOnHandList`,
    `/POSWebService/POSWebService.asmx/GetStockOnHandList`,
    `/inventory/v1/${org}/GetStockOnHandList`,
    `/bi/v1/${org}/getItemList`,
    `/bi/v1/${org}/GetItemList`,
  ];

  const body = JSON.stringify({
    applicationName: "ForgeStack",
    locRef: locRef,
  });

  console.log('\n=== Probing endpoints ===\n');

  for (const p of paths) {
    const url = `${biServer}${p}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body,
      });
      const text = await res.text();
      const preview = text.substring(0, 300);
      console.log(`${p}`);
      console.log(`  → ${res.status} ${res.statusText}`);
      console.log(`  → ${preview}`);
      console.log();
    } catch (err: any) {
      console.log(`${p}`);
      console.log(`  → ERROR: ${err.message}`);
      console.log();
    }
  }

  // 3. Also try the BI API endpoints related to inventory
  const biEndpoints = [
    'getMenuItemDailyTotals',
    'getMenuItemDimensions',
    'getMenuItemPriceDimensions',
  ];

  console.log('=== BI API inventory-adjacent endpoints ===\n');

  for (const ep of biEndpoints) {
    const url = `${biServer}/bi/v1/${org}/${ep}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          applicationName: "ForgeStack",
          busDt: "2026-03-27",
          locRef: locRef,
        }),
      });
      const text = await res.text();
      const preview = text.substring(0, 500);
      console.log(`${ep}`);
      console.log(`  → ${res.status} ${res.statusText}`);
      console.log(`  → ${preview}`);
      console.log();
    } catch (err: any) {
      console.log(`${ep}`);
      console.log(`  → ERROR: ${err.message}`);
      console.log();
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
