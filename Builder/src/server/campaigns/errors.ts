/**
 * Campaign-domain errors shared across settings, communication, and campaigns.
 */

export class CampaignNotFoundError extends Error {
  constructor() {
    super('No such campaign for this account');
    this.name = 'CampaignNotFoundError';
  }
}

export class DirectorConfigLockedError extends Error {
  constructor() {
    super('Director identity and personality are locked after campaign creation');
    this.name = 'DirectorConfigLockedError';
  }
}

export class InvitationUnavailableError extends Error {
  constructor() {
    super('This invitation is not available');
    this.name = 'InvitationUnavailableError';
  }
}

export class InvitationRateLimitedError extends Error {
  constructor() {
    super('Too many invitation links were created recently');
    this.name = 'InvitationRateLimitedError';
  }
}

export class AlreadyMemberError extends Error {
  constructor() {
    super('This account is already a member of the campaign');
    this.name = 'AlreadyMemberError';
  }
}

export class NotAMemberError extends Error {
  constructor() {
    super('This account is not a member of the campaign');
    this.name = 'NotAMemberError';
  }
}

export class AlreadySeatedError extends Error {
  constructor() {
    super('This account already has a seat in the campaign');
    this.name = 'AlreadySeatedError';
  }
}

export class CampaignValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignValidationError';
  }
}
