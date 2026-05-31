import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const sourceDirs = ["app", "components", "lib"];
const sourceExtensions = new Set([".ts", ".tsx"]);
const forbiddenClientPatterns = [
  /@\/lib\/supabase\/service-role-client/,
  /from\s+["']\.\.?\/.*service-role-client["']/,
  /getServiceRoleClient\s*\(/,
  /createServiceRoleClient\s*\(/,
  /process\.env\.SUPABASE_SERVICE_ROLE_KEY/,
];

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist") {
      continue;
    }

    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(absolute));
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(absolute);
    }
  }

  return files;
}

function isClientComponent(source: string): boolean {
  const firstStatement = source.trimStart().split(/\r?\n/, 1)[0]?.trim();
  return firstStatement === "\"use client\";" || firstStatement === "'use client';";
}

describe("service-role boundary", () => {
  it("does not import or construct service-role clients in client components", () => {
    const violations = sourceDirs
      .flatMap((dir) => walk(path.join(root, dir)))
      .flatMap((file) => {
        const source = fs.readFileSync(file, "utf8");
        if (!isClientComponent(source)) return [];

        return forbiddenClientPatterns
          .filter((pattern) => pattern.test(source))
          .map((pattern) => `${path.relative(root, file)} matched ${pattern}`);
      });

    expect(violations).toEqual([]);
  });

  it("keeps service-role environment access inside the canonical factory", () => {
    const allowed = new Set(["lib/supabase/service-role-client.ts"]);
    const violations = sourceDirs
      .flatMap((dir) => walk(path.join(root, dir)))
      .flatMap((file) => {
        const relative = path.relative(root, file);
        if (allowed.has(relative)) return [];

        const source = fs.readFileSync(file, "utf8");
        return /process\.env\.SUPABASE_SERVICE_ROLE_KEY/.test(source)
          ? [relative]
          : [];
      });

    expect(violations).toEqual([]);
  });
});
