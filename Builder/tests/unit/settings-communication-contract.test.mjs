import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACTION_COMPOSER_STRUCTURE,
  DOCK_TABS,
  DOCK_TAB_LABELS,
  PARTY_CHAT_MODES,
  RULES_DESK_NOTICE,
  isDockTab,
  isPartyChatMode,
} from '../../dist/shared/communication-contract.js';
import {
  CONTENT_PROFILES,
  GROUP_DECISION_POLICIES,
  REACTION_WINDOW_SECONDS_DEFAULT,
  REACTION_WINDOW_SECONDS_MAX,
  REACTION_WINDOW_SECONDS_MIN,
  RESERVED_PLAYER_PRESENTATION_DEFAULTS,
  defaultCampaignSettingsFields,
  isContentProfile,
  isGroupDecisionPolicy,
} from '../../dist/shared/settings-contract.js';
import { campaignRouteFromPath } from '../../dist/shared/routes.js';

test('dock tabs are peer destinations including Director Address', () => {
  assert.deepEqual([...DOCK_TABS], ['chronicle', 'party_chat', 'rules_desk', 'director_address']);
  assert.equal(DOCK_TAB_LABELS.chronicle, 'Chronicle');
  assert.equal(DOCK_TAB_LABELS.party_chat, 'Party Chat');
  assert.equal(DOCK_TAB_LABELS.rules_desk, 'Rules Desk');
  assert.equal(DOCK_TAB_LABELS.director_address, 'Director Address');
  assert.equal(isDockTab('party_chat'), true);
  assert.equal(isDockTab('director_address'), true);
  assert.equal(isDockTab('action_composer'), false);
});

test('party chat modes stay Table Talk and Speak as Character only', () => {
  assert.deepEqual([...PARTY_CHAT_MODES], ['table_talk', 'speak_as_character']);
  assert.equal(isPartyChatMode('table_talk'), true);
  assert.equal(isPartyChatMode('address_director'), false);
});

test('action composer enables table sync while keeping Interpret Action gated', () => {
  assert.equal(ACTION_COMPOSER_STRUCTURE.available, true);
  assert.match(ACTION_COMPOSER_STRUCTURE.notice, /separate from Party Chat/i);
  assert.match(ACTION_COMPOSER_STRUCTURE.notice, /Active Turn Authority|Timing Authority/i);
  assert.equal(ACTION_COMPOSER_STRUCTURE.tableSyncLabel, 'Commit table sync');
  assert.match(RULES_DESK_NOTICE, /cannot grant rulings/i);
});

test('settings defaults keep speech off until the player enables them', () => {
  const defaults = defaultCampaignSettingsFields();
  assert.equal(defaults.contentProfile, 'adventure');
  assert.equal(defaults.groupDecisionPolicy, 'majority_vote');
  assert.equal(defaults.reactionWindowSeconds, REACTION_WINDOW_SECONDS_DEFAULT);
  assert.equal(defaults.sessionZero.completed, false);
  assert.equal(defaults.sessionZero.pvpPolicy, 'consent_required');
  assert.equal(RESERVED_PLAYER_PRESENTATION_DEFAULTS.textToSpeechEnabled, false);
  assert.equal(RESERVED_PLAYER_PRESENTATION_DEFAULTS.speechToTextEnabled, false);
  assert.equal(RESERVED_PLAYER_PRESENTATION_DEFAULTS.chronicleAutoplay, false);
});

test('content profile and group-decision guards reject forged ids', () => {
  assert.equal(CONTENT_PROFILES.includes('adventure'), true);
  assert.equal(isContentProfile('tense'), true);
  assert.equal(isContentProfile('unfiltered'), false);
  assert.equal(isGroupDecisionPolicy('majority_vote'), true);
  assert.equal(GROUP_DECISION_POLICIES.includes('designated_caller'), true);
  assert.equal(isGroupDecisionPolicy('owner_decree'), false);
});

test('reaction window bounds match the approved Phase 1 range', () => {
  assert.equal(REACTION_WINDOW_SECONDS_MIN, 8);
  assert.equal(REACTION_WINDOW_SECONDS_MAX, 30);
  assert.equal(REACTION_WINDOW_SECONDS_DEFAULT, 12);
});

test('campaign settings and table routes parse from the shared route table', () => {
  assert.deepEqual(campaignRouteFromPath('/campaigns/abc'), {
    campaignId: 'abc',
    subroute: 'detail',
  });
  assert.deepEqual(campaignRouteFromPath('/campaigns/abc/settings'), {
    campaignId: 'abc',
    subroute: 'settings',
  });
  assert.deepEqual(campaignRouteFromPath('/campaigns/abc/table'), {
    campaignId: 'abc',
    subroute: 'table',
  });
  assert.equal(campaignRouteFromPath('/campaigns/new'), null);
  assert.equal(campaignRouteFromPath('/campaigns'), null);
});
