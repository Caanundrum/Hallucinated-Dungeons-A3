import type { CandidateIdentity } from '../shared/contract.js';

interface GoogleIdentityServices {
  readonly accounts: {
    readonly id: {
      initialize: (config: {
        client_id: string;
        callback?: (response: { credential: string }) => void;
        ux_mode?: 'popup' | 'redirect' | string;
        login_uri?: string;
      }) => void;
      renderButton?: (parent: HTMLElement, options: Record<string, string>) => void;
    };
  };
}

/** GIS button options aligned with Google Sign-In branding guidelines. */
export const HOSTED_GOOGLE_BUTTON_OPTIONS = {
  type: 'standard',
  theme: 'filled_black',
  size: 'large',
  text: 'continue_with',
  shape: 'pill',
  width: '320',
  logo_alignment: 'left',
} as const;

function googleIdentity(): GoogleIdentityServices | undefined {
  return (window as unknown as { google?: GoogleIdentityServices }).google;
}

export function hostedGoogleLoginUri(): string {
  return `${window.location.origin}/auth/google-login`;
}

export function loadGoogleIdentityServices(): Promise<void> {
  if (googleIdentity()?.accounts.id !== undefined) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-hd-gis]');
    if (existing instanceof HTMLScriptElement) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Google Sign-In failed to load.')), {
        once: true,
      });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.dataset.hdGis = 'true';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Google Sign-In failed to load.')), {
      once: true,
    });
    document.head.appendChild(script);
  });
}

/**
 * Renders the official Sign in with Google button. Players must click it
 * directly — Google Identity Services does not allow programmatic initiation.
 */
export function mountHostedGoogleSignInButton(options: {
  readonly candidate: CandidateIdentity;
  readonly buttonHost: HTMLElement;
}): Promise<void> {
  const clientId = options.candidate.hostedGoogleClientId;
  if (clientId === null || clientId === undefined) {
    return Promise.reject(new Error('Google Sign-In is not configured for this build.'));
  }
  return loadGoogleIdentityServices().then(() => {
    const api = googleIdentity();
    if (api === undefined) {
      throw new Error('Google Sign-In failed to load.');
    }
    options.buttonHost.replaceChildren();
    api.accounts.id.initialize({
      client_id: clientId,
      ux_mode: 'redirect',
      login_uri: hostedGoogleLoginUri(),
    });
    api.accounts.id.renderButton?.(options.buttonHost, { ...HOSTED_GOOGLE_BUTTON_OPTIONS });
  });
}
