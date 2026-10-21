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

  it('styles.css contains authentic Chaos Standard master tokens and reveal classes', () => {
    const stylesPath = join(CLIENT_DIR, 'styles.css');
    const styles = readFileSync(stylesPath, 'utf8');

    // Token verification
    assert.match(styles, /--cs-pitch-black:\s*#05070a/i);
    assert.match(styles, /--cs-surface-carbon:\s*#11131b/i);
    assert.match(styles, /--cs-hazard-orange:\s*#ff6a00/i);
    assert.match(styles, /--cs-violet:\s*#8b5cf6/i);
    assert.match(styles, /--cs-gold:\s*#f5a623/i);

    // Single Studio Splash Reveal sequence classes
    assert.match(styles, /\.chaos-boot-root/);
    assert.match(styles, /\.chaos-boot-topbar/);
    assert.match(styles, /\.chaos-boot-bottombar/);
    assert.match(styles, /\.chaos-boot-backlight/);
    assert.match(styles, /\.chaos-boot-monitor-graphic/);
    assert.match(styles, /\.chaos-boot-electron-beam/);
    assert.match(styles, /\.chaos-boot-wordmark-unit/);
    assert.match(styles, /\.welcome-entrance-active/);

    // Welcome & Home screen roadmap classes
    assert.match(styles, /\.welcome-cs-badge/);
    assert.match(styles, /\.home-dashboard-page/);
    assert.match(styles, /\.home-step-cards/);
    assert.match(styles, /\.home-active-banner/);
    assert.match(styles, /\.home-studio-card/);
  });

  it('chaos-boot-sequence exports lifecycle methods, replicates StudioSplashReveal exactly, and has NO duplicate splash screen', () => {
    const bootSeqPath = join(CLIENT_DIR, 'chaos-boot-sequence.ts');
    const source = readFileSync(bootSeqPath, 'utf8');

    // Lifecycle methods
    assert.match(source, /export async function playChaosBootSequence/);
    assert.match(source, /export function hasSeenChaosBoot/);
    assert.match(source, /export function markChaosBootSeen/);
    assert.match(source, /export function resetChaosBootSeen/);

    // Studio assets and layout matching StudioSplashReveal.tsx
    assert.match(source, /\/brand\/chaos-mark-symbol\.png/);
    assert.match(source, /\/brand\/chaos-wordmark\.png/);
    assert.match(source, /data-testid="chaos-boot-skip"/);
    assert.match(source, /data-testid="chaos-boot-chaos"/);
    assert.match(source, /data-testid="chaos-boot-telemetry"/);
    assert.match(source, /CHAOS_STANDARD \/\/ REVEAL_SEQUENCE/);
    assert.match(source, /BROWSER-NATIVE EXPERIENCES/);

    // Must NOT have a second splash screen
    assert.ok(
      !source.includes('data-testid="chaos-boot-game"'),
      'Duplicate splash screen (data-testid="chaos-boot-game") must be eliminated',
    );
  });

  it('home.ts delivers the intuitive 3-step roadmap and guards certified browsers on hosted player surface', () => {
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

    // Replay intro button was removed per feedback
    assert.ok(!source.includes('home-replay-intro-btn'), 'home-replay-intro-btn must be removed');

    // High-level 2-minute tour modal and trigger
    assert.match(source, /data-testid="home-open-tour-btn"/);
    assert.match(source, /data-testid="home-tour-backdrop"/);
    assert.match(source, /data-testid="home-tour-close-btn"/);
    assert.match(source, /data-testid="home-tour-dismiss-btn"/);
    assert.match(source, /data-testid="home-tour-start-btn"/);

    // Studio attribution
    assert.match(source, /Chaos Standard/);
    assert.match(source, /chaosstandard\.com/);

    // No confusing table welcome before joining a table
    assert.ok(!source.includes('Welcome to the table'), 'Must not greet with "Welcome to the table" on home');
    assert.ok(!source.includes('tabletop roleplaying universe'), 'Must not contain purple universe copy');

    // Certified Browsers section is guarded from hosted player surface
    assert.match(source, /isHostedPlayerSurface\(candidate\)/);
  });

  it('welcome.ts redirects authenticated players to Home ("/") and carries Chaos Standard badge and animated entrance', () => {
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
    assert.match(source, /welcome-entrance-active/);
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
