/**
 * Director Mechanics Dispatcher — AI-First Rules & Intent Arbiter.
 *
 * Implements the core D&D 5e / SRD 5.2.1 DM principle:
 * The Dungeon Master evaluates the player's natural language declaration in context
 * of the active scene and decides IF and WHAT mechanics/checks are triggered,
 * replacing fragile keyword/regex catch-phrase libraries with semantic adjudication.
 *
 * The rules engine still strictly owns character sheet arithmetic, dice rolling,
 * and state mutations.
 */

import { GoogleGenAI } from '@google/genai';
import type { DerivedCharacterSheet } from '../../shared/character-contract.js';
import type { MapBundleProjection } from '../../shared/map-contract.js';
import type { DirectorLlmClient } from './gemini-director.js';
import { pathBesideFeature } from '../table/scene-door-intent.js';
import type {
  IntentDraftCommandType,
  SkillCheckIntent,
} from '../../shared/intent-draft-contract.js';
import { isAdjacentToDoorEdge } from '../../shared/map-presentation.js';
import {
  doorAuthorityFromStored,
  formatDoorPlayerFacingLabel,
} from '../../shared/play-authority-contract.js';
import {
  HEAVY_FIXTURE_LABEL,
  labelLooksPortableContainer,
  labelLooksPortableSceneProp,
} from '../../shared/container-contents.js';

export type DispatchActionType =
  | 'skill_check'
  | 'move_feature'
  | 'door_action'
  | 'travel_scene'
  | 'dialogue'
  | 'narrate_only'
  | 'combat_action'
  | 'take_prop'
  | 'give_item';

export interface DirectorDispatchOutput {
  readonly actionType: DispatchActionType;
  readonly reasoning?: string | undefined;
  readonly skillCheck?: {
    readonly skill: string; // e.g. 'stealth', 'investigation', 'athletics', 'perception', 'sleight_of_hand'
    readonly ability?: string | undefined;
    readonly dc: number; // e.g. 12 or 13
    readonly targetNoun?: string | undefined; // e.g. 'past Warden Elira', 'service counter'
  } | undefined;
  readonly moveFeature?: {
    readonly featureLabel: string;
  } | undefined;
  readonly doorAction?: {
    readonly doorLabel: string;
    readonly operation: 'open' | 'close' | 'unlock';
  } | undefined;
  readonly travelScene?: {
    readonly destinationHint?: string | undefined;
    readonly returnToPrevious?: boolean | undefined;
  } | undefined;
  readonly dialogue?: {
    readonly addressee?: string | null | undefined;
    readonly topic?: string | undefined;
  } | undefined;
  readonly combatAction?: {
    readonly targetLabel?: string | undefined;
    readonly isThreatOnly?: boolean | undefined;
  } | undefined;
  readonly takeProp?: {
    readonly propLabel: string;
  } | undefined;
  readonly giveItem?: {
    readonly npcLabel?: string | undefined;
    readonly itemLabel: string;
  } | undefined;
}

