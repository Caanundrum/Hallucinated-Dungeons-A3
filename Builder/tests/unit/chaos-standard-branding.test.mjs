/**
 * Verification for Chaos Standard branding integration, studio splash sequence,
 * and intuitive player home screen roadmap.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const BUILDER_ROOT = resolve(process.cwd());
const CLIENT_DIR = join(BUILDER_ROOT, 'src', 'client');
const PUBLIC_BRAND_DIR = join(CLIENT_DIR, 'public', 'brand');

describe('Chaos Standard Studio Branding & Navigation Architecture', () => {
  it('master brand assets are copied to public/brand and non-empty', () => {
    const requiredAssets = [
      'chaos-logo-master.png',
      'chaos-logo-transparent.png',
      'chaos-mark-symbol.png',
      'chaos-wordmark.png',
      'chaos-splash-card.png',
    ];

    for (const filename of requiredAssets) {
      const assetPath = join(PUBLIC_BRAND_DIR, filename);
      assert.ok(existsSync(assetPath), `Missing required brand asset: ${filename}`);
      const content = readFileSync(assetPath);
      assert.ok(content.length > 1000, `Brand asset ${filename} is unexpectedly empty`);
    }
  });

  it('styles.css contains authentic Chaos Standard master tokens and classes', () => {
    const stylesPath = join(CLIENT_DIR, 'styles.css');
    const styles = readFileSync(stylesPath, 'utf8');

    // Token verification
    assert.match(styles, /--cs-pitch-black:\s*#05070a/i);
    assert.match(styles, /--cs-surface-carbon:\s*#11131b/i);
    assert.match(styles, /--cs-hazard-orange:\s*#ff6a00/i);
    assert.match(styles, /--cs-violet:\s*#8b5cf6/i);
    assert.match(styles, /--cs-gold:\s*#f5a623/i);

    // Boot sequence & studio reveal classes
    assert.match(styles, /\.chaos-boot-root/);
    assert.match(styles, /\.chaos-boot-crt-scanlines/);
    assert.match(styles, /\.chaos-boot-terminal-img/);
    assert.match(styles, /\.chaos-word-chaos/);
    assert.match(styles, /\.chaos-word-standard/);
    assert.match(styles, /\.chaos-boot-telemetry/);

    // Welcome & Home screen roadmap classes
    assert.match(styles, /\.welcome-cs-badge/);
    assert.match(styles, /\.home-dashboard-page/);
    assert.match(styles, /\.home-step-cards/);
    assert.match(styles, /\.home-active-banner/);
    assert.match(styles, /\.home-studio-card/);
  });

  it('chaos-boot-sequence exports lifecycle methods and embeds the Bewildered Terminal mascot', () => {
    const bootSeqPath = join(CLIENT_DIR, 'chaos-boot-sequence.ts');
    const source = readFileSync(bootSeqPath, 'utf8');

    assert.match(source, /export async function playChaosBootSequence/);
    assert.match(source, /export function hasSeenChaosBoot/);
    assert.match(source, /export function markChaosBootSeen/);
    assert.match(source, /export function resetChaosBootSeen/);
    assert.match(source, /\/brand\/chaos-mark-symbol\.png/);
    assert.match(source, /We take making ridiculous things extremely seriously\./);
    assert.match(source, /data-testid="chaos-boot-skip"/);
    assert.match(source, /data-testid="chaos-boot-chaos"/);
    assert.match(source, /data-testid="chaos-boot-game"/);
  });

  it('home.ts delivers the intuitive 3-step roadmap directing where the player goes next', () => {
    const homePath = join(CLIENT_DIR, 'pages', 'home.ts');
    const source = readFileSync(homePath, 'utf8');

    // Heading and identity
    assert.match(source, /data-testid="home-heading"/);
    assert.match(source, /Hallucinated Dungeons/);

    // 3-Step Guided Roadmap
    assert.match(source, /data-testid="home-step-characters"/);
    assert.match(source, /data-testid="home-step-tables"/);
    assert.match(source, /data-testid="home-step-play"/);

    // Direct CTAs
    assert.match(source, /data-testid="home-create-character-btn"/);
    assert.match(source, /data-testid="home-create-table-btn"/);
    assert.match(source, /data-testid="home-resume-table-btn"/);
    assert.match(source, /data-testid="home-replay-intro-btn"/);

    // Backward-compatible test hooks
    assert.match(source, /data-testid="home-characters-link"/);
    assert.match(source, /data-testid="home-campaigns-link"/);
    assert.match(source, /data-testid="home-account-link"/);
    assert.match(source, /data-testid="browser-support-matrix"/);

    // Studio attribution
    assert.match(source, /Chaos Standard/);
    assert.match(source, /chaosstandard\.com/);
  });

  it('welcome.ts redirects authenticated players to Home ("/") and carries Chaos Standard badge', () => {
    const welcomePath = join(CLIENT_DIR, 'pages', 'welcome.ts');
    const source = readFileSync(welcomePath, 'utf8');

    // Post-auth redirection directly to Home
    assert.match(source, /navigate\('\/',\s*\{\s*replace:\s*true\s*\}\)/);

    // Chaos Standard branding
    assert.match(source, /data-testid="welcome-cs-badge"/);
    assert.match(source, /\/brand\/chaos-mark-symbol\.png/);
    assert.match(source, /A CHAOS STANDARD GAME/);
    assert.match(source, /data-testid="welcome-heading"/);
    assert.match(source, /data-testid="welcome-google-hosted-button"/);
    assert.match(source, /data-testid="welcome-legal-links"/);
  });

  it('shell.ts features Chaos Standard brand mark in header and studio attribution in footer', () => {
    const shellPath = join(CLIENT_DIR, 'shell.ts');
    const source = readFileSync(shellPath, 'utf8');

    // Header brand mark
    assert.match(source, /shell-cs-brand/);
    assert.match(source, /CHAOS STANDARD/);
    assert.match(source, /shell-game-title/);

    // Footer studio attribution
    assert.match(source, /shell-footer-studio/);
    assert.match(source, /A Chaos Standard Game/);
    assert.match(source, /https:\/\/chaosstandard\.com/);
  });
});
