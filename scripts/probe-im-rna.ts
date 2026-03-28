/**
 * Test MICROS IM with RNA credentials (THAMI/SCS)
 * Try multiple auth methods and server variations
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });
dotenv.config({ path: path.resolve(__dirname, '..', '.env.production.local') });

for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (process.env[key]) process.env[key] = process.env[key]!.replace(/\\n$/g, '').trim();
}

const RNA_USER = 'THAMI';
const RNA_PASS = process.env.RNA_PASSWORD || '';
const RNA_COMPANY = 'SCS';

async function main() {
  if (!RNA_PASS) {
    console.error('Set RNA_PASSWORD env var');
    process.exit(1);
  }

  // Get existing OAuth token
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: conn } = await sb.from('micros_connections')
    .select('access_token, app_server_url')
    .eq('loc_ref', '2000002').single();
  const token = conn!.access_token;
  const biServer = (process.env.MICROS_BI_SERVER || conn!.app_server_url || '').replace(/\/$/, '');

  // Possible IM server hostnames
  const servers = [
    biServer,
    'https://im.msaf.oraclerestaurants.com',
    'https://ors-im.msaf.oraclerestaurants.com',
    'https://inventory.msaf.oraclerestaurants.com',
  ];

  // SOAP envelope for GetStockOnHandList (no filter = all items)
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:pos="http://micros.com/POSWebService">
  <soap:Header>
    <pos:AuthHeader>
      <pos:User>${RNA_USER}</pos:User>
      <pos:Password>${RNA_PASS}</pos:Password>
      <pos:Company>${RNA_COMPANY}</pos:Company>
    </pos:AuthHeader>
  </soap:Header>
  <soap:Body>
    <pos:GetStockOnHandList>
      <pos:item><pos:Number>0</pos:Number></pos:item>
    </pos:GetStockOnHandList>
  </soap:Body>
</soap:Envelope>`;

  const paths = [
    '/POSWebService/POSWebService.asmx',
    '/im/POSWebService/POSWebService.asmx',
    '/im/v1/SCS/GetStockOnHandList',
    '/InventoryManagement/POSWebService.asmx',
  ];

  // Auth variations
  const authMethods = [
    { name: 'SOAP-only', headers: {} },
    { name: 'Bearer+SOAP', headers: { 'Authorization': `Bearer ${token}` } },
    { name: 'Basic+SOAP', headers: { 'Authorization': `Basic ${Buffer.from(`${RNA_USER}:${RNA_PASS}`).toString('base64')}` } },
  ];

  for (const server of servers) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Server: ${server}`);
    console.log(`${'='.repeat(60)}`);

    for (const p of paths) {
      for (const auth of authMethods) {
        const url = `${server}${p}`;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8000);
          
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'text/xml; charset=utf-8',
              'SOAPAction': 'http://micros.com/POSWebService/GetStockOnHandList',
              ...auth.headers,
            },
            body: soapBody,
            signal: controller.signal,
          });
          clearTimeout(timer);
          
          const text = await res.text();
          // Only print if not 404/405
          if (res.status !== 404 && res.status !== 405) {
            console.log(`\n  ${auth.name} POST ${p}`);
            console.log(`    → ${res.status} ${res.statusText}`);
            console.log(`    → ${text.substring(0, 400)}`);
          } else {
            console.log(`  ${auth.name} POST ${p} → ${res.status}`);
          }
        } catch (err: any) {
          if (err.name === 'AbortError') {
            console.log(`  ${auth.name} POST ${p} → TIMEOUT (server unreachable)`);
            // Skip remaining auth methods for this server+path
            break;
          } else {
            console.log(`  ${auth.name} POST ${p} → ${err.code || err.message}`);
            break; // Connection error = server doesn't exist
          }
        }
      }
    }
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
