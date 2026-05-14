/**
 * scripts/apply_migrations_via_api.js
 * Applies specific migration files to the remote Supabase project
 * using the Supabase Management API (personal access token auth).
 */
const https = require("https");
const fs = require("fs");

const PROJECT_REF = "bdzcydhrdjprdzywjbeu";
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error("Set SUPABASE_ACCESS_TOKEN env var first.");
  process.exit(1);
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: node scripts/apply_migrations_via_api.js <file1.sql> [file2.sql] ...");
  process.exit(1);
}

function runQuery(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });
    const opts = {
      hostname: "api.supabase.com",
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (d) => { data += d; });
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  for (const file of files) {
    console.log(`\nApplying: ${file}`);
    const sql = fs.readFileSync(file, "utf8");
    const result = await runQuery(sql);
    if (result.status >= 200 && result.status < 300) {
      console.log(`✅  ${file} — applied (HTTP ${result.status})`);
    } else {
      console.error(`❌  ${file} — HTTP ${result.status}`);
      console.error(result.body.substring(0, 500));
    }
  }
}

main().catch(console.error);
