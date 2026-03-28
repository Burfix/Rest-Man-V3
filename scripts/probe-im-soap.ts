/**
 * Test MICROS IM SOAP endpoint + BI menu item dimensions
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });
dotenv.config({ path: path.resolve(__dirname, '..', '.env.production.local') });

for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (process.env[key]) process.env[key] = process.env[key]!.replace(/\\n$/g, '').trim();
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: conn } = await sb.from('micros_connections')
    .select('access_token, app_server_url, org_identifier, loc_ref')
    .eq('loc_ref', '2000002')
    .single();

  const token = conn!.access_token;
  const biServer = (process.env.MICROS_BI_SERVER || conn!.app_server_url || '').replace(/\/$/, '');
  const org = process.env.MICROS_ORG_SHORT_NAME || 'SCS';
  const locRef = conn!.loc_ref || '2000002';
  const username = process.env.MICROS_USERNAME || '';
  const password = process.env.MICROS_PASSWORD || '';

  // ── Test 1: SOAP request to /im/v1/GetStockOnHandList ──
  console.log('=== Test 1: SOAP GetStockOnHandList ===\n');

  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:pos="http://micros.com/POSWebService">
  <soap:Header>
    <pos:AuthHeader>
      <pos:User>${username}</pos:User>
      <pos:Password>${password}</pos:Password>
      <pos:Company>${org}</pos:Company>
    </pos:AuthHeader>
  </soap:Header>
  <soap:Body>
    <pos:GetStockOnHandList />
  </soap:Body>
</soap:Envelope>`;

  const soapPaths = [
    `/im/v1/${org}/GetStockOnHandList`,
    `/im/v1/GetStockOnHandList`,
    `/POSWebService/POSWebService.asmx`,
  ];

  for (const p of soapPaths) {
    const url = `${biServer}${p}`;
    console.log(`Trying SOAP: ${p}`);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': 'http://micros.com/POSWebService/GetStockOnHandList',
          'Authorization': `Bearer ${token}`,
        },
        body: soapEnvelope,
      });
      const text = await res.text();
      console.log(`  → ${res.status} ${res.statusText}`);
      console.log(`  → ${text.substring(0, 500)}`);
    } catch (err: any) {
      console.log(`  → ERROR: ${err.message}`);
    }
    console.log();
  }

  // ── Test 2: GET request to /im/ paths ──
  console.log('=== Test 2: GET /im/ paths ===\n');

  const getPaths = [
    `/im/v1/${org}/GetStockOnHandList`,
    `/im/v1/${org}/GetItemList`,
    `/im/v1/${org}`,
    `/im/v1/`,
  ];

  for (const p of getPaths) {
    const url = `${biServer}${p}`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const text = await res.text();
      console.log(`GET ${p} → ${res.status}`);
      console.log(`  → ${text.substring(0, 300)}`);
    } catch (err: any) {
      console.log(`GET ${p} → ERROR: ${err.message}`);
    }
    console.log();
  }

  // ── Test 3: BI API getMenuItemDimensions (no busDt) ──
  console.log('=== Test 3: getMenuItemDimensions ===\n');

  const res3 = await fetch(`${biServer}/bi/v1/${org}/getMenuItemDimensions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      applicationName: "ForgeStack",
      locRef: locRef,
    }),
  });
  const text3 = await res3.text();
  console.log(`getMenuItemDimensions → ${res3.status}`);
  console.log(text3.substring(0, 1500));

  // ── Test 4: Full menu item daily totals (has prepCost) ──
  console.log('\n=== Test 4: getMenuItemDailyTotals (full) ===\n');

  const res4 = await fetch(`${biServer}/bi/v1/${org}/getMenuItemDailyTotals`, {
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
  const data4 = await res4.json();
  const items = data4?.revenueCenters?.[0]?.menuItems || [];
  console.log(`Menu items with prepCost: ${items.length}`);
  console.log('Sample (first 5):');
  items.slice(0, 5).forEach((mi: any) => {
    console.log(`  MI#${mi.miNum}: sales=R${mi.slsTtl}, qty=${mi.slsCnt}, prepCost=R${mi.prepCost}`);
  });
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
