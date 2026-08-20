/**
 * Hosted Gemini Director client — Invite-Only Alpha / Milestone only.
 *
 * Uses the Google Gen AI SDK against Gemini Enterprise Agent Platform
 * (formerly Vertex AI) with Application Default Credentials on App Hosting.
 * Local Arena never constructs this client.
 */

export const GEMINI_DIRECTOR_MODEL = 'gemini-3.7-flash';
export const GEMINI_DIRECTOR_LOCATION = 'global';

export interface DirectorLlmClient {
  generateText(input: {
    readonly systemInstruction: string;
    readonly userPrompt: string;
  }): Promise<string>;
}

export function sanitizeDirectorProse(raw: string): string {
  const stripped = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length === 0) {
    throw new Error('Gemini returned empty Director text.');
  }
  return stripped.length > 1200 ? `${stripped.slice(0, 1199).trimEnd()}…` : stripped;
}

export function createGeminiDirectorClient(options: {
  readonly projectId: string;
}): DirectorLlmClient {
  const location =
    (process.env.GOOGLE_CLOUD_LOCATION ?? '').trim() || GEMINI_DIRECTOR_LOCATION;
  return {
    async generateText(input) {
      const { GoogleGenAI } = await import('@google/genai');
      const client = new GoogleGenAI({
        enterprise: true,
        project: options.projectId,
        location,
      });
      const response = await client.models.generateContent({
        model: GEMINI_DIRECTOR_MODEL,
        contents: input.userPrompt,
        config: {
          systemInstruction: input.systemInstruction,
          temperature: 0.8,
          maxOutputTokens: 400,
        },
      });
      return sanitizeDirectorProse(response.text ?? '');
    },
  };
}