export const DM_DISPATCHER_SYSTEM_INSTRUCTION = `You are the Game Director (Dungeon Master) in an official tabletop D&D 5e / SRD 5.2.1 roleplaying campaign.
Your responsibility is to listen to the player's natural language declaration in the active scene and adjudicate whether game mechanics or checks are triggered.

Core D&D 5e Adjudication Rules:
1. Intent Priority over Incidental Focus:
   - When a player says "I walk up beside the service counter, keeping an eye on the closed east doorway", the player's physical destination is the "service counter". The doorway is merely observational focus. Choose "move_feature" for "service counter". Never choose "door_action" unless the player explicitly declares opening, closing, unlocking, or crossing the door.
2. Natural Speech is Not an NPC:
   - Phrases like "ask in a low voice", "whisper", or "speak quietly" describe vocal delivery. The preposition "in" or "in a low voice" is NEVER an NPC name.
   - If an NPC is addressed by name (e.g. "Warden Elira"), capture their name in addressee.
3. Ability Checks (The DM's Call):
   - The DM calls for an ability check only when an action has uncertainty and a meaningful consequence of failure.
   - Routine, safe actions (walking across an empty room, leaning on a counter, asking a friendly question, listening in a quiet room) do NOT require checks (use "move_feature", "dialogue", or "narrate_only").
   - Sneaking, slipping, or hiding past watchful NPCs or guards requires an active Dexterity (Stealth) check (default DC 12).
   - Thoroughly searching furniture, passages, compartments, or floorboards for hidden items or clues requires an Intelligence (Investigation) check (default DC 13).
   - For Investigation or Search checks, skillCheck.targetNoun MUST be the physical location, passage, doorway, or object being searched (e.g. "eastern passage", "ironbound chest", "service counter"), NEVER an absent person mentioned in phrases like "clues left by the courier".
   - Picking locks or disarming traps requires a Dexterity (Thieves' Tools) check.
4. Taking / Picking Up Visible Portable Props:
   - When a player declares taking, picking up, grabbing, pocketing, or stowing a visible portable item or container on the map (such as an iron key, bloodstained cypher, courier satchel, lantern, bell, scroll, or ledger), choose "take_prop" and set takeProp.propLabel to the item's label.
   - Never choose "take_prop" for heavy room furniture (tables, counters, crates, chests, barrels).
5. Scene Travel & Return:
   - Declarations like "I return up the cellar stairs to Drowned Crow Tavern", "I head back through the passage", or "I retreat to the previous room" trigger scene travel (use "travel_scene" with returnToPrevious: true).
6. Initiating Combat vs. Threatening Tone:
   - Determine the course of action from the full meaning of what the player describes rather than matching isolated words.
   - Carefully distinguish a threatening, aggressive, or intimidating tone in dialogue/posturing (e.g. warning an NPC, glaring, resting a hand on a hilt, making a verbal threat, demanding answers) from actually initiating combat. A threatening tone is NEVER combat — route it to "dialogue" or a Charisma (Intimidation) "skill_check" (or set combatAction.isThreatOnly = true).
   - Only choose "combat_action" (with combatAction.isThreatOnly = false) when the player is genuinely initiating physical or magical combat against a target. Any combat initiation will require explicit player confirmation before combat begins.
7. Spatial & Environmental Common Sense:
   - Always check the current scene environment, the player's current token coordinates, and the distance in feet to every door, prop, and NPC.
   - If the scene is an outdoor/exterior wilderness or trail with no doors ("Known Doors / Exits: none"), never adjudicate a door action or a trap check on a door.
   - Close physical interactions (checking a door for traps, picking a lock, searching a chest or counter) require the player token to be adjacent (within 5 ft) of the target.

Respond ONLY with a valid JSON object matching this schema:
{
  "actionType": "skill_check" | "move_feature" | "door_action" | "travel_scene" | "dialogue" | "narrate_only" | "combat_action" | "take_prop",
  "reasoning": string,
  "skillCheck": {
    "skill": string,
    "ability": string,
    "dc": number,
    "targetNoun": string
  },
  "moveFeature": {
    "featureLabel": string
  },
  "doorAction": {
    "doorLabel": string,
    "operation": "open" | "close" | "unlock"
  },
  "travelScene": {
    "destinationHint": string,
    "returnToPrevious": boolean
  },
  "dialogue": {
    "addressee": string | null,
    "topic": string
  },
  "combatAction": {
    "targetLabel": string,
    "isThreatOnly": boolean
  },
  "takeProp": {
    "propLabel": string
  }
}`;

export interface QueryDirectorMechanicsOptions {
  readonly rawText: string;
  readonly sceneTitle: string;
  readonly sceneDescription?: string | undefined;
  readonly campaignPremise?: string | undefined;
  readonly playerPosition?: { readonly column: number; readonly row: number } | undefined;
  readonly spatialObjects?: readonly string[] | undefined;
  readonly equippedItems?: readonly string[] | undefined;
  readonly visibleFeatures: readonly string[];
  readonly doors: readonly string[];
  readonly presentNpcs: readonly string[];
  readonly knownNpcs: readonly string[];
  readonly characterName: string;
  readonly characterClass?: string | undefined;
  readonly characterLevel?: number | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly llm?: DirectorLlmClient | undefined;
  readonly timeoutMs?: number | undefined;
}

