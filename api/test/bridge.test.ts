import { describe, it, expect } from 'vitest';
import request from 'supertest';
import os from 'node:os'; import path from 'node:path';
import { makeDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { createApp, makeClock } from '../src/app.js';
import { FsStorage } from '../src/storage.js';
import { MockAi, MockNetwork, MockVisaPayments } from '../src/adapters.js';
import { GeminiAi } from '../src/gemini.js';
import { parseChipInRules, planChipIn, amountsIn } from '../src/bridge.js';

const NOW = new Date('2026-10-17T20:00:00Z'); // a Saturday
const VISA = '4242424242424242';
function fakeGemini(reply: (body: any) => { status?: number; json?: any }) {
  const calls: any[] = [];
  const f = (async (url: string, init: any) => { const body = JSON.parse(init.body); calls.push({ url, body }); const r = reply(body); const status = r.status ?? 200;
    return { ok: status < 300, status, json: async () => r.json } as any; }) as unknown as typeof fetch;
  return { f, calls };
}
const reply = (t: string) => ({ json: { candidates: [{ content: { parts: [{ text: t }] } }] } });

/** A whole bouquet at the funding stage (2 friends with cards, a gift chosen), using any AI adapter. */
export async function fundingBouquet(ai: any) {
  const db = await makeDb('memory'); await seed(db);
  const ctx = createApp({ db, payments: new MockVisaPayments(), network: new MockNetwork(), ai, clock: makeClock(), demo: true, secret: 't', storage: new FsStorage(path.join(os.tmpdir(), 'bq-br-' + Math.random())) });
  const ag = async (name: string) => { const a = request.agent(ctx.app); await a.post('/api/auth/signup').send({ email: `${name}${Math.random()}@x.io`, password: 'password1', name }); return a; };
  const org = await ag('Org');
  const b = (await org.post('/api/bouquets').send({ recipientName: 'Maya', occasion: 'Birthday', neededBy: new Date(Date.now() + 10 * 864e5).toISOString(), shipBufferDays: 3 })).body.bouquet;
  const friends = [];
  for (let i = 0; i < 2; i++) { const f = await ag('F' + i); await f.post(`/api/join/${b.inviteToken}`).send({ displayName: 'Friend' + i, phone: '+1206555010' + i, budgetMaxCents: 20000 });
    const qs = (await f.get(`/api/bouquets/${b.id}/questions`)).body.questions;
    expect((await f.post(`/api/bouquets/${b.id}/cards`).send({ answers: Object.fromEntries(qs.map((q: any) => [q.id, 0])) })).status).toBe(201); friends.push(f); }
  const fused = (await org.post(`/api/bouquets/${b.id}/fuse`)).body;
  return { ctx, org, friends, b, fused, choose: async () => (await org.post(`/api/bouquets/${b.id}/choose`).send({ candidateId: fused.candidates[0].id })).body };
}

describe('natural-language chip-in (rules)', () => {
  it('reads soft amount, cap and payday from everyday phrasing', () => {
    expect(parseChipInRules('I can do about $30, $40 max, and I get paid Friday', NOW)).toEqual({ softCents: 3000, capCents: 4000, payday: '2026-10-23', paydayPhrase: 'Friday' });
    expect(parseChipInRules('20 bucks', NOW)).toMatchObject({ softCents: 2000, capCents: 2000, payday: null });
    expect(parseChipInRules('maybe 25-35', NOW)).toMatchObject({ softCents: 2500, capCents: 3500 });
    expect(parseChipInRules('up to fifty dollars, probably thirty', NOW)).toMatchObject({ softCents: 3000, capCents: 5000 });
    expect(parseChipInRules('$40 tops, ideally 25, paid on the 30th', NOW)).toMatchObject({ softCents: 2500, capCents: 4000, payday: '2026-10-30' });
    expect(amountsIn('I can do $15 at 5pm').map(a => a.cents)).toEqual([1500]); // times and dates are not money
    expect(parseChipInRules('happy to help!', NOW)).toBeNull();
  });
  it('plans a hold that never exceeds the cap, and warns when payday is after the buy-by date', () => {
    const late = planChipIn({ softCents: 3000, capCents: 4000, payday: '2026-10-30', paydayPhrase: 'the 30th' }, { pledgedCents: 2500, buyByAt: '2026-10-24T20:00:00Z', nextTierGapCents: null });
    expect(late.holdNowCents).toBe(1500); expect(late.warnings.join(' ')).toMatch(/after the buy-by date/); expect(late.warnings.join(' ')).toMatch(/only \$15 more fits/);
    const ok = planChipIn({ softCents: 3000, capCents: 4000, payday: '2026-10-23', paydayPhrase: 'Friday' }, { pledgedCents: 0, buyByAt: '2026-10-24T20:00:00Z', nextTierGapCents: 2000, nextTierTitle: 'Mug' });
    expect(ok.holdNowCents).toBe(3000); expect(ok.summary).toMatch(/Hold \$30 now\. Your private cap is \$40/); expect(ok.warnings.join(' ')).toMatch(/unlocks Mug/);
  });
});

describe('natural-language chip-in (Gemini)', () => {
  it('asks for JSON and accepts amounts the person actually wrote', async () => {
    const { f, calls } = fakeGemini(() => reply(JSON.stringify({ softDollars: 30, capDollars: 40, payday: '2026-10-23', paydayPhrase: 'Friday' })));
    const d = await new GeminiAi('k', { fetch: f }).understandChipIn('thirty-ish is easy, $40 max, payday is Friday', NOW);
    expect(d).toEqual({ softCents: 3000, capCents: 4000, payday: '2026-10-23', paydayPhrase: 'Friday' });
    expect(calls[0].body.generationConfig.responseMimeType).toBe('application/json');
    expect(calls[0].body.contents[0].parts[0].text).toContain('Today is Saturday 2026-10-17');
  });
  it('rejects invented amounts, bad dates and errors (→ rules decide)', async () => {
    const invent = fakeGemini(() => reply(JSON.stringify({ softDollars: 45, capDollars: 60, payday: null })));
    expect(await new GeminiAi('k', { fetch: invent.f }).understandChipIn('about $30, $40 max', NOW)).toBeNull();
    const badDate = fakeGemini(() => reply(JSON.stringify({ softDollars: 30, capDollars: 40, payday: '2019-01-01', paydayPhrase: 'then' })));
    expect(await new GeminiAi('k', { fetch: badDate.f }).understandChipIn('about $30, $40 max', NOW)).toMatchObject({ payday: null, paydayPhrase: null });
    const down = fakeGemini(() => ({ status: 429, json: {} }));
    expect(await new GeminiAi('k', { fetch: down.f }).understandChipIn('about $30', NOW)).toBeNull();
    const junk = fakeGemini(() => reply('sure! thirty dollars'));
    expect(await new GeminiAi('k', { fetch: junk.f }).understandChipIn('about $30', NOW)).toBeNull();
  });
});

describe('POST /chip-in/understand', { timeout: 30000 }, () => {
  it('works with the mock (rules) and with Gemini, and never places a hold by itself', async () => {
    const { friends, b, choose, ctx } = await fundingBouquet(new MockAi());
    expect((await friends[0].post(`/api/bouquets/${b.id}/chip-in/understand`).send({ text: '$30' })).status).toBe(409); // not funding yet
    await choose();
    const r = await friends[0].post(`/api/bouquets/${b.id}/chip-in/understand`).send({ text: 'I can do about $30, $40 max, and I get paid Friday' });
    expect(r.status).toBe(200); expect(r.body.source).toBe('rules');
    expect(r.body.plan).toMatchObject({ softCents: 3000, capCents: 4000, holdNowCents: 3000, paydayPhrase: 'Friday' });
    expect((await friends[0].get(`/api/bouquets/${b.id}`)).body.totals.heldCents).toBe(0); // understanding is not paying
    expect((await friends[0].post(`/api/bouquets/${b.id}/chip-in/understand`).send({ text: 'happy to help' })).status).toBe(422);
    expect((await friends[0].post(`/api/bouquets/${b.id}/chip-in/understand`).send({ text: '' })).status).toBe(400);
    // confirm = save budget, then the normal Visa hold
    await friends[0].patch(`/api/bouquets/${b.id}/budget`).send({ budgetMinCents: 3000, budgetMaxCents: 4000 });
    expect((await friends[0].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 3000, cardNumber: VISA, idempotencyKey: 'nl-' + b.id })).status).toBe(201);
    const again = (await friends[0].post(`/api/bouquets/${b.id}/chip-in/understand`).send({ text: '$20 more, $40 max overall' })).body.plan;
    expect(again.holdNowCents).toBe(1000); expect(again.warnings.join(' ')).toMatch(/only \$10 more fits/); // only $10 left under the $40 cap
    expect((await request(ctx.app).post(`/api/bouquets/${b.id}/chip-in/understand`).send({ text: '$5' })).status).toBe(401);
  });
  it('uses Gemini when it answers', async () => {
    const ai = Object.assign(new MockAi(), { provider: 'gemini', understandChipIn: async () => ({ softCents: 2500, capCents: 3500, payday: null, paydayPhrase: null }) });
    const { friends, b, choose } = await fundingBouquet(ai); await choose();
    const r = await friends[1].post(`/api/bouquets/${b.id}/chip-in/understand`).send({ text: 'twenty-five, thirty-five tops' });
    expect(r.body.source).toBe('gemini'); expect(r.body.plan).toMatchObject({ softCents: 2500, capCents: 3500, holdNowCents: 2500 });
  });
});
