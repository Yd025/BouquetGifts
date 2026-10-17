import { describe, it, expect } from 'vitest';
import { GeminiAi } from '../src/gemini.js';
import { aggregateTraits } from '../src/domain.js';

// Offline: a fake fetch stands in for generativelanguage.googleapis.com, so CI never needs a key.
type Call = { url: string; headers: any; body: any };
function fakeGemini(reply: (body: any, url: string) => { status?: number; json?: any }) {
  const calls: Call[] = [];
  const f = (async (url: string, init: any) => {
    const body = JSON.parse(init.body); calls.push({ url, headers: init.headers, body });
    const r = reply(body, url); const status = r.status ?? 200;
    return { ok: status < 300, status, json: async () => r.json } as any;
  }) as unknown as typeof fetch;
  return { f, calls };
}
const textReply = (t: string) => ({ json: { candidates: [{ content: { parts: [{ text: t }] } }] } });

describe('GeminiAi text', () => {
  it('calls generateContent on GEMINI_MODEL with the key header only, and keeps titles on-trait', async () => {
    const { f, calls } = fakeGemini(() => textReply('"The Dawn Sunrise Hiker"\n'));
    const ai = new GeminiAi('test-key', { fetch: f, model: 'gemini-2.5-flash' });
    expect(await ai.cardTitle(['Sunrise Hiker', 'Coffee Snob'])).toBe('The Dawn Sunrise Hiker');
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(calls[0].headers['x-goog-api-key']).toBe('test-key');
    expect(calls[0].url).not.toContain('test-key'); // key never in the URL (logs)
    expect(calls[0].body.contents[0].parts[0].text).toContain('"Sunrise Hiker"');
    expect(calls[0].body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(ai.provider).toBe('gemini');
  });
  it('falls back to the deterministic mock when Gemini is off-trait, errors, or returns nothing', async () => {
    const off = new GeminiAi('k', { fetch: fakeGemini(() => textReply('Mountain Bean Queen')).f });
    expect(await off.cardTitle(['Sunrise Hiker', 'Coffee Snob'])).toMatch(/Sunrise Hiker/);
    const down = new GeminiAi('k', { fetch: fakeGemini(() => ({ status: 503, json: {} })).f });
    expect(await down.polish('we hiked at dawn', 'Jon')).toBe('we hiked at dawn');
    expect(await down.cardTitle(['Bookworm'])).toMatch(/Bookworm/);
    const empty = new GeminiAi('k', { fetch: fakeGemini(() => ({ json: { candidates: [] } })).f });
    expect(await empty.polish('kept', 'Jon')).toBe('kept');
  });
  it('rewrites only gift blurbs; recipes, rarity and traits stay deterministic', async () => {
    const agg = aggregateTraits([{ id: 'c1', memberId: 'm1', traits: ['Sunrise Hiker', 'Coffee Snob'] }, { id: 'c2', memberId: 'm2', traits: ['Sunrise Hiker', 'Coffee Snob'] }] as any);
    const ai = new GeminiAi('k', { fetch: fakeGemini(b => textReply('Pitch for ' + /"([^"]+)"/.exec(b.contents[0].parts[0].text)![1])).f });
    const out = await ai.enrichCandidates(agg);
    const mock = await new (await import('../src/ai.js')).MockAi().enrichCandidates(agg);
    expect(out.map(c => [c.title, c.rare, c.traits])).toEqual(mock.map(c => [c.title, c.rare, c.traits]));
    expect(out.every(c => c.description === 'Pitch for ' + c.title)).toBe(true);
  });
});
