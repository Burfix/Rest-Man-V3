/**
 * Quick probe: test MICROS Inventory Management SOAP API
 * Usage: npx tsx scripts/test-inv-soap.ts
 */

const BASE_URL = process.env.MICROS_INV_APP_SERVER_URL || "https://simphony-home.msaf.oraclerestaurants.com";
const USERNAME = process.env.MICROS_INV_USERNAME || "mike";
const PASSWORD = process.env.MICROS_INV_PASSWORD || "";

if (!PASSWORD) {
  console.error("Missing MICROS_INV_PASSWORD env var");
  process.exit(1);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function buildEnvelope(method: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:pos="http://www.micros.com/pos/webservices/">
  <soapenv:Header>
    <pos:AuthenticationHeader>
      <pos:User>${escapeXml(USERNAME)}</pos:User>
      <pos:Password>${escapeXml(PASSWORD)}</pos:Password>
    </pos:AuthenticationHeader>
  </soapenv:Header>
  <soapenv:Body>
    <pos:${method}>
      ${body}
    </pos:${method}>
  </soapenv:Body>
</soapenv:Envelope>`;
}

async function probe(method: string, body: string, action: string) {
  const url = `${BASE_URL}/POSWebService/Service.svc`;
  const envelope = buildEnvelope(method, body);

  console.log(`\n── ${method} ──────────────────`);
  console.log(`POST ${url}`);
  console.log(`SOAPAction: ${action}`);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": action,
      },
      body: envelope,
      signal: AbortSignal.timeout(30000),
    });

    console.log(`Status: ${res.status} ${res.statusText}`);
    const text = await res.text();
    // Print first 2000 chars of response
    console.log(text.substring(0, 2000));
    if (text.length > 2000) console.log(`... (${text.length} total chars)`);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
  }
}

async function probeUrl(url: string, method: string, body: string, action: string) {
  const envelope = buildEnvelope(method, body);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": action,
      },
      body: envelope,
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    console.log(`  ${res.status} ${res.statusText} — ${text.substring(0, 200)}`);
    return res.status;
  } catch (err: any) {
    if (err.name === "TimeoutError" || err.cause?.code === "UND_ERR_CONNECT_TIMEOUT") {
      console.log(`  TIMEOUT (unreachable)`);
    } else {
      console.log(`  ERROR: ${err.message}`);
    }
    return 0;
  }
}

async function main() {
  const servers = [
    "https://scs-im.msaf.oraclerestaurants.com",
    "https://scs.msaf.oraclerestaurants.com", 
    "https://im-scs.msaf.oraclerestaurants.com",
    "https://simphony-home.msaf.oraclerestaurants.com:8443",
    "https://simphony-home.msaf.oraclerestaurants.com:443",
  ];

  const paths = [
    "/POSWebService/Service.svc",
    "/POSWebService/POSWebService.asmx",
    "/im/POSWebService/POSWebService.asmx",
    "/InventoryManagement/POSWebService.asmx",
  ];

  const action = "http://www.micros.com/pos/webservices/GetCostCenterList";

  for (const s of servers) {
    for (const p of paths) {
      const url = `${s}${p}`;
      console.log(`\nPOST ${url}`);
      await probeUrl(url, "GetCostCenterList", "", action);
    }
  }

  // Also try WSDL discovery
  console.log("\n── WSDL discovery ──");
  for (const s of servers) {
    for (const p of paths) {
      const url = `${s}${p}?wsdl`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        console.log(`GET ${url} → ${res.status}`);
        if (res.status === 200) {
          const text = await res.text();
          console.log(`  ${text.substring(0, 300)}`);
        }
      } catch (err: any) {
        console.log(`GET ${url} → TIMEOUT/ERROR`);
      }
    }
  }
}

main().catch(console.error);
