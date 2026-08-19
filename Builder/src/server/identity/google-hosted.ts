/**
 * Hosted Google Sign-In for Invite-Only Alpha (Milestone).
 *
 * The browser obtains a Google ID token via Google Identity Services. This
 * module exchanges it with Firebase Auth Identity Toolkit and never trusts a
 * client-supplied email. Local Arena emulator identity is a separate path.
 */

export class GoogleHostedIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleHostedIdentityError';
  }
}

export interface HostedGoogleProfile {
  readonly uid: string;
  readonly email: string;
  readonly displayName: string;
}

interface IdentityToolkitSignInResponse {
  readonly localId?: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly error?: { readonly message?: string };
}

export async function exchangeGoogleIdToken(options: {
  readonly webApiKey: string;
  readonly googleIdToken: string;
  readonly requestUri: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<HostedGoogleProfile> {
  const googleIdToken = options.googleIdToken.trim();
  if (googleIdToken.length < 20) {
    throw new GoogleHostedIdentityError('Google Sign-In did not return a usable identity token.');
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(options.webApiKey)}`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      postBody: `id_token=${googleIdToken}&providerId=google.com`,
      requestUri: options.requestUri,
      returnIdpCredential: true,
      returnSecureToken: true,
    }),
  });
  const payload = (await response.json()) as IdentityToolkitSignInResponse;
  if (!response.ok) {
    throw new GoogleHostedIdentityError(
      payload.error?.message ?? 'Google Sign-In could not be verified.',
    );
  }
  const email = payload.email?.trim().toLowerCase() ?? '';
  const uid = payload.localId?.trim() ?? '';
  if (email === '' || !email.includes('@') || uid === '') {
    throw new GoogleHostedIdentityError(
      'Google Sign-In succeeded but did not return a verified email.',
    );
  }
  return {
    uid,
    email,
    displayName: (payload.displayName ?? email.split('@')[0] ?? 'Player').slice(0, 64),
  };
}
