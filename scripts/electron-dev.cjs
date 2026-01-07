#!/usr/bin/env node

const { spawn } = require("node:child_process");

/**
 * On Windows, `cross-env ELECTRON_RUN_AS_NODE=` still sets the variable (empty string),
 * which makes Electron run in Node mode. In that mode, `require('electron')` returns
 * the path to the Electron executable instead of the Electron API object, so `app` is undefined.
 *
 * This script spawns Electron with ELECTRON_RUN_AS_NODE removed from the child environment.
 */

function buildChildEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "electron_run_as_node") {
      delete env[key];
    }
  }
  return env;
}

const electronBinary = require("electron");
const args = process.argv.slice(2);

// When running Electron directly, the app "main" entry must exist.
// `pnpm dev` runs the watchers that generate `dist/main/main.cjs` before launching Electron.
try {
  const fs = require("node:fs");
  const path = require("node:path");
  const projectRoot = path.join(__dirname, "..");
  const mainEntry = path.join(projectRoot, "dist", "main", "main.cjs");
  if (!fs.existsSync(mainEntry)) {
    // eslint-disable-next-line no-console
    console.error(`[electron:dev] Missing ${mainEntry}`);
    // eslint-disable-next-line no-console
    console.error(`[electron:dev] Run "pnpm dev" (recommended) or "pnpm run main:watch" first.`);
    process.exit(1);
  }
} catch {
  // ignore
}

const child = spawn(electronBinary, args.length ? args : ["."], {
  stdio: "inherit",
  env: buildChildEnv()
});

const forwardSignal = (signal) => {
  try {
    child.kill(signal);
  } catch {
    // ignore
  }
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code, signal) => {
  if (typeof code === "number") process.exit(code);
  if (signal) process.kill(process.pid, signal);
  process.exit(1);
});
