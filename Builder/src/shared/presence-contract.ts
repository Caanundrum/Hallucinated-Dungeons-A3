/**
 * Campaign presence contract — Phase 4.
 *
 * Blueprint ownership: Section 25 Phase 4 (realtime presence, reconnect grace,
 * multi-tab/device, join/leave, active-Initiative disconnect lock, spectator/absence).
 *
 * Presence is server-authored. Clients heartbeat; they never invent other seats'
 * online state. Multiple device sessions for one account are visible as distinct
 * presence rows sharing the same accountId.
 */

export const PRESENCE_HEARTBEAT_INTERVAL_MS = 5_000;
export const PRESENCE_RECONNECT_GRACE_MS = 45_000;
export const PRESENCE_STALE_AFTER_MS = PRESENCE_RECONNECT_GRACE_MS + 15_000;

export type PresenceStatus = 'online' | 'grace' | 'offline' | 'spectator' | 'absent';

export interface PresenceDeviceProjection {
  readonly deviceSessionId: string;
  readonly accountId: string;
  readonly displayLabel: string;
  readonly seatId: string | null;
  readonly status: PresenceStatus;
  readonly lastHeartbeatAt: string;
  readonly connectedAt: string;
  readonly tabId: string;
}

export interface CampaignPresenceProjection {
  readonly campaignId: string;
  readonly stateVersion: number;
  readonly updatedAt: string;
  readonly devices: readonly PresenceDeviceProjection[];
  readonly onlineAccountIds: readonly string[];
  readonly graceAccountIds: readonly string[];
}

export interface PresenceHeartbeatRequest {
  readonly requestId: string;
  readonly tabId: string;
  readonly seatId?: string | null;
  readonly spectator?: boolean;
}

export const BOOTSTRAP_ADMIN_EMAIL = 'nick.donner@gmail.com';

export type IdentityProviderMode =
  | 'development_test_identity'
  | 'google_sign_in'
  | 'qa_fixture_session';
