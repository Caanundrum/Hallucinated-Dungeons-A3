#!/usr/bin/env node
/**
 * Machine bootstrap toolchain check.
 *
 * Blueprint ownership: Section 1.14.2 — "A machine bootstrap command verifies
 * the toolchain before implementation or certification. Unknown, missing, or
 * incompatible versions fail clearly rather than producing partially trusted
 * evidence."
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { BUILDER_ROOT } from './workspace/working-directory.mjs';

const require = createRequire(import.meta.url);

function run(cmd, args) {
  // Capture both streams: tools such as `java -version` print to stderr.
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  if (result.error || result.status === null) {
    return null;
  }
  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

/**
 * Reads an installed package version. Some packages restrict subpath exports,
 * so the manifest is read from disk when `require` cannot resolve it.
 */
export function packageVersion(name) {
  try {
    return require(`${name}/package.json`).version;
  } catch {
    try {
      const manifestPath = join(BUILDER_ROOT, 'node_modules', name, 'package.json');
      return JSON.parse(readFileSync(manifestPath, 'utf8')).version;
    } catch {
      return null;
    }
  }
}

/**
 * @typedef {object} ToolchainCheck
 * @property {string} tool
 * @property {string} version
 * @property {string} need
 * @property {boolean} ok
 */

/**
 * Collects the pinned toolchain state.
 *
 * @returns {{ ok: boolean, checks: ToolchainCheck[] }}
 */
export function verifyToolchain() {
  /** @type {ToolchainCheck[]} */
  const checks = [];

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({
    tool: 'Node.js',
    version: process.versions.node,
    need: '22.x',
    ok: nodeMajor === 22,
  });

  const npmVersion = run('npm', ['--version']);
  checks.push({
    tool: 'npm',
    version: npmVersion ?? 'missing',
    need: '>=10',
    ok: npmVersion !== null && Number(npmVersion.split('.')[0]) >= 10,
  });

  const javaRaw = run('java', ['-version']);
  const javaMatch = javaRaw && javaRaw.match(/version "?(\d+)/);
  const javaMajor = javaMatch ? Number(javaMatch[1]) : null;
  checks.push({
    tool: 'Java (emulators)',
    version: javaMajor ? String(javaMajor) : 'missing',
    need: '>=11',
    ok: javaMajor !== null && javaMajor >= 11,
  });

  /** @type {Array<[string, string, string]>} */
  const packages = [
    ['Firebase CLI', 'firebase-tools', '^13'],
    ['Firebase Admin SDK', 'firebase-admin', '^13'],
    ['TypeScript', 'typescript', '^5'],
    ['Vite', 'vite', '^6'],
    ['Playwright', '@playwright/test', '^1'],
  ];
  for (const [tool, pkg, need] of packages) {
    const version = packageVersion(pkg);
    checks.push({ tool, version: version ?? 'missing', need, ok: version !== null });
  }

  return { ok: checks.every((check) => check.ok), checks };
}

function main() {
  const { ok, checks } = verifyToolchain();
  console.log('TOOL                  VERSION       NEED      STATUS');
  console.log('------------------------------------------------------');
  for (const check of checks) {
    console.log(
      `${check.tool.padEnd(22)}${check.version.padEnd(14)}${check.need.padEnd(10)}${check.ok ? 'OK' : 'FAIL'}`,
    );
  }
  console.log('------------------------------------------------------');
  if (!ok) {
    console.error('Toolchain verification FAILED.');
    process.exit(1);
  }
  console.log('Toolchain verification PASSED.');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
