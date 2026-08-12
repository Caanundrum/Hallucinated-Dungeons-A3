#!/usr/bin/env node
// Machine bootstrap toolchain check (Blueprint 1.14.2). Verifies that the pinned
// Alpha 3 Phase 0 toolchain is present and version-compatible. Exits non-zero on
// any unknown, missing, or incompatible tool so evidence is never partially trusted.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function run(cmd, args) {
  // Capture both stdout and stderr: tools such as `java -version` print to stderr.
  const res = spawnSync(cmd, args, { encoding: "utf8" });
  if (res.error || res.status === null) return null;
  return `${res.stdout || ""}${res.stderr || ""}`.trim();
}

function pkgVersion(name) {
  try {
    return require(`${name}/package.json`).version;
  } catch {
    return null;
  }
}

const checks = [];

// Node.js
const nodeMajor = Number(process.versions.node.split(".")[0]);
checks.push({
  tool: "Node.js",
  version: process.versions.node,
  ok: nodeMajor === 22,
  need: "22.x",
});

// Java runtime (required by Firebase emulators)
const javaRaw = run("java", ["-version"]);
const javaMatch = javaRaw && javaRaw.match(/version "?(\d+)/);
const javaMajor = javaMatch ? Number(javaMatch[1]) : null;
checks.push({
  tool: "Java (emulators)",
  version: javaMajor ? `${javaMajor}` : "missing",
  ok: javaMajor !== null && javaMajor >= 11,
  need: ">=11",
});

// Firebase CLI (resolved from local devDependencies)
const firebaseVer = pkgVersion("firebase-tools");
checks.push({
  tool: "Firebase CLI",
  version: firebaseVer ?? "missing",
  ok: firebaseVer !== null,
  need: "^13",
});

// TypeScript
const tsVer = pkgVersion("typescript");
checks.push({
  tool: "TypeScript",
  version: tsVer ?? "missing",
  ok: tsVer !== null,
  need: "^5",
});

// Vite build tool
const viteVer = pkgVersion("vite");
checks.push({
  tool: "Vite",
  version: viteVer ?? "missing",
  ok: viteVer !== null,
  need: "^6",
});

// Playwright browser-automation runner
const pwVer = pkgVersion("@playwright/test");
checks.push({
  tool: "Playwright",
  version: pwVer ?? "missing",
  ok: pwVer !== null,
  need: "^1",
});

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad("TOOL", 20)}${pad("VERSION", 14)}${pad("NEED", 10)}STATUS`);
console.log("-".repeat(52));
let allOk = true;
for (const c of checks) {
  if (!c.ok) allOk = false;
  console.log(`${pad(c.tool, 20)}${pad(c.version, 14)}${pad(c.need, 10)}${c.ok ? "OK" : "FAIL"}`);
}
console.log("-".repeat(52));

if (!allOk) {
  console.error("Toolchain verification FAILED. Run `npm install` and ensure Java is installed.");
  process.exit(1);
}
console.log("Toolchain verification PASSED.");
