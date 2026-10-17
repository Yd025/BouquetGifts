import { describe, it, expect } from 'vitest';
import { GeminiAi, toWav } from '../src/gemini.js';
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

describe('GeminiAi card art', () => {
  it('asks the image model for an IMAGE and returns the inline bytes with their MIME type', async () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const { f, calls } = fakeGemini(() => ({ json: { candidates: [{ content: { parts: [{ text: 'here you go' }, { inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }] } }));
    const art = await new GeminiAi('k', { fetch: f }).cardArt('a watercolor flower');
    expect(calls[0].url).toMatch(/\/models\/gemini-2\.5-flash-image:generateContent$/);
    expect(calls[0].body.generationConfig.responseModalities).toEqual(['IMAGE']);
    expect(art?.type).toBe('image/png'); expect(art?.body.equals(png)).toBe(true);
  });
  it('returns null (→ SVG fallback) on errors or text-only answers', async () => {
    expect(await new GeminiAi('k', { fetch: fakeGemini(() => ({ status: 429, json: {} })).f }).cardArt('x')).toBeNull();
    expect(await new GeminiAi('k', { fetch: fakeGemini(() => textReply('I cannot draw that')).f }).cardArt('x')).toBeNull();
  });
});

describe('card art pipeline', () => {
  async function mintOne(ai: any) {
    const { default: request } = await import('supertest');
    const { makeDb } = await import('../src/db.js'); const { seed } = await import('../src/seed.js');
    const { createApp } = await import('../src/app.js'); const { FsStorage } = await import('../src/storage.js');
    const { MockNetwork, MockVisaPayments } = await import('../src/adapters.js');
    const os = await import('node:os'); const path = await import('node:path');
    const db = await makeDb('memory'); await seed(db);
    const ctx = createApp({ db, payments: new MockVisaPayments(), network: new MockNetwork(), ai, secret: 't', storage: new FsStorage(path.join(os.tmpdir(), 'bq-art-' + Math.random())) });
    const org = request.agent(ctx.app); await org.post('/api/auth/signup').send({ email: `o${Math.random()}@x.io`, password: 'password1', name: 'Org' });
    const b = (await org.post('/api/bouquets').send({ recipientName: 'Maya', occasion: 'Birthday', neededBy: new Date(Date.now() + 10 * 864e5).toISOString(), shipBufferDays: 3 })).body.bouquet;
    const f = request.agent(ctx.app); await f.post('/api/auth/signup').send({ email: `f${Math.random()}@x.io`, password: 'password1', name: 'F' });
    await f.post(`/api/join/${b.inviteToken}`).send({ displayName: 'Jon', phone: '+12065550101', budgetMaxCents: 5000 });
    const qs = (await f.get(`/api/bouquets/${b.id}/questions`)).body.questions;
    const r = await f.post(`/api/bouquets/${b.id}/cards`).send({ answers: Object.fromEntries(qs.map((q: any) => [q.id, 0])), story: 'We hiked at dawn' });
    expect(r.status).toBe(201);
    const first = r.body.cards[0].artUrl as string;
    await Promise.all([...ctx.artJobs.values()]);
    const after = (await f.get(`/api/bouquets/${b.id}`)).body.cards[0].artUrl as string;
    return { first, after, media: await request(ctx.app).get(after) };
  }
  it('mints instantly with SVG art, then swaps in cached Gemini art', async () => {
    const { MockAi } = await import('../src/ai.js');
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64)]);
    const ai = Object.assign(new MockAi(), { provider: 'gemini', cardArt: async () => ({ body: png, type: 'image/png' }) });
    const { first, after, media } = await mintOne(ai);
    expect(first).toMatch(/\.svg$/); expect(after).toMatch(/^\/api\/media\/cards\/.+\.png$/);
    expect(media.status).toBe(200); expect(media.headers['content-type']).toContain('image/png'); expect(Buffer.from(media.body).equals(png)).toBe(true);
  });
  it('keeps the SVG when no image model is available (mock / CI)', async () => {
    const { MockAi } = await import('../src/ai.js');
    const { after, media } = await mintOne(new MockAi());
    expect(after).toMatch(/\.svg$/); expect(media.headers['content-type']).toContain('image/svg+xml');
  });
});

describe('GeminiAi narrator (TTS)', () => {
  it('requests AUDIO with a prebuilt voice and wraps raw PCM into a playable WAV', async () => {
    const pcm = Buffer.alloc(4800, 1);
    const { f, calls } = fakeGemini(() => ({ json: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }] } }));
    const a = await new GeminiAi('k', { fetch: f }).speak('From Jon. We hiked at dawn.');
    expect(calls[0].url).toMatch(/\/models\/gemini-2\.5-flash-preview-tts:generateContent$/);
    expect(calls[0].body.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(calls[0].body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Sulafat');
    expect(calls[0].body.contents[0].parts[0].text).toContain('From Jon. We hiked at dawn.');
    expect(a?.type).toBe('audio/wav');
    const w = a!.body;
    expect(w.subarray(0, 4).toString()).toBe('RIFF'); expect(w.subarray(8, 12).toString()).toBe('WAVE');
    expect(w.readUInt32LE(24)).toBe(24000); expect(w.readUInt16LE(34)).toBe(16); expect(w.readUInt32LE(40)).toBe(pcm.length); expect(w.length).toBe(44 + pcm.length);
  });
  it('passes WAV through untouched and returns null on errors (→ browser speechSynthesis)', async () => {
    const wav = toWav(Buffer.alloc(10)); expect(toWav(wav, 'audio/wav')).toBe(wav);
    expect(toWav(Buffer.alloc(8), 'audio/L16;rate=16000').readUInt32LE(24)).toBe(16000);
    expect(await new GeminiAi('k', { fetch: fakeGemini(() => ({ status: 500, json: {} })).f }).speak('x')).toBeNull();
    expect(await new GeminiAi('k', { fetch: fakeGemini(() => textReply('no audio')).f }).speak('x')).toBeNull();
  });
});
