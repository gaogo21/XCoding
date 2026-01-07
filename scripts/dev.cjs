#!/usr/bin/env node

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");

function pnpmCmd() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function binPath(name) {
  const bin = process.platform === "win32" ? `${name}.cmd` : name;
  return path.join(projectRoot, "node_modules", ".bin", bin);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findFreePort(startPort, maxTries = 50) {
  for (let i = 0; i < maxTries; i++) {
    const port = startPort + i;
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port found in range ${startPort}-${startPort + maxTries - 1}`);
}

async function waitForFile(filePath, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) return;
    // eslint-disable-next-line no-await-in-loop
    await sleep(150);
  }
  throw new Error(`Timed out waiting for file: ${filePath}`);
}

async function waitForHttpOk(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await new Promise((resolve) => {
      const req = http.get(url, { timeout: 1500 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("timeout", () => {
        try {
          req.destroy(new Error("timeout"));
        } catch {
          // ignore
        }
      });
      req.on("error", () => resolve(false));
    });
    if (ok) return;
    // eslint-disable-next-line no-await-in-loop
    await sleep(150);
  }
  throw new Error(`Timed out waiting for dev server: ${url}`);
}

function spawnChild(command, args, { env } = {}) {
  return spawn(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    env: env ?? process.env
  });
}

function killTree(children, signal) {
  for (const child of children) {
    if (!child || child.killed) continue;
    try {
      child.kill(signal);
    } catch {
      // ignore
    }
  }
}

async function main() {
  const requestedPortRaw = process.env.VITE_PORT ?? "5173";
  const requestedPort = Number.parseInt(requestedPortRaw, 10);
  const basePort = Number.isFinite(requestedPort) && requestedPort > 0 ? requestedPort : 5173;

  const port = await findFreePort(basePort, 50);
  if (port !== basePort) {
    console.log(`[dev] Port ${basePort} is in use; using ${port} instead.`);
  }

  const devServerUrl = `http://127.0.0.1:${port}`;
  const env = { ...process.env, VITE_PORT: String(port), VITE_DEV_SERVER_URL: devServerUrl };

  const children = [];
  const mainEntry = path.join(projectRoot, "dist", "main", "main.cjs");

  const vite = spawnChild(binPath("vite"), ["--host", "127.0.0.1", "--port", String(port), "--strictPort"], { env });
  const mainWatch = spawnChild(pnpmCmd(), ["run", "main:watch"], { env });
  children.push(vite, mainWatch);

  const earlyExit = new Promise((_, reject) => {
    const onExit = (name) => (code, signal) => {
      const detail = typeof code === "number" ? `code ${code}` : `signal ${signal ?? "unknown"}`;
      reject(new Error(`[dev] ${name} exited early (${detail}).`));
    };
    vite.once("exit", onExit("vite"));
    mainWatch.once("exit", onExit("main:watch"));
  });

  await Promise.race([
    (async () => {
      await waitForFile(mainEntry, 60_000);
      await waitForHttpOk(devServerUrl, 60_000);
    })(),
    earlyExit
  ]);

  const electron = spawnChild(pnpmCmd(), ["run", "electron:dev"], { env });
  children.push(electron);

  const forwardSignal = (signal) => killTree(children, signal);
  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  electron.on("exit", (code, signal) => {
    killTree(children, "SIGTERM");
    if (typeof code === "number") process.exit(code);
    if (signal) process.kill(process.pid, signal);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

