import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Electron shell loads the dev server via 127.0.0.1 (not localhost),
  // so HMR needs that origin allow-listed in dev.
  allowedDevOrigins: ["127.0.0.1"],
  // Produces .next/standalone/server.js — a self-contained server Electron
  // spawns as a child process, instead of needing `next start` + full
  // node_modules bundled into the packaged app.
  output: "standalone",
  // Prisma's native query engine binary is loaded dynamically at runtime
  // (not via a static require), so Next's output-file-tracing misses it
  // unless told explicitly to include it.
  outputFileTracingIncludes: {
    "/*": ["./node_modules/.prisma/client/**/*"],
  },
};

export default nextConfig;
