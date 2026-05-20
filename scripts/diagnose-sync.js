/**
 * scripts/diagnose-sync.js — Live sync state diagnostic
 */
const https = require("https");

const PROJECT_REF = "bdzcydhrdjprdzywjbeu";
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkemN5ZGhyZGpwcmR6eXdqYmV1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzMwMjUzNSwiZXhwIjoyMDg4ODc4NTM1fQ.mTnTAP3SpuzDN7KEI0sBusYS36WmZzjcOXvQInWMlh8";

function restQuery(table, params) {
  return new Promise((resolve) => {
    const qs = params ? "?" + params : "?limit=10&order=created_at.desc";
    const opts = {
      hostname: PROJECT_REF + ".supabase.co",
      path: "/rest/v1/" + table + qs,
      method: "GET",
      headers: {
        "apikey": KEY,
        "Authorization": "Bearer " + KEY,
        "Accept": "application/json",
        "Prefer": "return=representation",
      },
    };
    const req = https.request(opts, (res) => {
      let d = "";
      res.on("data", (c) => { d += c; });
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    req.on("error", (e) => resolve({ status: 0, body: e.message }));
    req.end();
  });
}

async function run(label, table, params) {
  console.log("\n" + "=".repeat(60));
  console.log(label);
  console.log("=".repeat(60));
  const r = await restQuery(table, params);
  if (r.status >= 200 && r.status < 300) {
    try {
      const rows = JSON.parse(r.body);
      if (!rows || rows.length === 0) {
        console.log("  (no rows)");
      } else {
        rows.forEach((row) => {
          const vals = Object.entries(row).map(([k, v]) =>
            k + ":" + (v === null ? "NULL" : String(v).slice(0, 80))
          );
          console.log("  " + vals.join(" | "));
        });
      }
    } catch {
      console.log(r.body.slice(0, 1000));
    }
  } else {
    console.log("  ERROR", r.status, r.body.slice(0, 400));
  }
}

async function main() {
  await run("SITES", "sites", "select=id,name,is_active&order=created_at.desc");
  await run("MICROS CONNECTIONS", "micros_connections", "select=id,loc_ref,status,last_sync_at,last_sync_error&order=created_at.desc");
  await run("MICROS_SALES_DAILY last 7", "micros_sales_daily", "select=business_date,net_sales,gross_sales,check_count,synced_at&order=business_date.desc&limit=7");
  await run("SYNC_RUNS V2 last 10", "sync_runs", "select=sync_type,status,trigger,started_at,duration_ms,records_fetched,records_written,error_message&order=created_at.desc&limit=10");
  await run("MICROS_SYNC_RUNS V1 last 5 FULL ERROR", "micros_sync_runs", "select=sync_type,status,started_at,records_fetched,error_message&order=started_at.desc&limit=5");
  await run("LABOUR_SYNC_STATE", "labour_sync_state", "select=loc_ref,last_cur_utc,last_bus_dt,last_sync_at,error_message");
  await run("LABOUR_TIMECARDS last 3 days", "labour_timecards", "select=business_date,loc_ref,total_pay,clk_in_lcl&order=business_date.desc,clk_in_lcl.desc&limit=10");
  await run("SYNC LOCKS active", "sync_locks", "select=lock_key,owner_id,acquired_at,expires_at");
  await run("SOURCE FINGERPRINTS last 5", "source_ingestion_fingerprints", "select=site_id,sync_type,record_key,content_hash,last_seen_at&order=last_seen_at.desc&limit=5");
}

main().catch(console.error);
