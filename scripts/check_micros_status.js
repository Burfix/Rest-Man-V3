const https = require("https");
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkemN5ZGhyZGpwcmR6eXdqYmV1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzMwMjUzNSwiZXhwIjoyMDg4ODc4NTM1fQ.mTnTAP3SpuzDN7KEI0sBusYS36WmZzjcOXvQInWMlh8";
const host = "bdzcydhrdjprdzywjbeu.supabase.co";

function get(path) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: host, path, method: "GET",
      headers: { "apikey": key, "Authorization": "Bearer " + key }
    }, (res) => {
      let body = "";
      res.on("data", (d) => { body += d; });
      res.on("end", () => resolve(JSON.parse(body)));
    });
    req.end();
  });
}

async function main() {
  const conns = await get("/rest/v1/micros_connections?select=id,status,last_sync_at,last_sync_error,last_successful_sync_at&limit=1");
  console.log("=== MICROS Connections ===");
  console.log(JSON.stringify(conns, null, 2));

  const runs = await get("/rest/v1/micros_sync_runs?select=sync_type,status,started_at,error_message,records_fetched&order=started_at.desc&limit=5");
  console.log("\n=== Recent Sync Runs ===");
  console.log(JSON.stringify(runs, null, 2));
}

main().catch(console.error);
