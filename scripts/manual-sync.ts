/**
 * Manual MICROS Sync Trigger
 *
 * Usage:
 *   SITE_ID=<uuid> ORG_ID=<uuid> MICROS_LOCATION_REF=<locRef> npx tsx scripts/manual-sync.ts [YYYY-MM-DD]
 *
 * All three env vars are REQUIRED — this script fails closed if any are missing.
 * Bypasses API auth and calls MicrosSyncService.runFullSync() directly.
 * Defaults to today's date if no date argument given.
 *
 * Example (Si Cantina):
 *   SITE_ID=00000000-0000-0000-0000-000000000002 \
 *   ORG_ID=00000000-0000-0000-0000-000000000001 \
 *   MICROS_LOCATION_REF=2000002 \
 *   npx tsx scripts/manual-sync.ts 2026-05-13
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local first (MICROS_ vars), then .env.production.local (Supabase vars)
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });
dotenv.config({ path: path.resolve(__dirname, '..', '.env.production.local') });

// Fix trailing \n from Vercel CLI-generated .env.production.local
for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (process.env[key]) process.env[key] = process.env[key]!.replace(/\\n$/g, '').trim();
}

async function main() {
  // ── Require explicit tenant context ──────────────────────────────────────
  const siteId            = (process.env.SITE_ID ?? '').trim();
  const organisationId    = (process.env.ORG_ID ?? '').trim();
  const microsLocationRef = (process.env.MICROS_LOCATION_REF ?? process.env.MICROS_LOC_REF ?? '').trim();

  if (!siteId) {
    console.error('\n❌ SITE_ID env var is required. Set it before running this script.');
    console.error('   Example: SITE_ID=00000000-0000-0000-0000-000000000002 ...\n');
    process.exit(1);
  }
  if (!organisationId) {
    console.error('\n❌ ORG_ID env var is required. Set it before running this script.');
    process.exit(1);
  }
  if (!microsLocationRef) {
    console.error('\n❌ MICROS_LOCATION_REF env var is required. Set it before running this script.');
    process.exit(1);
  }

  const date = process.argv[2] || new Date().toISOString().split('T')[0];
  console.log(`\n🔄 Manual MICROS sync`);
  console.log(`   Site ID:     ${siteId}`);
  console.log(`   Org ID:      ${organisationId}`);
  console.log(`   Location Ref: ${microsLocationRef}`);
  console.log(`   Date:        ${date}\n`);

  // Dynamic import after env is set
  const { MicrosSyncService } = await import('../services/micros/MicrosSyncService');
  
  const service = new MicrosSyncService();
  const result = await service.runFullSync({ siteId, organisationId, microsLocationRef }, date);
  
  if (result.success) {
    console.log(`✅ Sync succeeded!`);
    console.log(`   Business date: ${result.businessDate}`);
    console.log(`   Records synced: ${result.recordsSynced}`);
    console.log(`   Message: ${result.message}`);
  } else {
    console.error(`❌ Sync failed!`);
    console.error(`   Message: ${result.message}`);
    if (result.errors) {
      console.error(`   Errors:`, result.errors);
    }
  }
  
  process.exit(result.success ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

