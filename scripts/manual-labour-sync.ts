/**
 * Manual Labour Sync Trigger
 * Usage: npx tsx scripts/manual-labour-sync.ts [YYYY-MM-DD] [mode]
 * mode: "full" (default) or "delta"
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });
dotenv.config({ path: path.resolve(__dirname, '..', '.env.production.local') });

for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (process.env[key]) process.env[key] = process.env[key]!.replace(/\\n$/g, '').trim();
}

async function main() {
  const date = process.argv[2] || new Date().toISOString().split('T')[0];
  const mode = process.argv[3] || 'full';
  console.log(`\n🔄 Manual Labour sync — mode: ${mode}, date: ${date}\n`);

  const { MicrosLabourService } = await import('../services/micros/MicrosLabourService');
  const service = new MicrosLabourService();

  const result = mode === 'delta'
    ? await service.syncDelta()
    : await service.syncFull(date);

  if (result.success) {
    console.log(`✅ Labour sync succeeded!`);
    console.log(`   Timecards synced: ${result.timecardsUpserted ?? 'N/A'}`);
    console.log(`   Message: ${result.message}`);
  } else {
    console.error(`❌ Labour sync failed!`);
    console.error(`   Message: ${result.message}`);
    if (result.errors) console.error(`   Errors:`, result.errors);
  }

  process.exit(result.success ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