export async function queryDirectorMechanicsArbiter(
  options: QueryDirectorMechanicsOptions,
): Promise<DirectorDispatchOutput | null> {
  const userPrompt = [
    `Player Character: ${options.characterName} (Level ${options.characterLevel ?? 1} ${options.characterClass ?? 'Adventurer'})`,
    options.equippedItems && options.equippedItems.length > 0
      ? `Equipped Gear: ${options.equippedItems.join(', ')}`
      : '',
    options.playerPosition
      ? `Player Token Position on Grid: (${options.playerPosition.column}, ${options.playerPosition.row})`
      : '',
    `Current Scene: ${options.sceneTitle}`,
    options.sceneDescription ? `Scene Context: ${options.sceneDescription}` : '',
    options.campaignPremise ? `Campaign Premise Context: ${options.campaignPremise}` : '',
    `Visible Features / Props: ${options.visibleFeatures.length > 0 ? options.visibleFeatures.join(', ') : 'none'}`,
    `Known Doors / Exits: ${options.doors.length > 0 ? options.doors.join(', ') : 'none'}`,
    options.spatialObjects && options.spatialObjects.length > 0
      ? `Spatial Distances from Player Token: ${options.spatialObjects.join('; ')}`
      : '',
    `Present NPCs in Room: ${options.presentNpcs.length > 0 ? options.presentNpcs.join(', ') : 'none'}`,
    `Other Known Campaign NPCs: ${options.knownNpcs.length > 0 ? options.knownNpcs.join(', ') : 'none'}`,
    '',
    `Player Declaration: "${options.rawText}"`,
  ]
    .filter(Boolean)
    .join('\n');

  // 1. If a test override / custom LLM client is supplied:
  if (options.llm !== undefined) {
    try {
      const raw = await options.llm.generateText({
        systemInstruction: DM_DISPATCHER_SYSTEM_INSTRUCTION,
        userPrompt,
      });
      return parseDispatchJson(raw);
    } catch {
      return null;
    }
  }

  // 2. Production / Milestone Gemini via @google/genai
  const env = options.env ?? process.env;
  const apiKey = (env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? '').trim();
  const project = (
    env.HD_FIREBASE_PROJECT_ID ??
    env.GOOGLE_CLOUD_PROJECT ??
    env.GCLOUD_PROJECT ??
    ''
  ).trim();
  const isLocalArena = env.HD_ENVIRONMENT_CLASS === 'local';
  const isMilestone = env.HD_ENVIRONMENT_CLASS === 'milestone';

  if (isLocalArena || (apiKey.length < 20 && (!isMilestone || project.length === 0))) {
    return null; // Local offline arena falls back to deterministic engine
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ai =
      apiKey.length >= 20
        ? new GoogleGenAI({ apiKey })
        : new GoogleGenAI({
            vertexai: true,
            project,
            location: (env.GOOGLE_CLOUD_LOCATION ?? 'us-central1').trim() || 'us-central1',
          });

    const model = (env.HD_GEMINI_MODEL ?? 'gemini-2.5-flash').trim() || 'gemini-2.5-flash';
    const timeoutMs = options.timeoutMs ?? 2500;

    const generatePromise = ai.models.generateContent({
      model,
      contents: userPrompt,
      config: {
        systemInstruction: DM_DISPATCHER_SYSTEM_INSTRUCTION,
        temperature: 0.1,
        maxOutputTokens: 600,
        responseMimeType: 'application/json',
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('DM Dispatcher timeout')), timeoutMs);
    });

    const response = await Promise.race([generatePromise, timeoutPromise]);
    const rawText = (response.text ?? '').trim();
    return parseDispatchJson(rawText);
  } catch {
    return null; // Gracefully fall back to deterministic engine on timeout or network error
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function parseDispatchJson(raw: string): DirectorDispatchOutput | null {
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (typeof parsed.actionType !== 'string') {
      return null;
    }
    return parsed as unknown as DirectorDispatchOutput;
  } catch {
    return null;
  }
}

