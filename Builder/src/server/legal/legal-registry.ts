/**
 * The Legal Document Registry.
 *
 * Blueprint ownership: Section 1.8.5 — the server maintains an approved
 * registry naming each document's stable route, current version, effective
 * date, content identity, materiality classification, supported regions,
 * required acceptance combinations, superseded version, re-consent
 * requirement, and human approver/timestamp.
 *
 * This registry is Builder-authored content, versioned and reviewed the same
 * way any other source file is, not runtime AI generation. Gold Master V2
 * describes Google Sign-In as the hosted player identity, Local Arena-only
 * development identities, and the Director gateway as it exists today.
 *
 * Phase 7 records a player's acceptance of a specific version against this
 * registry. The documents remain readable without script execution.
 */

import { createHash } from 'node:crypto';

import { LEGAL_ROUTES, type LegalRoute } from '../../shared/routes.js';

export interface LegalSection {
  readonly id: string;
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

export interface LegalDocument {
  readonly route: LegalRoute;
  readonly title: string;
  readonly version: string;
  readonly effectiveDate: string;
  readonly lastReviewedDate: string;
  readonly materiality: 'material' | 'informational';
  readonly supportedRegions: readonly string[];
  readonly supersededVersion: string | null;
  readonly reConsentRequired: boolean;
  readonly contactPath: string;
  readonly sections: readonly LegalSection[];
}

function contentDigest(document: Omit<LegalDocument, 'contactPath'>): string {
  const material = JSON.stringify({
    title: document.title,
    version: document.version,
    sections: document.sections,
  });
  return createHash('sha256').update(material).digest('hex');
}

const TERMS_OF_SERVICE: LegalDocument = {
  route: '/legal/terms',
  title: 'Terms of Service',
  version: 'V2',
  effectiveDate: '2026-08-17',
  lastReviewedDate: '2026-08-17',
  materiality: 'material',
  supportedRegions: ['global'],
  supersededVersion: 'V1',
  reConsentRequired: true,
  contactPath: '/legal/content-and-safety#contact',
  sections: [
    {
      id: 'acceptance',
      heading: '1. What these terms cover',
      paragraphs: [
        'Hallucinated Dungeons is an original multiplayer tabletop roleplaying project, currently in a closed, unpaid Alpha. These terms describe how the hosted product may be used while it is being built.',
        'Recording acceptance of these terms, the Privacy Notice, and the Alpha Participation Terms is recommended during Alpha. Acceptance is recorded against the published version in effect when you confirm it.',
      ],
    },
    {
      id: 'eligibility',
      heading: '2. Alpha access and eligibility',
      paragraphs: [
        'Interactive Alpha gameplay is private, invitation-only, unpaid, and requires no installation. It is not open to the general public.',
        'Any age, regional, or provider-required eligibility restriction that applies to a specific feature is enforced at the point that feature is offered, not assumed for the whole product.',
      ],
    },
    {
      id: 'accounts',
      heading: '3. Accounts and character ownership',
      paragraphs: [
        'Every player character is owned by exactly one authenticated account, established when the character is created. No host, other player, or automated system may transfer, borrow, or seize that ownership.',
        'Hosted player identity uses Google Sign-In only. Temporary development identities and machine-only QA fixture sessions exist solely inside the Local Arena testing environment; they are stripped from Gold Master and Launch Production artifacts and cannot be converted into a hosted Google account.',
      ],
    },
    {
      id: 'acceptable-use',
      heading: '4. Acceptable use',
      paragraphs: [
        'You agree not to attempt to bypass authorization checks, impersonate another account, extract another player\u2019s private information, or interfere with the service\u2019s availability for other testers.',
        'Content you submit — character names, chat messages, and similar text — must follow the Content and Safety Notice.',
      ],
    },
    {
      id: 'availability',
      heading: '5. Availability and changes',
      paragraphs: [
        'This is an Alpha product. Features, rules, and stored data may change or reset as the product is built, and availability is not guaranteed.',
        'We will describe material changes to these terms in a new dated version rather than editing this version silently.',
      ],
    },
    {
      id: 'termination',
      heading: '6. Ending access',
      paragraphs: [
        'Alpha access may be paused or ended for a tester at any time, for any reason connected to testing quality, safety, or capacity, without that being a statement about you personally.',
        'You may stop using the service at any time. Section 3 governs what happens to characters you have created.',
      ],
    },
  ],
};

const PRIVACY_NOTICE: LegalDocument = {
  route: '/legal/privacy',
  title: 'Privacy Notice',
  version: 'V2.1',
  effectiveDate: '2026-08-19',
  lastReviewedDate: '2026-08-19',
  materiality: 'material',
  supportedRegions: ['global'],
  supersededVersion: 'V2',
  reConsentRequired: true,
  contactPath: '/legal/content-and-safety#contact',
  sections: [
    {
      id: 'what-we-collect',
      heading: '1. What we currently collect',
      paragraphs: [
        'On hosted Gold Master and Launch Production artifacts, the product uses Google Sign-In as the only player-facing identity. The Google account identifier and any server-verified email needed for Admin authorization and audit, plus the characters, campaigns, and gameplay records you create, are stored so the product can persist your progress.',
        'Inside the Local Arena only, a temporary development identity may be minted for testing. That identity carries no password, never appears on hosted artifacts, and cannot be converted into a public Google account.',
      ],
    },
    {
      id: 'google-sign-in',
      heading: '2. Google Sign-In on hosted builds',
      paragraphs: [
        'When you choose Sign in with Google, Google processes your sign-in according to Google\u2019s Privacy Policy. Hallucinated Dungeons receives the Google account identifier and any profile information Google shares for authentication (such as your display name and email address when available). We use that information only to recognize your account, show your characters and campaigns, and operate the Alpha.',
        'We do not sell this information, use it for advertising, or request Google permissions beyond what sign-in requires. You can revoke the app\u2019s access from your Google Account security settings at any time.',
      ],
    },
    {
      id: 'how-we-use-it',
      heading: '3. How we use it',
      paragraphs: [
        'Stored data is used to run the game you are testing: recognizing your account, showing your characters and campaigns back to you, and letting the team diagnose problems you report.',
        'We do not sell tester data, and we do not use it for advertising.',
      ],
    },
    {
      id: 'retention',
      heading: '4. Retention and deletion',
      paragraphs: [
        'Alpha data is disposable by design and may be reset as the product changes. We will give notice before a reset that would remove your characters or campaigns where practical.',
        'You may ask for your account\u2019s data to be deleted using the contact path below.',
      ],
    },
    {
      id: 'local-identities',
      heading: '5. Local development identities',
      paragraphs: [
        'A local development identity is created only inside the local, non-public testing environment and never inside Gold Master or Launch Production artifacts. It is not visible outside that environment and cannot be converted into a public account.',
      ],
    },
    {
      id: 'your-choices',
      heading: '6. Your choices',
      paragraphs: [
        'You can ask what data is stored against your account, correct inaccurate profile information, and request deletion, subject to keeping the records needed to run an active campaign fairly for other players at the same table.',
      ],
    },
  ],
};

const ALPHA_PARTICIPATION_TERMS: LegalDocument = {
  route: '/legal/alpha-participation',
  title: 'Alpha Participation Terms',
  version: 'V2',
  effectiveDate: '2026-08-17',
  lastReviewedDate: '2026-08-17',
  materiality: 'material',
  supportedRegions: ['global'],
  supersededVersion: 'V1',
  reConsentRequired: true,
  contactPath: '/legal/content-and-safety#contact',
  sections: [
    {
      id: 'what-alpha-means',
      heading: '1. What "Alpha" means here',
      paragraphs: [
        'The product is being built in phases. A locally certified Gold Master is not a Launch Production deployment. Publication to Launch Production happens only after Product Owner authorization of an exact candidate hash, and Alpha 3 has no Open Alpha mode.',
        'Bugs, incomplete features, and occasional instability are expected. Reporting them is a core part of participating.',
      ],
    },
    {
      id: 'invitation',
      heading: '2. Invitation and eligibility',
      paragraphs: [
        'Alpha access is by invitation only, is not for sale, and may be limited in capacity. An invitation may be withdrawn if it was issued in error or if capacity requires it.',
      ],
    },
    {
      id: 'no-payment',
      heading: '3. No payment',
      paragraphs: [
        'Alpha 3 contains no checkout, subscription, tip, donation unlock, paid asset credit, premium queue, or paid ruling of any kind. Nothing in the Alpha requires payment.',
      ],
    },
    {
      id: 'data-reset',
      heading: '4. Data reset and instability',
      paragraphs: [
        'Because the product is under active construction, campaign and character data may be reset, migrated, or made temporarily unavailable without the guarantees a finished product would offer.',
      ],
    },
    {
      id: 'feedback',
      heading: '5. Feedback',
      paragraphs: [
        'Feedback you submit about the Alpha may be used to improve the product. You are not entitled to compensation for feedback you choose to provide.',
      ],
    },
  ],
};

const CONTENT_AND_SAFETY_NOTICE: LegalDocument = {
  route: '/legal/content-and-safety',
  title: 'Content and Safety Notice',
  version: 'V2',
  effectiveDate: '2026-08-17',
  lastReviewedDate: '2026-08-20',
  materiality: 'material',
  supportedRegions: ['global'],
  supersededVersion: 'V1',
  reConsentRequired: true,
  contactPath: '/legal/content-and-safety#contact',
  sections: [
    {
      id: 'original-content',
      heading: '1. Original and licensed content',
      paragraphs: [
        'Hallucinated Dungeons\u2019 mechanical foundation is the licensed SRD 5.2.1 rules manifest. Its world, characters, art direction, and narrative content are original or separately licensed; the product is not an unlicensed reproduction of commercial books.',
      ],
    },
    {
      id: 'ai-narration',
      heading: '2. AI-assisted narration',
      paragraphs: [
        'An AI Game Director narrates scenes and portrays non-player characters. In the Local Arena the Director is a deterministic simulator behind the same production gateway. On hosted Invite-Only Alpha the same gateway may call Gemini through Gemini Enterprise Agent Platform in this Firebase project. Live Gemini is never called from Local Arena.',
        'The Director cannot mutate table state, invent hidden facts, or act as a second rules engine. Party Chat remains a social surface, not a command path.',
      ],
    },
    {
      id: 'reporting',
      heading: '3. Reporting and moderation',
      paragraphs: [
        'If you experience or witness behavior that concerns you, use the contact path below. Reports are reviewed by a human, not resolved automatically.',
      ],
    },
    {
      id: 'age-region',
      heading: '4. Age and region notices',
      paragraphs: [
        'Any age or region restriction required by a specific provider or by applicable law is enforced at the point that provider or capability is used. No selected hosted provider currently requires an adult-eligibility gate, so this candidate does not collect an adult affirmation merely because the schema exists.',
      ],
    },
    {
      id: 'contact',
      heading: '5. Contact',
      paragraphs: [
        'For any question about these documents or to report a concern, contact the project team through the invitation channel you received your Alpha access from.',
      ],
    },
  ],
};

const REGISTRY: readonly LegalDocument[] = [
  TERMS_OF_SERVICE,
  PRIVACY_NOTICE,
  ALPHA_PARTICIPATION_TERMS,
  CONTENT_AND_SAFETY_NOTICE,
];

// Fail fast if a route is ever added to the shared route table without a
// matching document, or the reverse. The registry and the route table must
// name the same four routes.
const registryRoutes = new Set(REGISTRY.map((document) => document.route));
for (const route of LEGAL_ROUTES) {
  if (!registryRoutes.has(route)) {
    throw new Error(`Legal Document Registry is missing an entry for declared route ${route}.`);
  }
}
if (registryRoutes.size !== LEGAL_ROUTES.length) {
  throw new Error('Legal Document Registry declares a route not present in the shared route table.');
}

/** Looks up one document by its stable route, or null when the registry has no entry for it. */
export function getLegalDocument(
  route: LegalRoute,
): (LegalDocument & { readonly contentDigest: string }) | null {
  const document = REGISTRY.find((entry) => entry.route === route);
  if (document === undefined) {
    return null;
  }
  return { ...document, contentDigest: contentDigest(document) };
}

/** Lists every registered document, most useful for an index page or a future acceptance flow. */
export function listLegalDocuments(): readonly (LegalDocument & { readonly contentDigest: string })[] {
  return REGISTRY.map((document) => ({ ...document, contentDigest: contentDigest(document) }));
}
