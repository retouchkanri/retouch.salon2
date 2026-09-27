#!/usr/bin/env node
/**
 * Production build with raised Node heap for type-check / lint workers.
 * Next.js spawns child processes during "Linting and checking validity of types";
 * NODE_OPTIONS must be set on the environment so those workers inherit it.
 */
const { spawnSync } = require("node:child_process");

const extra = "--max-old-space-size=8192";
process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, extra].filter(Boolean).join(" ");

const nextMain = require.resolve("next/dist/bin/next");
const result = spawnSync(process.execPath, [nextMain, "build"], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