export interface AppliedDispatchResult {
  readonly proposedCommandType: IntentDraftCommandType;
  readonly summary: string;
  readonly path?: readonly { readonly column: number; readonly row: number }[] | undefined;
  readonly returnToPrevious?: boolean | undefined;
  readonly destinationHint?: string | undefined;
  readonly edgeId?: string | undefined;
  readonly objectId?: string | undefined;
  readonly skillCheckIntent?: SkillCheckIntent | undefined;
}

export function applyDirectorDispatchToMap(options: {
  readonly dispatch: DirectorDispatchOutput;
  readonly map: MapBundleProjection;
  readonly seatedSheet: DerivedCharacterSheet | null;
  readonly knownNpcs: readonly { readonly id: string; readonly label: string }[];
  readonly absentRoomNpcs?: readonly {
    readonly id: string;
    readonly label: string;
    readonly roomTitle: string;
  }[];
}): AppliedDispatchResult | null {
  const { dispatch, map, seatedSheet, knownNpcs, absentRoomNpcs = [] } = options;
  const ownToken =
    map.viewerSeatId === null
      ? map.tokens[0]
      : (map.tokens.find((t) => t.seatId === map.viewerSeatId) ?? map.tokens[0]);

  // 1. Skill check (Stealth, Investigation, Athletics, etc.)
  if (dispatch.actionType === 'skill_check' && dispatch.skillCheck) {
    const skillName = dispatch.skillCheck.skill.toLowerCase().trim().replace(/_/g, '-');
    const skillRecord = seatedSheet?.skills.find(
      (s) => s.id.toLowerCase() === skillName || s.label.toLowerCase() === skillName.replace(/-/g, ' '),
    );
    const abilityName = dispatch.skillCheck.ability?.toLowerCase() ?? skillRecord?.ability ?? 'dexterity';
    const abilityMod =
      seatedSheet?.abilityModifiers[abilityName as keyof typeof seatedSheet.abilityModifiers] ?? 0;
    const bonusVal = skillRecord?.bonus.value ?? abilityMod;
    const bonusStr = bonusVal >= 0 ? `+${bonusVal}` : `${bonusVal}`;
    const profLabel = skillRecord?.proficient
      ? `${skillRecord.label} proficient, ${bonusStr}`
      : `${dispatch.skillCheck.skill.toLowerCase().trim()} ${bonusStr}`;
    const dc = dispatch.skillCheck.dc || (skillName === 'stealth' ? 12 : 13);
    const target = dispatch.skillCheck.targetNoun || 'the challenge';
    const targetLower = target.toLowerCase();

    // Spatial & environmental common-sense gate for close door/prop inspections:
    let matchedDoorEdge = map.edges.find(
      (e) => e.kind === 'door' && targetLower.includes(e.orientation),
    );
    if (skillName !== 'stealth' && /\b(?:door|doorway|lock|keyhole)\b/i.test(target)) {
      const doorEdges = map.edges.filter((e) => e.kind === 'door');
      const matchingContainer = map.notableFeatures.find(
        (f) => f.objectKind === 'container' && targetLower.includes(f.label.toLowerCase().replace(/\s*\([^)]+\)\s*$/, '').trim()),
      );
      if (doorEdges.length === 0 && matchingContainer === undefined) {
        return {
          proposedCommandType: 'table.sync',
          summary: `There is no door in ${map.title} to inspect — only the open surroundings and trail.`,
        };
      }
      if (ownToken !== undefined && doorEdges.length > 0 && matchingContainer === undefined) {
        const anchor = ownToken.footprint.anchor;
        const adjacentDoor = doorEdges.find((d) => isAdjacentToDoorEdge(anchor, d));
        if (adjacentDoor === undefined) {
          const nearest = doorEdges[0]!;
          const distFeet =
            Math.max(Math.abs(anchor.column - nearest.column), Math.abs(anchor.row - nearest.row)) *
            (map.coordinateSpace.feetPerSquare || 5);
          return {
            proposedCommandType: 'table.sync',
            summary: `You are ${distFeet} ft away from the doorway in ${map.title}. Move your token next to the doorway on the battle map first before inspecting it closely for traps or locks.`,
          };
        }
        matchedDoorEdge = adjacentDoor;
      }
    }

    const matchedFeature = map.notableFeatures.find((f) => {
      const base = f.label.toLowerCase().replace(/\s*\([^)]+\)\s*$/, '').trim();
      return base.length > 0 && (targetLower.includes(base) || base.includes(targetLower));
    });

    const isDoorTarget =
      matchedDoorEdge !== undefined ||
      (/\b(?:door|doorway|gate)\b/i.test(target) && matchedFeature === undefined);
    const isNpcTarget =
      matchedFeature?.objectKind === 'npc' || matchedFeature?.referenceKind === 'npc';
    const targetKind: SkillCheckIntent['targetKind'] = isDoorTarget
      ? 'door'
      : isNpcTarget
        ? 'npc'
        : matchedFeature !== undefined
          ? 'object'
          : 'environment';
    const isLockSkill =
      skillName === 'sleight-of-hand' ||
      /thieves|lockpick|pick.*lock/i.test(skillName) ||
      /\block\b/i.test(target);
    const isForceSkill = skillName === 'athletics' && (isDoorTarget || matchedFeature?.objectKind === 'container');
    const isTrapSkill =
      matchedFeature?.objectKind === 'trap' ||
      matchedFeature?.objectKind === 'hazard' ||
      /\btrap|disarm\b/i.test(target);
    const isSocialGiveSkill =
      isNpcTarget &&
      (skillName === 'persuasion' || skillName === 'intimidation' || skillName === 'deception') &&
      Array.isArray(matchedFeature?.heldItems) &&
      matchedFeature.heldItems.length > 0;

    const onSuccessMutation: SkillCheckIntent['onSuccessMutation'] = isLockSkill
      ? isDoorTarget
        ? 'unlock_door'
        : 'unlock_object'
      : isForceSkill
        ? 'force_open'
        : isTrapSkill
          ? 'disarm_trap'
          : isSocialGiveSkill
            ? 'npc_give_item'
            : skillName === 'investigation' || skillName === 'perception'
              ? 'reveal_info'
              : 'none';

    const resolvedDc =
      (isDoorTarget && isLockSkill
        ? matchedDoorEdge?.lockpickDC
        : isDoorTarget && isForceSkill
          ? matchedDoorEdge?.breakDC
          : matchedFeature !== undefined && isLockSkill
            ? matchedFeature.lockpickDC
            : matchedFeature !== undefined && isForceSkill
              ? matchedFeature.breakDC
              : undefined) ?? dc;

    const skillCheckIntent: SkillCheckIntent = {
      skill: skillName,
      ability: abilityName,
      dc: resolvedDc,
      modifier: bonusVal,
      targetKind,
      ...(matchedDoorEdge !== undefined
        ? { targetId: matchedDoorEdge.edgeId }
        : matchedFeature !== undefined
          ? { targetId: matchedFeature.objectId }
          : {}),
      targetLabel: target,
      onSuccessMutation,
    };

    let actionVerb = 'Ready to';
    if (skillName === 'stealth') {
      actionVerb = `Ready to sneak past ${target} using cover`;
    } else if (skillName === 'investigation') {
      actionVerb = `Ready to search ${target} for hidden clues`;
    } else {
      actionVerb = `Ready to attempt ${dispatch.skillCheck.skill.toLowerCase().trim()} on ${target}`;
    }

    const summary = `${actionVerb} (${profLabel}; DC ${resolvedDc}). Confirm to commit this check.`;
    return {
      proposedCommandType: 'table.sync',
      summary,
      skillCheckIntent,
    };
  }

  // 2. Feature / Prop Movement (e.g. Service Counter)
  if (dispatch.actionType === 'move_feature' && dispatch.moveFeature && ownToken) {
    const targetLabel = dispatch.moveFeature.featureLabel.toLowerCase().trim();
    let targetFeature = map.notableFeatures.find((f) => {
      const fl = f.label.toLowerCase();
      return fl.includes(targetLabel) || targetLabel.includes(fl);
    });
    let displayLabel = targetFeature?.label ?? null;
    if (
      targetFeature === undefined &&
      /\b(?:service\s+counter|counter|bar)\b/i.test(targetLabel)
    ) {
      targetFeature = map.notableFeatures.find(
        (f) =>
          f.column === 4 &&
          (f.row === 2 || f.row === 4) &&
          f.objectKind !== 'npc' &&
          f.objectKind !== 'exit',
      );
      if (targetFeature !== undefined) {
        displayLabel = 'Service counter';
      }
    }

    if (targetFeature && displayLabel !== null) {
      const featureSquare = { column: targetFeature.column, row: targetFeature.row };
      const featurePath = pathBesideFeature(ownToken.footprint.anchor, featureSquare, map);
      if (featurePath !== null && featurePath.length > 0) {
        const steps = featurePath.length;
        const feet = steps * map.coordinateSpace.feetPerSquare;
        return {
          proposedCommandType: 'table.move',
          path: featurePath,
          summary: `Walk beside the ${displayLabel} in ${map.title} (${steps} square${steps === 1 ? '' : 's'}, ${feet} ft). Confirm to commit the move.`,
        };
      }
      return {
        proposedCommandType: 'table.sync',
        summary: `You are already standing beside the ${displayLabel} in ${map.title}.`,
      };
    }
  }

  // 3. Travel Scene (Return or Advance)
  if (dispatch.actionType === 'travel_scene') {
    const returnToPrevious = dispatch.travelScene?.returnToPrevious === true;
    const hint =
      dispatch.travelScene?.destinationHint ??
      (returnToPrevious ? 'the earlier scene' : 'the next area');
    return {
      proposedCommandType: 'table.travel_scene',
      returnToPrevious,
      destinationHint: hint,
      summary: returnToPrevious
        ? `Ready to return to ${hint}. Confirm to restore it with prior consequences.`
        : `Ready to travel to ${hint}. Confirm to advance the party into the next area.`,
    };
  }

  // 4. Dialogue (NPC interaction)
  if (dispatch.actionType === 'dialogue' && dispatch.dialogue) {
    const addressee = dispatch.dialogue.addressee?.trim() ?? null;
    if (addressee && addressee.length > 0) {
      const absentNpc = absentRoomNpcs.find((n) => {
        const target = addressee.toLowerCase();
        const label = n.label.toLowerCase();
        return label === target || label.includes(target) || target.includes(label);
      });
      if (absentNpc) {
        return {
          proposedCommandType: 'table.sync',
          summary: `${absentNpc.label} is not in this room right now — they remain back in ${absentNpc.roomTitle}, out of earshot from here.`,
        };
      }
      const presentNpc = map.notableFeatures.find(
        (f) =>
          (f.objectKind === 'npc' || f.referenceKind === 'npc') &&
          f.label.toLowerCase().includes(addressee.toLowerCase()),
      );
      const isKnownNpc = knownNpcs.find((n) =>
        n.label.toLowerCase().includes(addressee.toLowerCase()),
      );

      if (!presentNpc && isKnownNpc) {
        return {
          proposedCommandType: 'table.sync',
          summary: `${isKnownNpc.label} is not in this room right now — they remain in the previous area and out of earshot.`,
        };
      }
    }
  }

  // 5. Door Action (Open / Close Door)
  if (dispatch.actionType === 'door_action' && dispatch.doorAction) {
    const targetDoor = dispatch.doorAction.doorLabel.toLowerCase();
    const matchedEdge = map.edges.find((e) => {
      if (e.kind !== 'door') return false;
      const label = formatDoorPlayerFacingLabel(doorAuthorityFromStored(e.doorState), e.orientation).toLowerCase();
      return label.includes(targetDoor) || targetDoor.includes(e.orientation);
    });
    if (matchedEdge) {
      const op = dispatch.doorAction.operation;
      const label = formatDoorPlayerFacingLabel(doorAuthorityFromStored(matchedEdge.doorState), matchedEdge.orientation);
      return {
        proposedCommandType: op === 'close' ? 'table.close_door' : 'table.open_door',
        edgeId: matchedEdge.edgeId,
        summary: `${op === 'close' ? 'Close' : 'Open'} ${label} on the table. Confirm to commit.`,
      };
    }
  }

  // 6. Combat Initiation (only when genuinely initiating combat, never for a threatening tone)
  if (dispatch.actionType === 'combat_action') {
    if (dispatch.combatAction?.isThreatOnly === true) {
      return null;
    }
    const target = dispatch.combatAction?.targetLabel?.trim() ?? '';
    return {
      proposedCommandType: 'encounter.begin',
      summary: `This action will start combat${target.length > 0 ? ` against ${target}` : ''}. Confirm that you want to initiate combat, or cancel if you did not mean to start a fight.`,
    };
  }

  // 7. Take Portable Scene Prop / Container
  if (dispatch.actionType === 'take_prop' && dispatch.takeProp) {
    const requested = dispatch.takeProp.propLabel.toLowerCase().trim();
    const portableFeatures = map.notableFeatures.filter(
      (f) =>
        f.objectKind !== 'npc' &&
        f.objectKind !== 'exit' &&
        (f.objectKind === 'item' ||
          labelLooksPortableContainer(f.label) ||
          ((f.objectKind === 'prop' || labelLooksPortableSceneProp(f.label)) &&
            !HEAVY_FIXTURE_LABEL.test(f.label))),
    );
    const matched =
      portableFeatures.find((f) => {
        const fl = f.label.toLowerCase();
        return (
          fl.includes(requested) ||
          requested.includes(fl) ||
          requested
            .split(/\s+/)
            .some((w) => w.length > 2 && !/^(?:the|and|contested)$/i.test(w) && fl.includes(w))
        );
      }) ?? (portableFeatures.length === 1 ? portableFeatures[0] : undefined);
    if (matched) {
      const cleanLabel =
        matched.label
          .replace(/\s*[—(].*$/, '')
          .replace(/^contested\s+/i, '')
          .trim() || matched.label.trim();
      return {
        proposedCommandType: 'table.take_scene_prop',
        objectId: matched.objectId,
        summary: `Ready to take ${cleanLabel} into your inventory. Confirm to stow it and remove it from the map.`,
      };
    }
  }

  // 8. Receive / Transfer Item from Present NPC
  if (dispatch.actionType === 'give_item' && dispatch.giveItem) {
    const npcFilter = (dispatch.giveItem.npcLabel ?? '').toLowerCase().trim();
    const itemFilter = dispatch.giveItem.itemLabel.toLowerCase().trim();
    const npcFeatures = map.notableFeatures.filter(
      (f) =>
        (f.objectKind === 'npc' || f.referenceKind === 'npc') &&
        Array.isArray(f.heldItems) &&
        f.heldItems.length > 0,
    );
    const matchedNpc =
      (npcFilter.length > 0
        ? npcFeatures.find((f) => f.label.toLowerCase().includes(npcFilter))
        : undefined) ?? npcFeatures[0];
    if (matchedNpc !== undefined && matchedNpc.heldItems !== undefined) {
      const matchedItem =
        matchedNpc.heldItems.find((item) => item.toLowerCase().includes(itemFilter)) ??
        matchedNpc.heldItems[0]!;
      const cleanNpc = matchedNpc.label.replace(/\s*\([^)]+\)\s*$/, '').trim();
      return {
        proposedCommandType: 'table.transfer_npc_item',
        objectId: matchedNpc.objectId,
        summary: `Ready to receive ${matchedItem} from ${cleanNpc}. Confirm to stow it in your inventory.`,
      };
    }
  }

  return null;
}
