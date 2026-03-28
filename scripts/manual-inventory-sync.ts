/**
 * Manual MICROS Inventory Sync
 * Usage: npx tsx scripts/manual-inventory-sync.ts [YYYY-MM-DD]
 *
 * Bypasses API auth and calls syncMicrosInventory() directly.
 * Defaults to today's date if no argument given.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local first (MICROS_ vars), then .env.production.local (Supabase vars)
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });
dotenv.config({ path: path.resolve(__dirname, '..', '.env.production.local') });

// Fix trailing \n from Vercel CLI-generated env files
for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (process.env[key]) process.env[key] = process.env[key]!.replace(/\\n$/g, '').trim();
}

async function main() {
  const date = process.argv[2] || new Date().toISOString().slice(0, 10);
  console.log(`\n🔧 Manual Inventory Sync — date: ${date}\n`);
  console.log(`MICROS_ENABLED: ${process.env.MICROS_ENABLED}`);
  console.log(`MICROS_BI_SERVER: ${process.env.MICROS_BI_SERVER}`);
  console.log(`MICROS_ORG_SHORT_NAME: ${process.env.MICROS_ORG_SHORT_NAME}\n`);

  const { syncMicrosInventory } = await import('../services/micros/inventorySync');

  const result = await syncMicrosInventory({
    siteId: '00000000-0000-0000-0000-000000000001',
    businessDate: date,
    actorUserId: 'manual-cli',
    requestId: `manual-${Date.now()}`,
  });

  if (result.ok) {
    console.log(`✅ Inventory sync succeeded!`);
    console.log(`   Fetched: ${result.fetched}`);
    console.log(`   Inserted: ${result.inserted}`);
    console.log(`   Updated: ${result.updated}`);
    console.log(`   Failed: ${result.failed}`);
  } else {
    console.error(`❌ Inventory sync failed!`);
    console.error(`   Error: ${result.error}`);
    if (result.details) console.error(`   Details: ${result.details}`);
  }

  process.exit(result.ok ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
