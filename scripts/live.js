#!/usr/bin/env node
/**
 * 公開用（ポート3000）。出力先は .next-prod に固定する。
 * 修正用の next dev（.next-dev）とは別なので、保存しても公開側は変わらない。
 */
const { spawn } = require("node:child_process");

const mode = process.argv[2];
if (mode !== "build" && mode !== "start") {
  console.error("usage: node scripts/live.js <build|start>");
  process.exit(1);
}

const nextMain = require.resolve("next/dist/bin/next");
const args = mode === "build" ? ["build"] : ["start", "-H", "0.0.0.0", "-p", "3000"];

const child = spawn(process.execPath, [nextMain, ...args], {
  stdio: "inherit",
  shell: false,
  env: {
    ...process.env,
    NEXT_DIST_DIR: ".next-prod",
    NODE_OPTIONS: [process.env.NODE_OPTIONS, "--max-old-space-size=4096"].filter(Boolean).join(" "),
  },
});

child.on("exit", (code) => process.exit(code ?? 0));
