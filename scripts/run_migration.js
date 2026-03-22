const https = require("https");
const fs = require("fs");

const sqlFile = process.argv[2] || "supabase/migrations/028_compliance_renewal_scheduling.sql";
const fullSQL = fs.readFileSync(sqlFile, "utf8");
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkemN5ZGhyZGpwcmR6eXdqYmV1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzMwMjUzNSwiZXhwIjoyMDg4ODc4NTM1fQ.mTnTAP3SpuzDN7KEI0sBusYS36WmZzjcOXvQInWMlh8";

// Split SQL into individual statements (respecting $$ blocks)
function splitStatements(sql) {
  const stmts = [];
  let current = "";
  let inDollar = false;
  const lines = sql.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("--") && !inDollar) {
      continue; // skip comment-only lines
    }
    if (trimmed.includes("$$")) {
      const count = (trimmed.match(/\$\$/g) || []).length;
      if (count % 2 === 1) inDollar = !inDollar;
    }
    current += line + "\n";
    if (!inDollar && trimmed.endsWith(";")) {
      const stmt = current.trim();
      if (stmt.length > 2) stmts.push(stmt);
      current = "";
    }
  }
  if (current.trim().length > 2) stmts.push(current.trim());
  return stmts;
}

const statements = splitStatements(fullSQL);
console.log(`Found ${statements.length} SQL statements to execute.\n`);

function post(sql) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query: sql });
    const options = {
      hostname: "bdzcydhrdjprdzywjbeu.supabase.co",
      path: "/rest/v1/rpc/exec_sql",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": key,
        "Authorization": "Bearer " + key,
      }
    };
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (d) => { body += d; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

// First, create exec_sql function if it doesn't exist
async function ensureExecSQL() {
  const createFn = `
    create or replace function exec_sql(query text)
    returns void language plpgsql security definer as $$
    begin
      execute query;
    end;
    $$;
  `;
  // We need to run this via the raw pg endpoint, but since that doesn't exist,
  // let's try running it as a direct RPC with different approach.
  // Actually, let's try creating via the special endpoint.
  return post(createFn);
}

async function main() {
  // First check if exec_sql exists, if not we'll need manual intervention
  const testRes = await post("SELECT 1");
  if (testRes.status === 404) {
    console.log("exec_sql function does not exist. Creating it...");
    // We can't bootstrap exec_sql without exec_sql.
    // Let's try the individual ALTER statements directly as RPC calls.
    // Actually let's try inserting each statement via a different approach.
    console.log("\\nPlease run this SQL in the Supabase Dashboard SQL Editor:");
    console.log("=".repeat(60));
    console.log(fullSQL);
    console.log("=".repeat(60));
    console.log("\\nThen re-run this script to verify.");
    return;
  }

  console.log("exec_sql available. Running statements...");
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    console.log(`[${i + 1}/${statements.length}] ${stmt.substring(0, 60).replace(/\n/g, " ")}...`);
    const res = await post(stmt);
    if (res.status !== 200 && res.status !== 204) {
      console.log(`  ERROR (${res.status}): ${res.body.substring(0, 300)}`);
    } else {
      console.log("  OK");
    }
  }
  console.log("\\nDone!");
}

main().catch(console.error);
