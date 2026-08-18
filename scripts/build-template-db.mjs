// Builds resources/template.db: a fresh SQLite file with the Prisma schema
// migrated and exactly one Organization row (every page in the app calls
// getDefaultOrganization(), which throws if none exists — see
// src/lib/org.ts). No other data is seeded; the user fills in their own
// classes/teachers/etc. via the admin screens or CSV import. This file gets
// packaged with the app and copied into the user's data directory on first
// launch, instead of trying to run Prisma's migration engine at runtime
// inside a packaged app.
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const tmpDb = path.resolve("prisma/template-build.db");
const outDb = path.resolve("resources/template.db");
const tmpDbUrl = `file:${tmpDb.replace(/\\/g, "/")}`;

for (const f of [tmpDb, `${tmpDb}-journal`]) {
  if (existsSync(f)) rmSync(f);
}

execSync("npx prisma migrate deploy", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: tmpDbUrl },
});

const prisma = new PrismaClient({ datasourceUrl: tmpDbUrl });
await prisma.organization.create({
  data: { name: "自分の学校", slug: "default" },
});
await prisma.$disconnect();

mkdirSync(path.dirname(outDb), { recursive: true });
copyFileSync(tmpDb, outDb);
rmSync(tmpDb);
if (existsSync(`${tmpDb}-journal`)) rmSync(`${tmpDb}-journal`);

console.log(`Wrote ${outDb}`);
