/**
 * Hosted Gemini Director client — Invite-Only Alpha / Milestone only.
 *
 * Uses the Google Gen AI SDK against Gemini Enterprise Agent Platform
 * (formerly Vertex AI) with Application Default Credentials on App Hosting.
 * Local Arena never constructs this client.
 */

export const GEMINI_DIRECTOR_MODEL = 'gemini-3.7-flash';
export const GEMINI_DIRECTOR_LOCATION = 'global';

/**
 * Gemini 3.x counts thinking tokens against maxOutputTokens. A low cap (e.g. 400)
 * truncates Director prose mid-sentence once thinking burns the budget.
 * Keep headroom for LOW thinking + a few short sentences.
 */
export const GEMINI_DIRECTOR_MAX_OUTPUT_TOKENS = 2048;

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
  const complete = scrubIncompleteDirectorProse(stripped);
  if (complete.length === 0) {
    throw new Error('Gemini returned incomplete Director text.');
  }
  return complete.length > 1200 ? `${complete.slice(0, 1199).trimEnd()}…` : complete;
}

/**
 * True when prose ends mid-clause (token truncation / cut-off generation).
 * Example: "crossing the threshold without."
 */
export function looksLikeTruncatedDirectorProse(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return true;
  }
  if (/…\s*$/.test(trimmed)) {
    return true;
  }
  // Dangling function word as the last word (with or without a period).
  if (
    /\b(without|with|and|or|but|the|a|an|to|for|from|into|of|as|by|at|on|in|over|under|through)\.?$/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  // No sentence terminator and ends mid-thought.
  if (!/[.!?]"?$/.test(trimmed) && trimmed.split(/\s+/).length < 40) {
    return true;
  }
  return false;
}

/** Drop a final incomplete sentence; keep prior complete sentences when possible. */
export function scrubIncompleteDirectorProse(body: string): string {
  const trimmed = body.trim();
  if (!looksLikeTruncatedDirectorProse(trimmed)) {
    return trimmed;
  }
  const parts = trimmed.split(/(?<=[.!?])\s+/).filter((part) => part.trim().length > 0);
  if (parts.length > 1) {
    const kept = parts.slice(0, -1).join(' ').trim();
    if (kept.length > 0 && !looksLikeTruncatedDirectorProse(kept)) {
      return kept;
    }
  }
  const strippedTail = trimmed
    .replace(
      /\s+\b(without|with|and|or|but|the|a|an|to|for|from|into|of|as|by|at|on|in|over|under|through)\.?$/i,
      '',
    )
    .trim();
  if (strippedTail.length > 0 && strippedTail !== trimmed) {
    return /[.!?]"?$/.test(strippedTail) ? strippedTail : `${strippedTail}.`;
  }
  return trimmed;
}

export function createGeminiDirectorClient(options: {
  readonly projectId: string;
}): DirectorLlmClient {
  const location =
    (process.env.GOOGLE_CLOUD_LOCATION ?? '').trim() || GEMINI_DIRECTOR_LOCATION;
  return {
    async generateText(input) {
      const { GoogleGenAI, ThinkingLevel } = await import('@google/genai');
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
          maxOutputTokens: GEMINI_DIRECTOR_MAX_OUTPUT_TOKENS,
          // Director Address / narration do not need deep reasoning.
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW,
          },
        },
      });
      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason === 'MAX_TOKENS') {
        process.stderr.write(
          '[gemini-director] Response hit MAX_TOKENS; rejecting truncated prose.\n',
        );
        throw new Error('Gemini narration truncated at max tokens.');
      }
      return sanitizeDirectorProse(response.text ?? '');
    },
  };
}
