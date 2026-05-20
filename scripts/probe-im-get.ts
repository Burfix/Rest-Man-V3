import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });
dotenv.config({ path: path.resolve(__dirname, '..', '.env.production.local') });

for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (process.env[key]) process.env[key] = process.env[key]!.replace(/\\n$/g, '').trim();
}

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BASE = 'https://simphony-home.msaf.oraclerestaurants.com';
const RNA_USER = 'THAMI';
const RNA_PASS = process.env.RNA_PASSWORD || '';

async function getToken(): Promise<string> {
  const { data } = await supabase
    .from('micros_connections')
    .select('access_token')
    .eq('loc_ref', '2000002')
    .single();
  return data?.access_token || '';
}

async function tryGet(pathStr: string, headers: Record<string,string>, label: string) {
  try {
    const res = await fetch(`${BASE}${pathStr}`, { method: 'GET', headers });
    const text = await res.text();
    console.log(`\n[${label}] GET ${pathStr} → ${res.status}`);
    console.log(text.substring(0, 1000));
  } catch (e: any) {
    console.log(`\n[${label}] GET ${pathStr} → ERROR: ${e.message?.substring(0, 80)}`);
  }
}

async function main() {
  const token = await getToken();
  const basicAuth = Buffer.from(`${RNA_USER}:${RNA_PASS}`).toString('base64');

  console.log('=== GET /im/v1/SCS/GetStockOnHandList with auth ===');

  // Try Bearer token
  await tryGet('/im/v1/SCS/GetStockOnHandList', {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json'
  }, 'Bearer+JSON');

  await tryGet('/im/v1/SCS/GetStockOnHandList', {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/xml'
  }, 'Bearer+XML');

  // Try Basic auth with RNA credentials
  await tryGet('/im/v1/SCS/GetStockOnHandList', {
    'Authorization': `Basic ${basicAuth}`,
    'Accept': 'application/json'
  }, 'Basic+JSON');

  // No auth
  await tryGet('/im/v1/SCS/GetStockOnHandList', {
    'Accept': 'application/json'
  }, 'NoAuth');

  // Try different path formats
  console.log('\n=== Try other /im/ path formats ===');
  
  const imPaths = [
    '/im/v1/SCS/GetStockOnHandList',
    '/im/v1/2000002/GetStockOnHandList',
    '/im/v1/SCS/stockOnHand',
    '/im/v1/SCS/stock-on-hand', 
    '/im/v1/SCS/inventory',
    '/im/v1/SCS',
    '/im/v1',
    '/im/v1/SCS/GetStockOnHandListByLocation',
    '/im/v1/SCS/GetStockOnHandListByCostCenter',
    '/im/v1/SCS/GetStockOnHandListByItem',
    '/im/v1/SCS/GetMenuItemList',
    '/im/v1/SCS/GetVendorList',
    '/im/v1/SCS/GetPurchaseOrderList',
    '/im/v1/SCS/GetCostCenterList',
    '/im/v1/SCS/GetCountList',
    '/im/v1/SCS/GetTransferList',
  ];

  for (const p of imPaths) {
    await tryGet(p, {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }, 'Bearer');
  }

  // Try dimension endpoints that exist but needed different params  
  console.log('\n=== Working dimension endpoints (no dateFrom) ===');
  const dimEndpoints = [
    'getRevenueCenterDimensions',
    'getEmployeeDimensions',
    'getDiscountDimensions',
    'getTenderMediaDimensions',
  ];

  for (const ep of dimEndpoints) {
    try {
      const res = await fetch(`${BASE}/bi/v1/SCS/${ep}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ locRef: '2000002' })
      });
      const text = await res.text();
      console.log(`\n${ep} → ${res.status} (${text.length} chars)`);
      console.log(text.substring(0, 300));
    } catch (e: any) {
      console.log(`${ep} → ERROR`);
    }
  }
}

main();
