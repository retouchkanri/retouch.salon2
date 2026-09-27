#!/usr/bin/env node
/**
 * Launch `next dev` on port 3000 when free, otherwise fall back to
 * the next available port (3001, 3002, ...). This avoids the
 * EADDRINUSE crash when another dev server is already running.
 */
const net = require("node:net");
const { spawn } = require("node:child_process");

const BASE_PORT = Number(process.env.PORT) || 3000;
const MAX_TRIES = 10;

// Probe a single host. Resolves true iff a listener can bind there.
function isPortFreeOn(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

// Next.js binds dual-stack on `::` by default; on Windows an IPv6 listener
// on :::3000 doesn't conflict with an IPv4 0.0.0.0 probe, so we must probe
// both families to detect a stale dev server.
async function isPortFree(port) {
  const v6 = await isPortFreeOn(port, "::");
  if (!v6) return false;
  const v4 = await isPortFreeOn(port, "0.0.0.0");
  return v4;
}

async function pickPort() {
  for (let i = 0; i < MAX_TRIES; i++) {
    const port = BASE_PORT + i;
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(port)) return port;
    console.log(`[dev] port ${port} is busy, trying ${port + 1}...`);
  }
  throw new Error(
    `No free port found in range ${BASE_PORT}-${BASE_PORT + MAX_TRIES - 1}`,
  );
}

(async () => {
  const port = await pickPort();
  console.log(`\n\u25B2 Starting Next.js on http://localhost:${port}\n`);

  const nextMain = require.resolve("next/dist/bin/next");

  const child = spawn(process.execPath, [nextMain, "dev", "-p", String(port)], {
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      PORT: String(port),
      // Extra V8 heap headroom for the dev compiler on memory-constrained
      // hosts — prevents "JavaScript heap out of memory" during webpack
      // cache (de)compression. Preserves any NODE_OPTIONS already set.
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--max-old-space-size=4096"]
        .filter(Boolean)
        .join(" "),
    },
  });

  const forward = (sig) => () => child.kill(sig);
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));
  child.on("exit", (code) => process.exit(code ?? 0));
})().catch((err) => {
  console.error("[dev] failed to start:", err);
  process.exit(1);
});
