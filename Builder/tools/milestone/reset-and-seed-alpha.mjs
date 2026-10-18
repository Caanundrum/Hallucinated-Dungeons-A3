#!/usr/bin/env node
/**
 * Alpha reset-and-seed: wipes table data and seeds one clean 12x8 blueprint table.
 *
 * Seeds (idempotent, deterministic ids):
 *   - Character "Duran Stoneguard", Level 1 Dwarf Fighter, portrait
 *     /assets/portraits/dwarf_fighter.jpg
 *   - Campaign "Shadows over Emberferry" with a Campaign Blueprint built by
 *     buildCampaignBlueprint (dist), Veyra as Game Director, premise centred on
 *     Bram Ironkettle at the bar and the cellar stairs.
 *
 * Wipes (whole collections): campaigns, campaignMemberships, campaignSeats,
 * campaignTableProjections, plus the campaign-scoped collections that would be
 * orphaned without them. Characters and drafts are removed only when their
 * identity name matches a known test pattern (e2e names, "Test", "QA", the
 * previous Duran seed). Pass --keep-characters to skip character cleanup.
 *
 * Prerequisite: `npm run build:server` (imports ../../dist/server/*).
 *
 * Usage (from Builder/):
 *   node tools/milestone/reset-and-seed-alpha.mjs --dry-run
 *   node tools/milestone/reset-and-seed-alpha.mjs --emulator
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node tools/milestone/reset-and-seed-alpha.mjs
 *   GOOGLE_APPLICATION_CREDENTIALS=key.json node tools/milestone/reset-and-seed-alpha.mjs \
 *     --project <firebase-project-id> --owner-account-id <uid> --confirm-live
 *
 * Flags:
 *   --dry-run               Print the plan and seed documents; never connects.
 *   --emulator              Target the Firestore emulator (127.0.0.1:8080,
 *                           project hallucinated-dungeons-local) unless
 *                           FIRESTORE_EMULATOR_HOST is already set.
 *   --project <id>          Firebase project id (GCLOUD_PROJECT also honoured).
 *   --owner-account-id <id> Account that owns the seeded character and campaign
 *                           (HD_SEED_OWNER_ACCOUNT_ID also honoured; default
 *                           "alpha-seed-owner" on the emulator only).
 *   --owner-label <name>    Display label for the owner (default "Alpha Host").
 *   --keep-characters       Do not delete test/draft characters.
 *   --confirm-live          Required to wipe a non-emulator (live) project.
 *
 * Live credentials: GOOGLE_APPLICATION_CREDENTIALS (file), FIREBASE_SERVICE_ACCOUNT
 * (inline JSON), or application default credentials. Without any of them and
 * without an emulator host the script refuses to run (use --dry-run).
 *
 * Needs the emulator? Only for a real run against local data. --dry-run needs
 * neither the emulator nor credentials.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const BUILDER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST_SERVER = join(BUILDER_ROOT, 'dist', 'server');
const LOCAL_PROJECT_ID = 'hallucinated-dungeons-local';
const DEFAULT_EMULATOR_HOST = '127.0.0.1:8080';

export const SEED_CHARACTER_ID = 'alpha-duran-stoneguard';
export const SEED_CAMPAIGN_ID = 'alpha-shadows-over-emberferry';
export const SEED_CHARACTER_NAME = 'Duran Stoneguard';
export const SEED_CAMPAIGN_NAME = 'Shadows over Emberferry';
export const SEED_AVATAR_URL = '/assets/portraits/dwarf_fighter.jpg';
export const SEED_APPEARANCE_PROMPT =
  'Stocky dwarf fighter with a braided copper beard, steel pauldrons over scarred mail, and a heavy greatsword slung across his back.';
export const SEED_PREMISE =
  'Bram Ironkettle stands at the bar of the Brass Lantern inn in Emberferry while the cellar stairs behind him creak. A missing courier left a sealed package below, and something in the dark wants it back.';

const WIPE_COLLECTIONS = [
  'campaigns',
  'campaignMemberships',
  'campaignSeats',
  'campaignTableProjections',
  'campaignInvitations',
  'campaignSettings',
  'campaignSessions',
  'campaignMemory',
  'campaignEncounters',
  'campaignPresence',
  'campaignPresenceMeta',
  'campaignCommands',
  'campaignEvents',
  'partyChatMessages',
  'chronicleEntries',
  'timingAuthorities',
  'characterProgressions',
  'campaignAssets',
  'mapRuntimes',
];

const TEST_CHARACTER_NAME_PATTERNS = [
  /test/i,
  /^e2e/i,
  /^qa[\s_-]/i,
  /smoke/i,
  /^(ClosedCross|ReverseCross|MapA11y|SceneLoop|Brannok Stone)\b/i,
  /^Duran Stoneguard$/i,
];

export function isTestCharacterName(name) {
  return typeof name === 'string' && TEST_CHARACTER_NAME_PATTERNS.some((re) => re.test(name.trim()));
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    emulator: false,
    keepCharacters: false,
    wipeOnly: false,
    confirmLive: false,
    project: process.env.GCLOUD_PROJECT ?? null,
    ownerAccountId: process.env.HD_SEED_OWNER_ACCOUNT_ID ?? null,
    ownerLabel: 'Alpha Host',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--emulator':
        options.emulator = true;
        break;
      case '--keep-characters':
        options.keepCharacters = true;
        break;
      case '--wipe-only':
        options.wipeOnly = true;
        break;
      case '--confirm-live':
        options.confirmLive = true;
        break;
      case '--project':
        options.project = argv[(i += 1)] ?? null;
        break;
      case '--owner-account-id':
        options.ownerAccountId = argv[(i += 1)] ?? null;
        break;
      case '--owner-label':
        options.ownerLabel = argv[(i += 1)] ?? options.ownerLabel;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function importDist(relativePath) {
  const file = join(DIST_SERVER, relativePath);
  if (!existsSync(file)) {
    return null;
  }
  return import(pathToFileURL(file).href);
}

function buildSeedDocuments({ ownerAccountId, ownerLabel, rules, blueprintModule, now }) {
  const template = rules.manifest.QUICK_START_TEMPLATES.find((t) => t.id === 'stalwart-defender');
  if (template === undefined) {
    throw new Error('stalwart-defender quick-start template not found in dist.');
  }
  const choices = {
    ...rules.character.emptyChoices(),
    classId: template.classId,
    backgroundId: template.backgroundId,
    speciesId: template.speciesId,
    abilityMethod: 'standard-array',
    baseAbilityScores: template.baseAbilityScores,
    backgroundAbilityBonuses: template.backgroundAbilityBonuses,
    classSkillIds: template.classSkillIds,
    speciesChoiceIds: template.speciesChoiceIds,
    classChoiceIds: template.classChoiceIds,
    classEquipmentOptionId: template.classEquipmentOptionId,
    backgroundEquipmentOptionId: template.backgroundEquipmentOptionId,
    cantripIds: template.cantripIds,
    spellIds: template.spellIds,
    weaponMasteryWeaponNames: template.weaponMasteryWeaponNames,
    identity: {
      name: SEED_CHARACTER_NAME,
      pronouns: 'he/him',
      appearance: SEED_APPEARANCE_PROMPT,
      concept: 'A dwarven oath-keeper holding the line for a town that forgot his name.',
    },
  };
  const problems = rules.character.validateChoices(choices);
  if (problems.length > 0) {
    throw new Error(`Seed character is not legal: ${JSON.stringify(problems)}`);
  }

  const character = {
    characterId: SEED_CHARACTER_ID,
    ownerAccountId,
    rulesVersion: rules.manifest.RULES_VERSION,
    choices,
    createdAt: now,
    revisions: [{ at: now.toISOString(), reason: 'Alpha seed' }],
    avatarUrl: SEED_AVATAR_URL,
    appearancePrompt: SEED_APPEARANCE_PROMPT,
    milestonePortraitCredits: 0,
  };

  const campaignBlueprint =
    blueprintModule === null ? undefined : blueprintModule.buildCampaignBlueprint(SEED_PREMISE);
  const campaign = {
    campaignId: SEED_CAMPAIGN_ID,
    ownerAccountId,
    ownerDisplayLabel: ownerLabel,
    name: SEED_CAMPAIGN_NAME,
    summary: SEED_PREMISE,
    directorIdentity: 'veyra',
    directorPersonality: 'seasoned_host',
    directorAvatarKey: 'veyra__seasoned_host',
    directorLockedAt: now,
    adventureTemplateId: null,
    adventurePackVersion: null,
    ...(campaignBlueprint === undefined ? {} : { campaignBlueprint }),
    visibility: 'private',
    joinPasswordHash: null,
    createdAt: now,
    updatedAt: now,
  };
  const membership = {
    membershipId: `alpha-membership-${SEED_CAMPAIGN_ID}`,
    campaignId: SEED_CAMPAIGN_ID,
    accountId: ownerAccountId,
    displayLabel: ownerLabel,
    role: 'owner',
    joinedAt: now,
  };
  return { character, campaign, membership };
}

async function loadDist() {
  const [characterRules, manifest, blueprint] = await Promise.all([
    importDist('rules/character-rules.js'),
    importDist('rules/srd-manifest.js'),
    importDist('campaigns/campaign-blueprint.js'),
  ]);
  if (characterRules === null || manifest === null) {
    throw new Error('dist/server is missing. Run `npm run build:server` from Builder/ first.');
  }
  if (blueprint === null) {
    console.warn('warn: dist campaign-blueprint not importable; campaign seeds without a blueprint.');
  }
  return {
    rules: { character: characterRules, manifest },
    blueprint,
  };
}

function resolveTarget(options) {
  const emulatorHost =
    process.env.FIRESTORE_EMULATOR_HOST?.trim() ||
    (options.emulator ? DEFAULT_EMULATOR_HOST : '');
  if (emulatorHost !== '') {
    return {
      kind: 'emulator',
      emulatorHost,
      projectId: options.project ?? LOCAL_PROJECT_ID,
    };
  }
  return { kind: 'live', emulatorHost: '', projectId: options.project };
}

function hasLiveCredentials() {
  return (
    (process.env.GOOGLE_APPLICATION_CREDENTIALS ?? '').trim() !== '' ||
    (process.env.FIREBASE_SERVICE_ACCOUNT ?? '').trim() !== '' ||
    (process.env.GOOGLE_CLOUD_KEYFILE_JSON ?? '').trim() !== '' ||
    (process.env.GOOGLE_OAUTH_ACCESS_TOKEN ?? '').trim() !== ''
  );
}

function initFirestore(target) {
  if (getApps().length === 0) {
    if (target.kind === 'emulator') {
      process.env.FIRESTORE_EMULATOR_HOST = target.emulatorHost;
      initializeApp({ projectId: target.projectId });
    } else {
      delete process.env.FIRESTORE_EMULATOR_HOST;
      const inline = (process.env.FIREBASE_SERVICE_ACCOUNT ?? process.env.GOOGLE_CLOUD_KEYFILE_JSON ?? '').trim();
      const accessToken = (process.env.GOOGLE_OAUTH_ACCESS_TOKEN ?? '').trim();
      const credential = inline.startsWith('{')
        ? cert(JSON.parse(inline))
        : (process.env.GOOGLE_APPLICATION_CREDENTIALS ?? '').trim() !== ''
          ? cert(process.env.GOOGLE_APPLICATION_CREDENTIALS)
          : accessToken !== ''
            ? {
                getAccessToken: async () => ({
                  access_token: accessToken,
                  expires_in: 3600,
                }),
              }
            : applicationDefault();
      initializeApp({ projectId: target.projectId, credential });
    }
  }
  return getFirestore();
}

async function deleteDocs(firestore, docs) {
  let removed = 0;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = firestore.batch();
    for (const doc of docs.slice(i, i + 400)) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    removed += Math.min(400, docs.length - i);
  }
  return removed;
}

async function wipeCollection(firestore, name) {
  const snapshot = await firestore.collection(name).get();
  return deleteDocs(firestore, snapshot.docs);
}

async function wipeTestCharacters(firestore) {
  const summary = { characters: 0, drafts: 0, progressions: 0 };
  const characters = await firestore.collection('characters').get();
  const doomed = characters.docs.filter((doc) =>
    isTestCharacterName(doc.data()?.choices?.identity?.name),
  );
  summary.characters = await deleteDocs(firestore, doomed);
  const progressionRefs = [];
  for (const doc of doomed) {
    const ref = firestore.collection('characterProgressions').doc(doc.id);
    if ((await ref.get()).exists) {
      progressionRefs.push({ ref });
    }
  }
  summary.progressions = await deleteDocs(firestore, progressionRefs);
  const drafts = await firestore.collection('characterDrafts').get();
  summary.drafts = await deleteDocs(
    firestore,
    drafts.docs.filter((doc) => isTestCharacterName(doc.data()?.choices?.identity?.name)),
  );
  return summary;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const target = resolveTarget(options);
  const ownerAccountId =
    options.ownerAccountId ?? (target.kind === 'emulator' || options.dryRun ? 'alpha-seed-owner' : null);

  console.log(
    `reset-and-seed-alpha: target=${options.dryRun ? 'dry-run' : target.kind}` +
      (target.projectId ? ` project=${target.projectId}` : '') +
      (target.emulatorHost ? ` emulator=${target.emulatorHost}` : ''),
  );

  const dist = await loadDist();
  const now = new Date();
  const docs = buildSeedDocuments({
    ownerAccountId: ownerAccountId ?? 'alpha-seed-owner',
    ownerLabel: options.ownerLabel,
    rules: dist.rules,
    blueprintModule: dist.blueprint,
    now,
  });

  if (options.dryRun) {
    console.log(`Would wipe collections: ${WIPE_COLLECTIONS.join(', ')}`);
    console.log(
      options.keepCharacters
        ? 'Would keep all characters and drafts.'
        : `Would delete characters/drafts whose name matches: ${TEST_CHARACTER_NAME_PATTERNS.map(String).join(' ')}`,
    );
    console.log(`Would seed character ${docs.character.characterId} (${SEED_CHARACTER_NAME}), avatar ${SEED_AVATAR_URL}`);
    console.log(
      `Would seed campaign ${docs.campaign.campaignId} (${SEED_CAMPAIGN_NAME}), Director veyra, blueprint acts: ${
        docs.campaign.campaignBlueprint?.acts?.length ?? 'n/a'
      }`,
    );
    console.log(JSON.stringify({ campaign: docs.campaign, membership: docs.membership }, null, 2));
    console.log('Dry run complete; nothing was written.');
    return;
  }

  if (target.kind === 'live') {
    if (!target.projectId) {
      throw new Error('Live runs need --project <id> (or GCLOUD_PROJECT). Use --emulator for local data.');
    }
    if (!options.confirmLive) {
      throw new Error('Refusing to wipe a live project without --confirm-live. Use --dry-run or --emulator.');
    }
    if (!hasLiveCredentials() && (process.env.GOOGLE_CLOUD_PROJECT ?? '') === '') {
      console.warn('warn: no explicit credentials found; falling back to application default credentials.');
    }
    if (ownerAccountId === null && !options.wipeOnly) {
      throw new Error('Live runs need --owner-account-id <uid> so the seeded character lands in your vault.');
    }
  }

  const firestore = initFirestore(target);
  const wiped = {};
  for (const name of WIPE_COLLECTIONS) {
    wiped[name] = await wipeCollection(firestore, name);
  }
  console.log('Wiped:', JSON.stringify(wiped));
  if (!options.keepCharacters) {
    if (options.wipeOnly) {
      const allChars = await wipeCollection(firestore, 'characters');
      const allDrafts = await wipeCollection(firestore, 'characterDrafts');
      console.log('Wiped all characters & drafts:', JSON.stringify({ characters: allChars, drafts: allDrafts }));
    } else {
      console.log('Wiped test characters:', JSON.stringify(await wipeTestCharacters(firestore)));
    }
  }

  if (options.wipeOnly) {
    console.log('Wipe-only complete; zero tables or characters seeded.');
    return;
  }

  const batch = firestore.batch();
  batch.set(firestore.collection('characters').doc(docs.character.characterId), docs.character);
  batch.set(firestore.collection('campaigns').doc(docs.campaign.campaignId), docs.campaign);
  batch.set(firestore.collection('campaignMemberships').doc(docs.membership.membershipId), docs.membership);
  await batch.commit();

  const settingsModule = await importDist('settings/campaign-settings.js');
  if (settingsModule?.seedCampaignSettings) {
    await settingsModule.seedCampaignSettings(firestore, SEED_CAMPAIGN_ID, now);
  }
  const chronicleModule = await importDist('communication/chronicle.js');
  if (chronicleModule?.appendChronicleEntry) {
    await chronicleModule.appendChronicleEntry({
      firestore,
      campaignId: SEED_CAMPAIGN_ID,
      kind: 'campaign_created',
      body: `${options.ownerLabel} created this campaign with a locked Game Director configuration.`,
    });
  }

  console.log(
    `Seeded ${SEED_CHARACTER_NAME} (${SEED_CHARACTER_ID}) and "${SEED_CAMPAIGN_NAME}" (${SEED_CAMPAIGN_ID}) for owner ${docs.character.ownerAccountId}.`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`reset-and-seed-alpha failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
