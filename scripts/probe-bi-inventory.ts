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

async function getToken(): Promise<string> {
  const { data } = await supabase
    .from('micros_connections')
    .select('access_token')
    .eq('loc_ref', '2000002')
    .single();
  return data?.access_token || '';
}

async function probe(method: string, pathStr: string, body?: string, headers?: Record<string,string>) {
  try {
    const res = await fetch(`${BASE}${pathStr}`, { method, headers, body });
    const text = await res.text();
    const preview = text.length < 500 ? text : text.substring(0, 300) + '...';
    const allow = res.headers.get('allow');
    console.log(`${res.status} ${method} ${pathStr}${allow ? ` [Allow:${allow}]` : ''}`);
    if (res.status !== 405 && res.status !== 404) {
      console.log(`  → ${preview}`);
    }
  } catch (e: any) {
    console.log(`ERR ${method} ${pathStr}: ${e.message?.substring(0, 60)}`);
  }
}

async function main() {
  const token = await getToken();
  console.log(`Token: ${token.length} chars\n`);

  // Part 1: IM path exploration
  console.log('=== /im/ path methods ===');
  await probe('OPTIONS', '/im/v1/SCS/GetStockOnHandList');
  await probe('GET', '/im/v1/SCS/GetStockOnHandList');
  await probe('GET', '/im/');
  await probe('GET', '/POSWebService/POSWebService.asmx');
  await probe('GET', '/POSWebService/POSWebService.asmx?wsdl');

  // Part 2: Inventory-related BI API endpoints
  console.log('\n=== BI API inventory endpoints ===');
  const endpoints = [
    'getStockOnHand',
    'getInventoryItems',
    'getStockItems',
    'getInventoryDimensions',
    'getInventoryDimensionList',
    'getInventoryDailyTotals',
    'getMenuItemInventory',
    'getMenuItemCost',
    'getMenuItemPrepCost',
    'getCostCenters',
    'getCostCenterDimensions',
    'getVendorDimensions',
    'getPurchaseOrderDimensions',
    'getRecipeDimensions',
    'getRecipeCost',
    'getFoodCost',
    'getFoodCostDailyTotals',
    'getWasteDimensions',
    'getWasteDailyTotals',
    'getTransferDimensions',
    'getTransferDailyTotals',
    'getCountSheetDimensions',
    'getCountSheetDailyTotals',
    'getMenuItemMajorGroupDimensions',
    'getMenuItemFamilyGroupDimensions',
    'getMenuItemDefinitionDimensions',
    'getMenuItemPriceDimensions',
    'getMenuItemClassDimensions',
    'getRevenueCenterDimensions',
    'getEmployeeDimensions',
    'getDiscountDimensions',
    'getTenderMediaDimensions',
  ];

  const body = JSON.stringify({
    locRef: '2000002',
    dateFrom: '2025-03-27',
    dateTo: '2025-03-27'
  });

  for (const ep of endpoints) {
    await probe('POST', `/bi/v1/SCS/${ep}`, body, {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    });
  }
}

main();
