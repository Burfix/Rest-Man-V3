/**
 * Manual MICROS Sync Trigger
 * Usage: npx tsx scripts/manual-sync.ts [YYYY-MM-DD]
 * 
 * Bypasses API auth and calls MicrosSyncService.runFullSync() directly.
 * Defaults to today's date if no argument given.
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
  const date = process.argv[2] || new Date().toISOString().split('T')[0];
  console.log(`\n🔄 Manual MICROS sync for date: ${date}\n`);

  // Dynamic import after env is set
  const { MicrosSyncService } = await import('../services/micros/MicrosSyncService');
  
  const service = new MicrosSyncService();
  const result = await service.runFullSync(date);
  
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
