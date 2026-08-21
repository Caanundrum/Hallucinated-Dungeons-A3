/**
 * Trusted visible-state context pack for Director / DM prompts.
 *
 * Assembles only actor-visible facts from existing projections (fogged map,
 * public/private memory, own sheet, recent event summaries). Never invents
 * hidden facts or mechanical outcomes.
 */

import type { Firestore } from 'firebase-admin/firestore';

import type { CampaignMemoryProjection } from '../../shared/campaign-memory-contract.js';
import type { DerivedCharacterSheet } from '../../shared/character-contract.js';
import type { MapBundleProjection } from '../../shared/map-contract.js';
import type {
  CharacterProgressionProjection,
  EncounterProjection,
} from '../../shared/rules-combat-contract.js';
import { loadCampaignMemory } from '../campaigns/campaign-memory.js';
import { fetchRulesState } from '../rules/engine/rules-commands.js';
import { fetchCampaignMap } from '../table/map-projection.js';
import { fetchTableState } from '../table/commands.js';

const MAX_CONTEXT_CHARS = 4500;

export interface DirectorVisibleContextPack {
  readonly text: string;
  readonly includedIds: readonly string[];
  readonly sceneTitle: string;
  readonly directorPromptLead: string;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function formatSheet(sheet: DerivedCharacterSheet, characterName?: string): string {
  const proficientSkills = sheet.skills
    .filter((skill) => skill.proficient)
    .map((skill) => `${skill.label} (${skill.bonus.value >= 0 ? '+' : ''}${skill.bonus.value})`)
    .join(', ');
  const spells =
    sheet.spellcasting === null
      ? 'None'
      : [
          ...sheet.spellcasting.cantrips.map((spell) => spell.name),
          ...sheet.spellcasting.spells.map((spell) => spell.name),
        ].join(', ') || 'None prepared/known';
  const attacks = sheet.attacks
    .map(
      (attack) =>
        `${attack.name} (${attack.attackBonus.value >= 0 ? '+' : ''}${attack.attackBonus.value} to hit, ${attack.damage})`,
    )
    .join('; ');
  return [
    `Active character${characterName ? ` (${characterName})` : ''}: level ${sheet.level}`,
    `HP ${sheet.hitPoints.value}, AC ${sheet.armorClass.value}, Speed ${sheet.speed.value}, Initiative ${sheet.initiative.value >= 0 ? '+' : ''}${sheet.initiative.value}`,
    `Ability mods: STR ${sheet.abilityModifiers.strength}, DEX ${sheet.abilityModifiers.dexterity}, CON ${sheet.abilityModifiers.constitution}, INT ${sheet.abilityModifiers.intelligence}, WIS ${sheet.abilityModifiers.wisdom}, CHA ${sheet.abilityModifiers.charisma}`,
    `Proficient skills: ${proficientSkills || 'none'}`,
    `Attacks: ${attacks || 'none'}`,
    `Spellcasting: ${spells}`,
    sheet.spellcasting
      ? `Level 1 slots: ${sheet.spellcasting.level1SlotCount}; save DC ${sheet.spellcasting.spellSaveDc.value}`
      : null,
    `Features: ${sheet.features.map((feature) => feature.name).join(', ') || 'none'}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function formatEncounter(encounter: EncounterProjection | null): string {
  if (encounter === null || encounter.status === 'ended') {
    return 'Combat: not active (exploration / free movement).';
  }
  const active =
    encounter.combatants.find((combatant) => combatant.combatantId === encounter.activeCombatantId)
      ?.name ?? 'none';
  const roster = encounter.combatants
    .map(
      (combatant) =>
        `${combatant.name}: HP ${combatant.currentHitPoints}/${combatant.maxHitPoints}, AC ${combatant.armorClass}, conditions ${
          combatant.conditions.map((condition) => condition.label).join(', ') || 'none'
        }`,
    )
    .join('\n');
  return [
    `Combat: ${encounter.status}, round ${encounter.round}, active turn: ${active}`,
    roster,
  ].join('\n');
}

function formatMap(map: MapBundleProjection): string {
  const ownToken =
    map.viewerSeatId === null
      ? null
      : map.tokens.find((token) => token.seatId === map.viewerSeatId) ?? null;
  const visibleDoors = map.edges
    .filter((edge) => edge.kind === 'door')
    .map((edge) => `${edge.edgeId} (${edge.doorState ?? 'closed'})`)
    .slice(0, 12);
  const features = map.notableFeatures
    .map((feature) => `${feature.label} at c${feature.column}r${feature.row}`)
    .slice(0, 12);
  return [
    `Scene: ${map.title}`,
    `Banner: ${map.sceneBanner}`,
    ownToken
      ? `Your token at column ${ownToken.footprint.anchor.column}, row ${ownToken.footprint.anchor.row}`
      : 'No seated token on the map for this viewer.',
    `Visible squares: ${map.visibleSquareIds.length}; explored: ${map.exploredSquareIds.length}`,
    visibleDoors.length > 0 ? `Doors known: ${visibleDoors.join('; ')}` : 'No doors in the visible projection.',
    features.length > 0 ? `Visible features: ${features.join('; ')}` : 'No named features in visible squares.',
  ].join('\n');
}

function formatMemory(memory: CampaignMemoryProjection | null): string {
  if (memory === null) {
    return 'Campaign memory: unavailable.';
  }
  const chapter =
    memory.chapters.find((entry) => entry.chapterId === memory.currentChapterId) ?? null;
  const npcs = memory.npcs
    .filter((npc) => npc.audience !== 'secret')
    .slice(0, 8)
    .map((npc) => `${npc.name} (${npc.role}): ${npc.motive}`)
    .join('\n');
  const quests = memory.quests
    .filter((quest) => quest.audience !== 'secret')
    .slice(0, 6)
    .map((quest) => `${quest.title} [${quest.status}]: ${quest.summary}`)
    .join('\n');
  return [
    chapter
      ? `Current chapter: ${chapter.title} — ${chapter.planSummary}`
      : 'Current chapter: none',
    npcs.length > 0 ? `Known NPCs:\n${npcs}` : 'Known NPCs: none listed',
    quests.length > 0 ? `Quests:\n${quests}` : 'Quests: none listed',
  ].join('\n');
}

function formatRecentEvents(
  events: readonly { readonly eventType: string; readonly summary?: string }[],
): string {
  const lines = events
    .slice(-8)
    .map((event) => event.summary?.trim() || event.eventType)
    .filter((line) => line.length > 0);
  return lines.length === 0
    ? 'Recent table events: none yet.'
    : `Recent table events:\n${lines.map((line) => `- ${line}`).join('\n')}`;
}

export async function assembleDirectorVisibleContext(options: {
  readonly firestore: Firestore;
  readonly campaignId: string;
  readonly accountId: string;
}): Promise<DirectorVisibleContextPack> {
  const { firestore, campaignId, accountId } = options;
  const includedIds: string[] = [accountId, campaignId];

  let map: MapBundleProjection | null = null;
  let progression: CharacterProgressionProjection | null = null;
  let encounter: EncounterProjection | null = null;
  let memory: CampaignMemoryProjection | null = null;
  let recentEvents: readonly { readonly eventType: string; readonly summary?: string }[] = [];

  try {
    map = await fetchCampaignMap({ firestore, accountId, campaignId });
    includedIds.push(map.mapBundleId);
  } catch {
    map = null;
  }

  try {
    const table = await fetchTableState({ firestore, accountId, campaignId });
    recentEvents = table.recentEvents;
  } catch {
    recentEvents = [];
  }

  try {
    const rules = await fetchRulesState({ firestore, accountId, campaignId });
    progression = rules.progression;
    encounter = rules.encounter;
    includedIds.push(progression.characterId);
  } catch {
    progression = null;
    encounter = null;
  }

  try {
    memory = await loadCampaignMemory(firestore, campaignId, accountId);
    if (memory.currentChapterId !== null) {
      includedIds.push(memory.currentChapterId);
    }
  } catch {
    memory = null;
  }

  const blocks = [
    '=== AUTHORITATIVE VISIBLE GAME STATE (do not invent beyond this) ===',
    map === null ? 'Scene: map unavailable for this viewer.' : formatMap(map),
    formatMemory(memory),
    progression === null
      ? 'Active character sheet: no seated character for this viewer.'
      : formatSheet(progression.sheet),
    formatEncounter(encounter),
    formatRecentEvents(recentEvents),
    '=== END STATE ===',
  ];

  const sceneTitle = map?.title ?? 'the table';
  const text = truncate(blocks.join('\n\n'), MAX_CONTEXT_CHARS);
  const directorPromptLead =
    map === null
      ? 'The party is gathered at the table.'
      : `${map.sceneBanner} (${map.title})`;

  return { text, includedIds, sceneTitle, directorPromptLead };
}
