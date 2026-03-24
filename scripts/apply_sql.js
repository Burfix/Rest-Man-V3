/**
 * scripts/apply_sql.js — One-shot migration runner
 * Tries multiple Supabase endpoints to execute raw SQL.
 */
const https = require("https");
const fs = require("fs");

const PROJECT_REF = "bdzcydhrdjprdzywjbeu";
const sqlFile = process.argv[2];
if (!sqlFile) { console.error("Usage: node scripts/apply_sql.js <file.sql>"); process.exit(1); }

const sql = fs.readFileSync(sqlFile, "utf8");
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkemN5ZGhyZGpwcmR6eXdqYmV1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzMwMjUzNSwiZXhwIjoyMDg4ODc4NTM1fQ.mTnTAP3SpuzDN7KEI0sBusYS36WmZzjcOXvQInWMlh8";

function tryEndpoint(hostname, path, body, contentType) {
  return new Promise((resolve) => {
    const postBody = typeof body === "object" ? JSON.stringify(body) : body;
    const opts = {
      hostname, path, method: "POST",
      headers: {
        "Content-Type": contentType || "application/json",
        "apikey": key,
        "Authorization": "Bearer " + key,
      },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (d) => { data += d; });
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", (e) => resolve({ status: 0, body: e.message }));
    req.write(postBody);
    req.end();
  });
}

async function main() {
  const host = `${PROJECT_REF}.supabase.co`;
  console.log("Applying:", sqlFile);

  // 1. Try exec_sql RPC
  let res = await tryEndpoint(host, "/rest/v1/rpc/exec_sql", { query: sql });
  if (res.status >= 200 && res.status < 300) {
    console.log("Applied via exec_sql RPC.");
    return;
  }
  console.log("exec_sql RPC:", res.status, res.body.substring(0, 100));

  // 2. Try pg-meta query endpoint
  res = await tryEndpoint(host, "/pg/query", { query: sql });
  if (res.status >= 200 && res.status < 300) {
    console.log("Applied via pg-meta /pg/query.");
    return;
  }
  console.log("/pg/query:", res.status, res.body.substring(0, 100));

  // 3. Try creating exec_sql first, then using it
  console.log("\nBootstrapping exec_sql function...");
  const createFnSQL = `CREATE OR REPLACE FUNCTION exec_sql(query text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN EXECUTE query; END; $$;`;
  
  // Try creating via pg-meta
  res = await tryEndpoint(host, "/pg/query", { query: createFnSQL });
  if (res.status >= 200 && res.status < 300) {
    console.log("Created exec_sql. Now executing migration...");
    res = await tryEndpoint(host, "/rest/v1/rpc/exec_sql", { query: sql });
    if (res.status >= 200 && res.status < 300) {
      console.log("Applied via exec_sql RPC (bootstrapped).");
      return;
    }
  }

  // 4. All failed — print manual instructions
  console.log("\n=== MANUAL ACTION REQUIRED ===");
  console.log("Run this SQL in Supabase Dashboard SQL Editor:");
  console.log(`https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new\n`);
  console.log(sql);
}

main().catch(console.error);
