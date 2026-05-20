/**
 * scripts/run_migration.js
 *
 * Runs a SQL migration file against the Supabase database.
 * Uses the Supabase Management API (pg-meta) SQL endpoint which accepts
 * raw SQL directly — no exec_sql RPC function required.
 *
 * Usage: node scripts/run_migration.js <path-to-sql-file>
 */

const https = require("https");
const fs = require("fs");

const PROJECT_REF = "bdzcydhrdjprdzywjbeu";
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
console.log(`Running: ${sqlFile}`);
console.log(`Found ${statements.length} SQL statement(s) to execute.\n`);

/**
 * Execute SQL via PostgREST rpc/exec_sql (primary)
 * or fall back to running the full file as a single query.
 */
function postRPC(sql) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query: sql });
    const options = {
      hostname: `${PROJECT_REF}.supabase.co`,
      path: "/rest/v1/rpc/exec_sql",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": key,
        "Authorization": `Bearer ${key}`,
      },
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

/**
 * Execute raw SQL via the Supabase pg-meta /query endpoint.
 * This endpoint accepts arbitrary SQL and works with the service_role key.
 */
function postSQL(sql) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query: sql });
    const options = {
      hostname: `${PROJECT_REF}.supabase.co`,
      path: "/pg/query",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": key,
        "Authorization": `Bearer ${key}`,
      },
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

async function main() {
  // Try exec_sql RPC first
  const testRes = await postRPC("SELECT 1");
  const useRPC = testRes.status === 200 || testRes.status === 204;

  if (useRPC) {
    console.log("Using exec_sql RPC endpoint.\n");
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      const preview = stmt.substring(0, 80).replace(/\n/g, " ");
      console.log(`[${i + 1}/${statements.length}] ${preview}...`);
      const res = await postRPC(stmt);
      if (res.status !== 200 && res.status !== 204) {
        console.log(`  ERROR (${res.status}): ${res.body.substring(0, 300)}`);
      } else {
        console.log("  OK");
      }
    }
    console.log("\nDone!");
    return;
  }

  // Fallback: try pg-meta /pg/query — send the entire SQL file as one batch
  console.log("exec_sql RPC not available. Trying pg-meta /pg/query endpoint...\n");
  const pgRes = await postSQL(fullSQL);

  if (pgRes.status >= 200 && pgRes.status < 300) {
    console.log("Migration applied successfully via pg-meta.");
    // Show result summary if any
    try {
      const parsed = JSON.parse(pgRes.body);
      if (Array.isArray(parsed)) {
        console.log(`  ${parsed.length} result set(s) returned.`);
      }
    } catch { /* non-JSON is fine */ }
    console.log("\nDone!");
    return;
  }

  // Second fallback: try statement-by-statement via pg-meta
  console.log(`Batch failed (${pgRes.status}). Trying statement-by-statement...\n`);
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.substring(0, 80).replace(/\n/g, " ");
    console.log(`[${i + 1}/${statements.length}] ${preview}...`);
    const res = await postSQL(stmt);
    if (res.status >= 200 && res.status < 300) {
      console.log("  OK");
      ok++;
    } else {
      console.log(`  ERROR (${res.status}): ${res.body.substring(0, 300)}`);
      fail++;
    }
  }

  console.log(`\nDone! ${ok} succeeded, ${fail} failed.`);
  if (fail > 0) {
    console.log("\nIf all methods failed, run the SQL manually in the Supabase Dashboard SQL Editor:");
    console.log("  https://supabase.com/dashboard/project/" + PROJECT_REF + "/sql/new");
  }
}

main().catch(console.error);
