/**
 * Google Gemini adapter (REST, no SDK). Gemini writes card titles, polishes memories and pitches gifts.
 * Recipes, consensus rules and tiers stay deterministic: Gemini only rewrites text, and every call falls back to MockAi.
 * The key is read from GEMINI_API_KEY and is only ever sent as the x-goog-api-key header to Google.
 */
import { MockAi, type GeneratedMedia } from './ai.js';
import { groundedAmount, keepsFigures, type ChipInDraft } from './bridge.js';
import { cardTitle as mockTitle, fuse as mockFuse, TraitAgg } from './domain.js';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } };

export class GeminiAi extends MockAi {
  provider = 'gemini';
  constructor(private key: string, private opts: { model?: string; base?: string; fetch?: typeof fetch } = {}) { super(); }
  get imageModel() { return process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image'; }
  get ttsModel() { return process.env.GEMINI_TTS_MODEL ?? 'gemini-2.5-flash-preview-tts'; }
  get voice() { return process.env.GEMINI_TTS_VOICE ?? 'Sulafat'; }
  get model() { return this.opts.model ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'; }
  /** Second text model, tried when the first is out of free-tier quota (429) or unavailable. Set GEMINI_FALLBACK_MODEL='' to disable. */
  get fallbackModel() { return process.env.GEMINI_FALLBACK_MODEL ?? 'gemini-flash-lite-latest'; }
  /** Text generation with the quota fallback; thinking is switched off on 2.5 models (short copy, low latency). */
  protected async generateText(contents: unknown, config: Record<string, unknown>): Promise<GeminiPart[]> {
    const models = [this.model, this.fallbackModel].filter((m, i, a) => m && a.indexOf(m) === i);
    let last: unknown;
    for (const m of models) {
      const generationConfig: any = { ...config }; if (m.startsWith('gemini-2.5')) generationConfig.thinkingConfig = { thinkingBudget: 0 };
      try { return await this.generate(m, { contents, generationConfig }); }
      catch (e) { last = e; if (!/ (429|404|500|503)$/.test((e as Error).message)) throw e; }
    }
    throw last;
  }

  /** POST models/{model}:generateContent and return the response parts. Throws on HTTP errors so callers can fall back. */
  protected async generate(model: string, body: unknown, timeoutMs = 10000): Promise<GeminiPart[]> {
    const f = this.opts.fetch ?? fetch;
    const r = await f(`${this.opts.base ?? GEMINI_BASE}/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error(`gemini ${model} ${r.status}`);
    const j: any = await r.json();
    return (j.candidates?.[0]?.content?.parts ?? []) as GeminiPart[];
  }
  protected async text(prompt: string, maxOutputTokens = 120, temperature = 0.8) {
    const parts = await this.generateText([{ role: 'user', parts: [{ text: prompt }] }], { temperature, maxOutputTokens });
    const t = parts.map(p => p.text ?? '').join('').trim();
    if (!t) throw new Error('gemini empty');
    return t;
  }

  /** Card art from Gemini's image model. Returns null (→ SVG fallback) on any error or a text-only answer. */
  async cardArt(prompt: string): Promise<GeneratedMedia | null> {
    try {
      const parts = await this.generate(this.imageModel, { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'] } }, 60000);
      const img = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'))?.inlineData;
      return img ? { body: Buffer.from(img.data, 'base64'), type: img.mimeType } : null;
    } catch (e) { console.warn('gemini card art failed:', (e as Error).message); return null; }
  }
  /** Reveal narration from Gemini TTS, returned as a browser-playable WAV. Null (→ browser TTS) on any error. */
  async speak(text: string): Promise<GeneratedMedia | null> {
    try {
      const parts = await this.generate(this.ttsModel, {
        contents: [{ role: 'user', parts: [{ text: `Read this warmly and gently, like a friend narrating a birthday card: ${text}` }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voice } } } } }, 60000);
      const a = parts.find(p => p.inlineData?.mimeType?.startsWith('audio/'))?.inlineData;
      if (!a) return null;
      return { body: toWav(Buffer.from(a.data, 'base64'), a.mimeType), type: 'audio/wav' };
    } catch (e) { console.warn('gemini tts failed:', (e as Error).message); return null; }
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
  /**
   * Natural-language chip-in. Gemini reads the sentence into JSON; we keep only amounts the person actually wrote
   * (no invented money) and a valid near-future date. Anything else → null → the rule-based parser decides.
   */
  async understandChipIn(text: string, now: Date): Promise<ChipInDraft | null> {
    try {
      const generationConfig = { temperature: 0, maxOutputTokens: 200, responseMimeType: 'application/json',
        responseSchema: { type: 'OBJECT', properties: { softDollars: { type: 'NUMBER', nullable: true }, capDollars: { type: 'NUMBER', nullable: true }, payday: { type: 'STRING', nullable: true }, paydayPhrase: { type: 'STRING', nullable: true } } } };
      const today = now.toISOString().slice(0, 10), wd = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
      const parts = await this.generateText([{ role: 'user', parts: [{ text:
        `Today is ${wd} ${today}. A friend is chipping in to a group gift and wrote: ${JSON.stringify(text.slice(0, 500))}\n` +
        `Extract: softDollars = the amount they'd comfortably give; capDollars = the most they'd go to (same as soft if only one amount); ` +
        `payday = the next date they get paid as YYYY-MM-DD if they mention one, else null; paydayPhrase = their words for it (e.g. "Friday"). Use null for anything not stated. Never guess an amount.` }] }], generationConfig);
      const j = JSON.parse(parts.map(p => p.text ?? '').join(''));
      const c = (d: unknown) => typeof d === 'number' && d > 0 && d < 10000 ? Math.round(d * 100) : null;
      let soft = c(j.softDollars), cap = c(j.capDollars) ?? soft; soft = soft ?? cap;
      if (soft === null || cap === null) return null;
      if (!groundedAmount(soft, text) || !groundedAmount(cap, text)) return null; // Gemini named a number the person never wrote
      if (soft > cap) [soft, cap] = [cap, soft];
      const okDate = typeof j.payday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.payday) && Date.parse(j.payday) >= Date.parse(today) && Date.parse(j.payday) - Date.parse(today) < 62 * 864e5;
      return { softCents: soft, capCents: cap, payday: okDate ? j.payday : null, paydayPhrase: okDate && typeof j.paydayPhrase === 'string' ? j.paydayPhrase.slice(0, 40) : null };
    } catch (e) { console.warn('gemini chip-in failed:', (e as Error).message); return null; }
  }
  /** Reword a rule-based money explanation in warm plain language. Rejected (→ null) unless every $ figure is kept and none is added. */
  async reword(kind: 'explain' | 'concierge', text: string): Promise<string | null> {
    try {
      const ask = kind === 'explain'
        ? `Rewrite this payment explanation for one friend in a group gift so it is warm, plain and short (max 3 sentences, second person, no jargon like "pro-rata"). Keep every dollar amount exactly as written and do not add any new amounts, dates or promises. Text: ${text}`
        : `Rewrite this gift recommendation as one friendly sentence (max 35 words) saying why the gift fits the group. Keep every dollar amount exactly as written and add none. Text: ${text}`;
      const out = (await this.text(ask, 220, 0.4)).replace(/^["']|["']$/g, '').trim();
      return out && out.length <= 600 && keepsFigures(text, out) ? out : null;
    } catch { return null; }
  }
  async enrichCandidates(traits: TraitAgg[], avoid?: { tags: string[]; cards: number }) {
    const base = mockFuse(traits, 2, avoid); // recipes + consensus stay authoritative; Gemini only rewrites the blurb
    await Promise.all(base.map(async c => {
      try { c.description = (await this.text(`One warm sentence (under 25 words) pitching the gift "${c.title}" for someone who is ${c.traits.join(' and ')}. Reply with the sentence only.`)).split('\n')[0]; } catch { /* keep recipe blurb */ }
    }));
    return base;
  }
}

/** Gemini TTS returns raw 16-bit little-endian PCM ("audio/L16;codec=pcm;rate=24000"); wrap it in a RIFF/WAV header. WAV input passes through. */
export function toWav(audio: Buffer, mimeType = 'audio/L16;rate=24000') {
  if (/wav/i.test(mimeType) || audio.subarray(0, 4).toString('ascii') === 'RIFF') return audio;
  const rate = Number(/rate=(\d+)/.exec(mimeType)?.[1] ?? 24000), channels = 1, bits = 16;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + audio.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * bits / 8, 28); h.writeUInt16LE(channels * bits / 8, 32); h.writeUInt16LE(bits, 34);
  h.write('data', 36); h.writeUInt32LE(audio.length, 40);
  return Buffer.concat([h, audio]);
}
