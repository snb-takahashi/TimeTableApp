// Next's standalone output doesn't automatically include `public/` or
// `.next/static` (per Next's self-hosting docs) — copy them in so the
// packaged server can serve static assets correctly.
import { cpSync, existsSync } from "node:fs";
import path from "node:path";

const standalone = path.resolve(".next/standalone");

cpSync("public", path.join(standalone, "public"), { recursive: true });
cpSync(".next/static", path.join(standalone, ".next/static"), { recursive: true });

const enginePath = path.join(standalone, "node_modules/.prisma/client");
if (!existsSync(enginePath)) {
  console.warn(
    `WARNING: Prisma client not found at ${enginePath} — check outputFileTracingIncludes in next.config.ts`
  );
} else {
  console.log("Prisma client present in standalone output:", enginePath);
}

console.log("Copied public/ and .next/static into .next/standalone");
