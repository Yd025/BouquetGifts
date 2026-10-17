/**
 * Google Gemini adapter (REST, no SDK). Gemini writes card titles, polishes memories and pitches gifts.
 * Recipes, consensus rules and tiers stay deterministic: Gemini only rewrites text, and every call falls back to MockAi.
 * The key is read from GEMINI_API_KEY and is only ever sent as the x-goog-api-key header to Google.
 */
import { MockAi } from './ai.js';
import { cardTitle as mockTitle, fuse as mockFuse, TraitAgg } from './domain.js';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } };

export class GeminiAi extends MockAi {
  provider = 'gemini';
  constructor(private key: string, private opts: { model?: string; base?: string; fetch?: typeof fetch } = {}) { super(); }
  get model() { return this.opts.model ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'; }

  /** POST models/{model}:generateContent and return the response parts. Throws on HTTP errors so callers can fall back. */
  protected async generate(model: string, body: unknown, timeoutMs = 10000): Promise<GeminiPart[]> {
    const f = this.opts.fetch ?? fetch;
    const r = await f(`${this.opts.base ?? GEMINI_BASE}/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error(`gemini ${model} ${r.status}`);
    const j: any = await r.json();
    return (j.candidates?.[0]?.content?.parts ?? []) as GeminiPart[];
  }
  protected async text(prompt: string) {
    const generationConfig: any = { temperature: 0.8, maxOutputTokens: 120 };
    if (this.model.startsWith('gemini-2.5')) generationConfig.thinkingConfig = { thinkingBudget: 0 }; // short copy: skip thinking for latency
    const parts = await this.generate(this.model, { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig });
    const t = parts.map(p => p.text ?? '').join('').trim();
    if (!t) throw new Error('gemini empty');
    return t;
  }

  async cardTitle(traits: string[], story?: string) {
    // The title must name the friend's own top trait so the card matches their answers (stat chips rely on it).
    try {
      const t = (await this.text(`Write a 2-4 word playful trading-card title that MUST contain the words "${traits[0]}" for a person who is ${traits.join(', ')}${story ? ` (memory: "${story}")` : ''}. Reply with the title only.`))
        .split('\n')[0].trim().replace(/^["'*]+|["'*.]+$/g, '').slice(0, 40);
      return t.includes(traits[0]) ? t : mockTitle(traits);
    } catch { return mockTitle(traits); }
  }
  async polish(story: string, friend: string) {
    try { return (await this.text(`Lightly polish this birthday-card memory written by ${friend}. Keep it first person, keep every fact, max 30 words, no quotes, reply with the memory only: ${story}`)).replace(/^"|"$/g, '').slice(0, 300); }
    catch { return story; }
  }
  async enrichCandidates(traits: TraitAgg[], avoid?: { tags: string[]; cards: number }) {
    const base = mockFuse(traits, 2, avoid); // recipes + consensus stay authoritative; Gemini only rewrites the blurb
    await Promise.all(base.map(async c => {
      try { c.description = (await this.text(`One warm sentence (under 25 words) pitching the gift "${c.title}" for someone who is ${c.traits.join(' and ')}. Reply with the sentence only.`)).split('\n')[0]; } catch { /* keep recipe blurb */ }
    }));
    return base;
  }
}
