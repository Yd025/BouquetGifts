import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { makeDb } from '../src/db.js';
import { MockAi, MockNetwork, MockVisaPayments } from '../src/adapters.js';
import { createApp, makeClock } from '../src/app.js';
import { seed } from '../src/seed.js';
import { FsStorage } from '../src/storage.js';
import os from 'node:os'; import path from 'node:path';
import { drawQuestions, QUESTIONS, RECIPES } from '../src/domain.js';
import { traitProducts } from '../src/catalog.js';

const TOK = 'tok_test_visa_4242';
let app: any, ctx: any, payments: MockVisaPayments;
// MockAi plus a switchable fake narrator, so the TTS cache and the browser fallback can both be tested offline.
class TestAi extends MockAi { voiceOn = false; spoken: string[] = [];
  async speak(text: string) { if (!this.voiceOn) return null; this.spoken.push(text); return { body: Buffer.from('RIFF....WAVEfake'), type: 'audio/wav' }; } }
const testAi = new TestAi();
beforeAll(async () => { const db = await makeDb('memory'); await seed(db); payments = new MockVisaPayments();
  ctx = createApp({ db, payments, network: new MockNetwork(), ai: testAi, clock: makeClock(), demo: true, secret: 'api-test-secret-0123456789', secureCookie: false, publicOrigin: 'https://bouquet.example', storage: new FsStorage(path.join(os.tmpdir(), 'bq-test-' + Date.now())) }); app = ctx.app; });

const agent = () => request.agent(app);
async function signup(name: string) { const a = agent(); const r = await a.post('/api/auth/signup').send({ email: `${name}${Math.random()}@x.io`, password: 'password1', name }); expect(r.status).toBe(201); return a; }
const days = (n: number) => new Date(Date.now() + n * 864e5).toISOString();
async function answerAll(a: any, bid: string, pick: number) {
  const qs = (await a.get(`/api/bouquets/${bid}/questions`)).body.questions;
  return a.post(`/api/bouquets/${bid}/cards`).send({ answers: Object.fromEntries(qs.map((q: any) => [q.id, pick >= 0 ? pick : Math.max(0, QUESTIONS.find(x => x.id === q.id)!.options.findIndex(o => ['Sunrise Hiker','Coffee Snob'].includes(o.trait!)))])), story: 'We hiked at dawn' });
}
async function setup(n = 3, budget = 10000) {
  const org = await signup('Org');
  const b = (await org.post('/api/bouquets').send({ recipientName: 'Maya', occasion: 'Birthday', neededBy: days(10), shipBufferDays: 3 })).body.bouquet;
  const friends = [];
  for (let i = 0; i < n; i++) { const f = await signup('F' + i);
    const j = await f.post(`/api/join/${b.inviteToken}`).send({ displayName: 'Friend' + i, phone: '+1206555010' + i, budgetMaxCents: budget }); expect(j.status).toBe(200); friends.push(f); }
  return { org, b, friends };
}

describe('auth', () => {
  it('signup, me, logout, login, wrong password', async () => {
    const a = agent(); const email = `u${Math.random()}@x.io`;
    expect((await a.post('/api/auth/signup').send({ email, password: 'short', name: 'U' })).status).toBe(400);
    expect((await a.post('/api/auth/signup').send({ email, password: 'longenough', name: 'U' })).status).toBe(201);
    expect((await a.post('/api/auth/signup').send({ email, password: 'longenough', name: 'U' })).status).toBe(409);
    expect((await a.get('/api/auth/me')).body.user.email).toBe(email);
    await a.post('/api/auth/logout'); expect((await a.get('/api/auth/me')).status).toBe(401);
    expect((await a.post('/api/auth/login').send({ email, password: 'nope' })).status).toBe(401);
    const ok = await a.post('/api/auth/login').send({ email, password: 'longenough' }); expect(ok.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('authorization', 'Bearer ' + ok.body.token)).status).toBe(200);
  });
  it('seeded demo account logs in', async () => expect((await agent().post('/api/auth/login').send({ email: 'demo@bouquet.gift', password: 'bouquet123' })).status).toBe(200));
});

describe('bouquet lifecycle', () => {
  it('computes buy-by from shipping buffer and rejects past deadlines', async () => {
    const org = await signup('O');
    expect((await org.post('/api/bouquets').send({ recipientName: 'X', occasion: 'Y', neededBy: days(2), shipBufferDays: 3 })).status).toBe(400);
    const r = await org.post('/api/bouquets').send({ recipientName: 'X', occasion: 'Y', neededBy: days(10), shipBufferDays: 3 });
    expect(Math.round((new Date(r.body.bouquet.buyByAt).getTime() - Date.now()) / 864e5)).toBe(7);
  });
  it('join verifies phone via network; non-members are blocked', async () => {
    const { b } = await setup(0); const f = await signup('Bad');
    expect((await f.post(`/api/join/${b.inviteToken}`).send({ displayName: 'B', phone: '+12065550000', budgetMaxCents: 1000 })).status).toBe(422);
    expect((await f.get(`/api/bouquets/${b.id}`)).status).toBe(403);
    expect((await request(app).get(`/api/invite/${b.inviteToken}`)).body.recipientName).toBe('Maya');
  });
  it('full happy path: cards → fuse (rare consensus) → vote → fund → capture at highest tier → reveal', async () => {
    const { org, b, friends } = await setup(3, 10000);
    expect((await org.post(`/api/bouquets/${b.id}/fuse`)).status).toBe(409); // not enough cards
    for (const f of friends) expect((await answerAll(f, b.id, -1)).status).toBe(201);
    expect((await answerAll(friends[0], b.id, 0)).status).toBe(409);
    const minted = (await org.get(`/api/bouquets/${b.id}`)).body.cards; // same answers, yet every friend's card has its own title
    expect(new Set(minted.map((c: any) => c.title)).size).toBe(3);
    for (const c of minted) expect(c.traits.some((t: string) => c.title.includes(t))).toBe(true);
    expect((await friends[0].post(`/api/bouquets/${b.id}/fuse`)).status).toBe(403);
    const fused = (await org.post(`/api/bouquets/${b.id}/fuse`)).body;
    expect(fused.bouquet.status).toBe('fusing');
    const kit = fused.candidates.find((c: any) => c.rare); expect(kit).toBeTruthy(); expect(kit.citedFriends.length).toBeGreaterThanOrEqual(2);
    for (const f of friends) await f.post(`/api/bouquets/${b.id}/vote`).send({ candidateId: kit.id });
    const ch = (await org.post(`/api/bouquets/${b.id}/choose`)).body; expect(ch.bouquet.chosenCandidateId).toBe(kit.id); expect(ch.tiers).toHaveLength(3);
    const t = ch.tiers.map((x: any) => x.thresholdCents);
    // budgets enforced
    expect((await friends[0].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 10001, cardToken: TOK, last4: '4242', idempotencyKey: 'k-over-000' })).status).toBe(400);
    expect((await friends[0].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 1000, cardToken: 'tok_decline_test_0002', last4: '0002', idempotencyKey: 'k-decl-000' })).status).toBe(402);
    expect((await org.post(`/api/bouquets/${b.id}/lock`)).status).toBe(409); // not funded
    const amounts = [5000, 4000, 4500]; // 13500 → tier 2 (12000)
    for (const [i, f] of friends.entries()) expect((await f.post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: amounts[i], cardToken: TOK, last4: '4242', idempotencyKey: `k-${b.id}-${i}` })).status).toBe(201);
    // idempotent retry does not double-count
    const re = await friends[0].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 5000, cardToken: TOK, last4: '4242', idempotencyKey: `k-${b.id}-0` });
    expect(re.body.totals.fundedCents).toBe(13500); const exp = [...ch.tiers].reverse().find((x: any) => x.thresholdCents <= 13500); expect(re.body.totals.currentTier).toBe(exp.id);
    const [l1, l2] = await Promise.all([org.post(`/api/bouquets/${b.id}/lock`), org.post(`/api/bouquets/${b.id}/lock`)]); // concurrent checkout
    expect(l1.status).toBe(200); expect(l2.status).toBe(200);
    expect(l1.body.bouquet.status).toBe('purchased'); expect(l1.body.totals.capturedCents).toBe(exp.thresholdCents); void t;
    const mine = (await friends[0].get(`/api/bouquets/${b.id}`)).body.me.contributions;
    expect(mine[0].status).toBe('captured'); expect(mine[0].captured_cents).toBeLessThan(5000);
    const tokn = l1.body.bouquet.revealToken; expect(tokn).toBeTruthy();
    expect((await friends[0].get(`/api/bouquets/${b.id}`)).body.bouquet.revealToken).toBeNull();
    const rv = (await request(app).get(`/api/reveal/${tokn}`)).body;
    expect(rv.cards).toHaveLength(3); expect(rv.gift.includes).toHaveLength(exp.level); expect(rv.totalCards).toBe(4);
    // narrator: one line per card + the gift; no TTS → 404 so the browser speaks it; with TTS → generated once, then cached
    expect(rv.narration).toHaveLength(4); expect(rv.narration[0]).toMatch(/^From Friend0\. /); expect(rv.narration[3]).toContain(rv.gift.title);
    const off = await request(app).get(`/api/reveal/${tokn}/voice/0`); expect(off.status).toBe(404); expect(off.body.fallback).toBe('browser');
    testAi.voiceOn = true;
    const v1 = await request(app).get(`/api/reveal/${tokn}/voice/1`); expect(v1.status).toBe(200); expect(v1.headers['content-type']).toContain('audio/wav'); expect(v1.headers['x-narration']).toBe('generated');
    const v2 = await request(app).get(`/api/reveal/${tokn}/voice/1`); expect(v2.headers['x-narration']).toBe('cache-hit');
    expect(testAi.spoken).toEqual([rv.narration[1]]);
    expect((await request(app).get(`/api/reveal/${tokn}/voice/9`)).status).toBe(404);
    expect((await request(app).get(`/api/reveal/nope/voice/0`)).status).toBe(404);
    testAi.voiceOn = false;
    const last = (await request(app).post(`/api/reveal/${tokn}/flip`).send({ index: 3 })).body; expect(last.status).toBe('revealed');
  });
  it('checkout preview says exactly what checkout will charge each friend and release', async () => {
    const { org, b, friends } = await setup(3, 50000);
    for (const f of friends) expect((await answerAll(f, b.id, -1)).status).toBe(201);
    const fused = (await org.post(`/api/bouquets/${b.id}/fuse`)).body; const pick = fused.candidates[0];
    for (const f of friends) await f.post(`/api/bouquets/${b.id}/vote`).send({ candidateId: pick.id });
    const ch = (await org.post(`/api/bouquets/${b.id}/choose`)).body; expect(ch.totals.checkout).toBeNull(); // nothing funded yet
    const top = ch.tiers[ch.tiers.length - 1].thresholdCents; const amounts = [Math.ceil(top / 2), Math.ceil(top / 3), Math.ceil(top / 3)]; // over the top tier
    for (const [i, f] of friends.entries()) { const r = await f.post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: amounts[i], cardToken: TOK, last4: '4242', idempotencyKey: `pv-${b.id}-${i}` }); expect(r.body.error ?? r.status).toBe(201); }
    const held = amounts.reduce((a, x) => a + x, 0); const views = await Promise.all(friends.map(f => f.get(`/api/bouquets/${b.id}`).then((r: any) => r.body)));
    for (const v of views) { expect(v.totals.checkout).toMatchObject({ chargeCents: top, releaseCents: held - top, holders: 3, tierLevel: ch.tiers.length }); }
    expect(views.reduce((a, v) => a + v.totals.checkout.myChargeCents, 0)).toBe(top); // shares add up to exactly the top tier
    views.forEach((v, i) => { expect(v.totals.checkout.myHeldCents).toBe(amounts[i]); expect(v.totals.checkout.myChargeCents).toBeLessThanOrEqual(amounts[i]); });
    expect(views[0].members.every((m: any) => !('budgetMinCents' in m))).toBe(true);
    for (const v of views) for (const m of v.members) { // no friend's amount or cap ever reaches another friend's browser
      expect(m).not.toHaveProperty('pledgedCents'); expect(m).not.toHaveProperty('budgetMaxCents'); expect(m).not.toHaveProperty('budgetMinCents'); expect(typeof m.holding).toBe('boolean'); }
    expect((await org.post(`/api/bouquets/${b.id}/lock`)).status).toBe(200);
    for (const [i, f] of friends.entries()) { const me = (await f.get(`/api/bouquets/${b.id}`)).body;
      expect(me.me.contributions.reduce((a: number, c: any) => a + (c.captured_cents ?? 0), 0)).toBe(views[i].totals.checkout.myChargeCents); expect(me.totals.checkout).toBeNull(); }
  });
  it('landing sample gift is a real recipe with real catalog products', async () => {
    const g = (await request(app).get('/api/catalog/featured')).body.gift;
    expect(g.products.length).toBeGreaterThanOrEqual(3); expect(g.tiers).toHaveLength(g.products.length);
    for (const p of g.products) { expect(p.url).toMatch(/^https:\/\/[a-z.-]+\/products\//); const img = await request(app).get(p.photoUrl); expect(img.status).toBe(200); expect(img.headers['content-type']).toMatch(/^image\//); }
  });
  it('deadline sweep releases every hold and expires the bouquet (and races with lock safely)', async () => {
    const { org, b, friends } = await setup(2, 20000);
    for (const f of friends) await answerAll(f, b.id, 1);
    await org.post(`/api/bouquets/${b.id}/fuse`); await org.post(`/api/bouquets/${b.id}/choose`);
    await friends[0].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 1500, cardToken: TOK, last4: '4242', idempotencyKey: `d-${b.id}` });
    ctx.clock.offsetMs = 8 * 864e5;
    const [, lk] = await Promise.all([ctx.sweep(), org.post(`/api/bouquets/${b.id}/lock`)]);
    expect(lk.status).toBe(409);
    const s = (await friends[0].get(`/api/bouquets/${b.id}`)).body;
    expect(s.bouquet.status).toBe('expired'); expect(s.totals.heldCents).toBe(0); expect(s.me.contributions[0].status).toBe('released');
    ctx.clock.offsetMs = 0;
  });
  it('SIM swap blocks large holds', async () => {
    const { org, b, friends } = await setup(2);
    const sw = await signup('Swap'); await sw.post(`/api/join/${b.inviteToken}`).send({ displayName: 'S', phone: '+12065559999', budgetMaxCents: 9000 });
    for (const f of friends) await answerAll(f, b.id, 2);
    await org.post(`/api/bouquets/${b.id}/fuse`); await org.post(`/api/bouquets/${b.id}/choose`);
    expect((await sw.post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 6000, cardToken: TOK, last4: '4242', idempotencyKey: `s-${b.id}` })).status).toBe(423);
    expect((await sw.post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 2000, cardToken: TOK, last4: '4242', idempotencyKey: `s2-${b.id}` })).status).toBe(201);
  });
  it('question draw is seeded per member', () => expect(drawQuestions('x')).toEqual(drawQuestions('x')));
});
describe('deck picks + hand fusion', () => {
  it('keep/discard is idempotent per member+card, undo removes it, counts are live, fuse-hand votes', async () => {
    const { org, b, friends } = await setup(3, 10000);
    for (const f of friends) await answerAll(f, b.id, -1);
    const s = (await org.post(`/api/bouquets/${b.id}/fuse`)).body;
    const [t1, t2] = s.traits; expect(t1.rarity).not.toBe('common'); expect(t1.friends.length).toBeGreaterThan(0);
    expect((await friends[0].post(`/api/bouquets/${b.id}/fuse-hand`).send({ traitIds: [t1.id, t2.id] })).status).toBe(409); // not kept yet
    for (let i = 0; i < 2; i++) await friends[0].post(`/api/bouquets/${b.id}/picks`).send({ traitId: t1.id, keep: true });
    let st = (await friends[1].post(`/api/bouquets/${b.id}/picks`).send({ traitId: t1.id, keep: true })).body;
    expect(st.traits.find((x: any) => x.id === t1.id).keptCount).toBe(2);
    st = (await friends[1].post(`/api/bouquets/${b.id}/picks`).send({ traitId: t1.id, keep: false })).body;
    const tt = st.traits.find((x: any) => x.id === t1.id); expect(tt.keptCount).toBe(1); expect(tt.discardCount).toBe(1); expect(tt.myPick).toBe('discard');
    st = (await friends[1].delete(`/api/bouquets/${b.id}/picks/${t1.id}`)).body; expect(st.traits.find((x: any) => x.id === t1.id).myPick).toBeNull();
    await friends[0].post(`/api/bouquets/${b.id}/picks`).send({ traitId: t2.id, keep: true });
    const fz = await friends[0].post(`/api/bouquets/${b.id}/fuse-hand`).send({ traitIds: [t1.id, t2.id] });
    expect(fz.status).toBe(201); const cand = fz.body.candidates.find((c: any) => c.id === fz.body.fusedCandidateId);
    expect(cand.votes).toBe(1); expect(fz.body.me.vote).toBe(cand.id);
    const again = await friends[0].post(`/api/bouquets/${b.id}/fuse-hand`).send({ traitIds: [t2.id, t1.id] });
    expect(again.body.fusedCandidateId).toBe(cand.id); expect(again.body.candidates.length).toBe(fz.body.candidates.length);
    const ch = (await org.post(`/api/bouquets/${b.id}/choose`)).body; expect(ch.bouquet.status).toBe('funding'); expect(ch.tiers.length).toBe(3);
  });
  it('a gift fused from the hand never repeats a photo already on the gift table', async () => {
    const { org, b, friends } = await setup(3, 10000);
    for (const [i, f] of friends.entries()) await answerAll(f, b.id, i - 1);
    const s = (await org.post(`/api/bouquets/${b.id}/fuse`)).body;
    // the collision case: two traits (not a named recipe) whose hero photos are BOTH already covers on the table
    const covers = new Set(s.candidates.map((c: any) => c.product.url)); const labels = s.traits.map((t: any) => t.label) as string[];
    const hot = labels.filter(l => covers.has(traitProducts(l)[0]?.url)); const recipe = (a: string, b: string) => RECIPES.some(r => r.traits.includes(a) && r.traits.includes(b));
    const onTable = (a: string, b: string) => s.candidates.some((c: any) => c.traits.length === 2 && c.traits.includes(a) && c.traits.includes(b));
    const pair = hot.flatMap((a, i) => hot.slice(i + 1).map(b => [a, b])).find(([a, b]) => !recipe(a, b) && !onTable(a, b));
    const pick = pair ?? labels.slice(0, 2);
    const ids = pick.map(l => s.traits.find((t: any) => t.label === l).id);
    for (const tid of ids) await friends[0].post(`/api/bouquets/${b.id}/picks`).send({ traitId: tid, keep: true });
    const fz = await friends[0].post(`/api/bouquets/${b.id}/fuse-hand`).send({ traitIds: ids });
    if (fz.status === 409) return; // a rare recipe without consensus is correctly refused; nothing new on the table
    expect(fz.status).toBe(201);
    const photos = fz.body.candidates.map((c: any) => c.product?.photoUrl); expect(photos.every(Boolean)).toBe(true);
    expect(new Set(photos).size).toBe(photos.length);
    const fused = fz.body.candidates.find((c: any) => c.id === fz.body.fusedCandidateId);
    expect(fused.products.map((p: any) => p.url)).toContain(fused.product.url); // the cover is one of the gift's own products
  });
});

describe('guest join, lazy account, organizer-only invite, art, compliments, sim swap', () => {
  it('guest joins with name+phone only and can hold before saving an account', async () => {
    const { org, b } = await setup(0);
    const st = (await org.get(`/api/bouquets/${b.id}`)).body; expect(st.bouquet.inviteUrl).toBe(`https://bouquet.example/join/${b.inviteToken}`);
    const g = agent(); const j = await g.post(`/api/join/${b.inviteToken}`).send({ displayName: 'Guesty', phone: '+12065550123' });
    expect(j.status).toBe(200); expect(j.body.me.isGuest).toBe(true); expect(j.body.bouquet.inviteToken).toBeNull(); expect(j.body.bouquet.inviteUrl).toBeNull();
    expect((await g.get('/api/auth/me')).body.user.isGuest).toBe(true);
    const f2 = await signup('Real'); await f2.post(`/api/join/${b.inviteToken}`).send({ displayName: 'Real', phone: '+12065550124' });
    await answerAll(g, b.id, 0); const fz = await answerAll(f2, b.id, 1);
    const card = fz.body.cards[0]; expect(card.artUrl).toMatch(/^\/api\/media\/cards\/.+\.svg$/);
    const art = await request(app).get(card.artUrl); expect(art.status).toBe(200); expect(art.headers['content-type']).toContain('svg');
    expect(card.title).toContain(card.traits[0]); expect(card.stats[0].label).toBe(card.traits[0]);
    const fused = (await org.post(`/api/bouquets/${b.id}/fuse`)).body; expect(fused.candidates.length).toBeGreaterThanOrEqual(3);
    expect(fused.candidates.some((c: any) => c.kind === 'safe')).toBe(true); expect(fused.candidates[0].citedCardIds.length).toBeGreaterThan(0);
    await org.post(`/api/bouquets/${b.id}/choose`);
    // no signup wall before the hold: a guest can chip in, and saving an account afterwards is optional
    expect((await g.post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 1000, cardToken: TOK, last4: '4242', idempotencyKey: 'guest-key-1' })).status).toBe(201);
    expect((await g.post('/api/auth/claim').send({ email: `guesty${Math.random()}@x.io`, password: 'password1' })).status).toBe(200);
    expect((await g.post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 1000, cardToken: TOK, last4: '4242', idempotencyKey: 'guest-key-1' })).status).toBe(200); // idempotent replay
    // demo SIM swap blocks big holds for that friend
    await g.patch(`/api/bouquets/${b.id}/budget`).send({ budgetMinCents: 0, budgetMaxCents: 20000 });
    expect((await g.post('/api/dev/simswap').send({ bouquetId: b.id })).status).toBe(200);
    // demo shortcuts: no server-wide clock; moving a deadline is the organizer's alone, resetting the demo is the demo organizer's alone
    expect((await request(app).post('/api/dev/clock').send({ offsetMs: 1000, bouquetId: b.id })).status).toBe(404);
    expect((await request(app).post('/api/dev/deadline').send({ bouquetId: b.id })).status).toBe(401);
    expect((await g.post('/api/dev/deadline').send({ bouquetId: b.id })).status).toBe(403);
    expect((await g.post('/api/dev/sweep').send({ bouquetId: b.id })).status).toBe(403);
    expect((await g.post('/api/dev/reset-demo').send({})).status).toBe(403);
    expect((await request(app).post('/api/dev/sweep')).status).toBe(401);
    expect((await org.get(`/api/bouquets/${b.id}`)).body.bouquet.status).toBe('funding');
    const blocked = await g.post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 6000, cardToken: TOK, last4: '4242', idempotencyKey: 'guest-key-2' });
    expect(blocked.status).toBe(423); expect(blocked.body.error).toMatch(/SIM/);
    await g.post('/api/dev/simswap').send({ bouquetId: b.id, on: false });
    // tier 1 is now a real product, so fund whatever it actually costs (guest already holds $10)
    const tier1 = Math.min(...(await org.get(`/api/bouquets/${b.id}`)).body.tiers.map((t: any) => t.thresholdCents));
    expect((await f2.post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: Math.max(5000, tier1 - 1000), cardToken: TOK, last4: '4242', idempotencyKey: 'real-key-1' })).status).toBe(201);
    const l = (await org.post(`/api/bouquets/${b.id}/lock`)).body;
    const rv = (await request(app).get(`/api/reveal/${l.bouquet.revealToken}`)).body;
    expect(rv.cards[0].compliments[0]).toMatch(/^You/); expect(rv.gift.compliments.length).toBeGreaterThan(0);
  });
  it('anti-gift answers are stored and filter fusion', async () => {
    const { org, b, friends } = await setup(2);
    for (const f of friends) { const qs = (await f.get(`/api/bouquets/${b.id}/questions`)).body.questions;
      await f.post(`/api/bouquets/${b.id}/cards`).send({ answers: Object.fromEntries(qs.map((q: any) => [q.id, q.id === 's4' ? 0 : Math.max(0, QUESTIONS.find(x => x.id === q.id)!.options.findIndex(o => ['Bookworm', 'Coffee Snob'].includes(o.trait!)))])) }); }
    const fz = (await org.post(`/api/bouquets/${b.id}/fuse`)).body;
    expect(fz.candidates.some((c: any) => c.title === 'Reading Nook Ritual')).toBe(false); expect(fz.candidates.length).toBeGreaterThanOrEqual(3);
  });
});
describe('Cloudflare Turnstile', () => {
  it('join/hold/reveal require a valid token when configured', async () => {
    const db = await makeDb('memory'); await seed(db);
    const t = createApp({ db, payments: new MockVisaPayments(), network: new MockNetwork(), ai: new MockAi(), secret: 't', storage: new FsStorage(path.join(os.tmpdir(), 'bq-ts')),
      turnstile: { siteKey: '1x00000000000000000000AA', verify: async (tok?: string) => tok === 'XXXX.DUMMY.TOKEN.XXXX' } }).app;
    expect((await request(t).get('/api/health')).body.turnstileSiteKey).toBe('1x00000000000000000000AA');
    const org = request.agent(t); await org.post('/api/auth/signup').send({ email: 'o@t.io', password: 'password1', name: 'O' });
    const b = (await org.post('/api/bouquets').send({ recipientName: 'M', occasion: 'B', neededBy: days(10) })).body.bouquet;
    const g = request.agent(t);
    expect((await g.post(`/api/join/${b.inviteToken}`).send({ displayName: 'G', phone: '+12065550111' })).status).toBe(403);
    expect((await g.post(`/api/join/${b.inviteToken}`).set('x-turnstile-token', 'XXXX.DUMMY.TOKEN.XXXX').send({ displayName: 'G', phone: '+12065550111' })).status).toBe(200);
  });
});
describe('demo seed', () => {
  it('internal seed token bypasses Turnstile only with the exact token', async () => {
    const db = await makeDb('memory'); await seed(db);
    const t = createApp({ db, payments: new MockVisaPayments(), network: new MockNetwork(), ai: new MockAi(), secret: 't', internalToken: 'abc123', storage: new FsStorage(path.join(os.tmpdir(), 'bq-seed')),
      turnstile: { siteKey: 'k', verify: async () => false } }).app;
    const org = request.agent(t); await org.post('/api/auth/login').send({ email: 'demo@bouquet.gift', password: 'bouquet123' });
    const b = (await org.post('/api/bouquets').send({ recipientName: 'M', occasion: 'B', neededBy: days(10) })).body.bouquet;
    const g = request.agent(t);
    expect((await g.post(`/api/join/${b.inviteToken}`).set('x-internal-seed', 'wrong').send({ displayName: 'G', phone: '+12065550111' })).status).toBe(403);
    expect((await g.post(`/api/join/${b.inviteToken}`).set('x-internal-seed', 'abc123').send({ displayName: 'G', phone: '+12065550111' })).status).toBe(200);
  });
});
describe('real-product catalog', () => {
  it('every recipe tier has a real product with store URL, price and a locally cached photo; thresholds follow prices', async () => {
    const { CATALOG, productsFor } = await import('../src/catalog.js'); const { RECIPES } = await import('../src/domain.js');
    expect(Object.keys(CATALOG.recipes).length).toBe(RECIPES.length);
    for (const r of RECIPES) { const ps = productsFor(r.title); expect(ps).toHaveLength(3);
      let sum = 0; ps.forEach((p, i) => { sum += p.priceCents; expect(p.url).toMatch(/^https:\/\/[a-z.-]+\/products\/[a-z0-9-]+$/); expect(p.priceCents).toBeGreaterThan(0);
        expect(r.tiers[i].title).toBe(p.tierTitle); expect(r.tiers[i].threshold_cents).toBe(Math.ceil(sum / 100) * 100); }); }
    const { org, b, friends } = await setup(3, 30000);
    for (const f of friends) await answerAll(f, b.id, -1);
    const fz = (await org.post(`/api/bouquets/${b.id}/fuse`)).body; const withP = fz.candidates.find((c: any) => c.product);
    expect(withP.product.photoUrl).toMatch(/^\/api\/media\/catalog\//);
    const img = await request(app).get(withP.product.photoUrl); expect(img.status).toBe(200); expect(img.headers['content-type']).toMatch(/image\//); expect(img.body.length).toBeGreaterThan(5000);
    await org.post(`/api/bouquets/${b.id}/choose`).send({ candidateId: withP.id });
    const st = (await org.get(`/api/bouquets/${b.id}`)).body; expect(st.tiers.every((t: any) => t.product?.url)).toBe(true);
    const dash = (await org.get('/api/bouquets')).body.bouquets.find((x: any) => x.id === b.id); expect(dash.photoUrl).toBe(withP.product.photoUrl);
  });
  it('every trait has 3 real USD products, so Treasure Boxes and Duo Boxes show real photos with price-based tiers', async () => {
    const fs = await import('node:fs'); const path = await import('node:path');
    const { CATALOG, traitProducts, productsFor } = await import('../src/catalog.js'); const D = await import('../src/domain.js');
    const traits = [...new Set(D.QUESTIONS.flatMap(q => q.options.map(o => o.trait)).filter(Boolean))] as string[];
    expect(CATALOG.currency).toBe('USD');
    for (const t of traits) { const ps = traitProducts(t); expect(ps, t).toHaveLength(3);
      for (const p of ps) { expect(p.url).toMatch(/^https:\/\/[a-z.-]+\/products\/[a-z0-9-]+$/); expect(p.priceCents).toBeGreaterThan(0); expect(p.imageSource).toMatch(/^https:\/\//);
        expect(fs.statSync(path.resolve('catalog/images', p.image)).size).toBeGreaterThan(5000); } }
    const recipeHeroes = new Set(Object.values(CATALOG.recipes).map(ps => ps[0].url)); // a Treasure Box never repeats a recipe's photo
    for (const t of traits) expect(recipeHeroes.has(traitProducts(t)[0].url), t).toBe(false);
    // duo = hero of each trait, then an add-on; tiers are the cumulative real prices
    const duo = productsFor('Bookshelf & Brunch Duo Box', ['Bookworm', 'Brunch Royalty']);
    expect(duo.map(p => p.url)).toEqual([traitProducts('Bookworm')[0].url, traitProducts('Brunch Royalty')[0].url, traitProducts('Bookworm')[1].url]);
    expect(duo[0].tierTitle.startsWith('+')).toBe(false); expect(duo[1].tierTitle.startsWith('+ ')).toBe(true);
    const agg = [{ label: 'Bookworm', memberIds: ['a', 'b'], cardIds: [] }, { label: 'Brunch Royalty', memberIds: ['a'], cardIds: [] }, { label: 'Sunrise Hiker', memberIds: ['b'], cardIds: [] }];
    for (const c of D.fuse(agg)) { const ps = productsFor(c.title, c.traits); expect(ps.length, c.title).toBe(3); let sum = 0;
      ps.forEach((p, i) => { sum += p.priceCents; expect(c.tiers[i].threshold_cents).toBe(Math.ceil(sum / 100) * 100); expect(c.tiers[i].title).toBe(p.tierTitle); }); }
    // over the API: every candidate on a 3-friend gift table has a real, served product photo
    const { org, b, friends } = await setup(3, 30000);
    for (const [i, f] of friends.entries()) await answerAll(f, b.id, i - 1);
    const fz = (await org.post(`/api/bouquets/${b.id}/fuse`)).body; expect(fz.candidates.length).toBeGreaterThanOrEqual(3);
    for (const c of fz.candidates) { expect(c.product?.photoUrl, c.title).toMatch(/^\/api\/media\/catalog\//); expect(c.product.url).toMatch(/\/products\//);
      const img = await request(app).get(c.product.photoUrl); expect(img.status).toBe(200); expect(img.headers['content-type']).toMatch(/image\//); }
    expect(new Set(fz.candidates.map((c: any) => c.product.photoUrl)).size).toBe(fz.candidates.length); // no photo shown twice on the table
    const generic = fz.candidates.find((c: any) => /Treasure Box|Duo Box/.test(c.title));
    if (generic) { await org.post(`/api/bouquets/${b.id}/choose`).send({ candidateId: generic.id });
      const st = (await org.get(`/api/bouquets/${b.id}`)).body; expect(st.tiers).toHaveLength(3); expect(st.tiers.every((t: any) => t.product?.url && (t.level === 1) !== t.title.startsWith('+ '))).toBe(true);
      expect(st.tiers[0].product.photoUrl).toBe(generic.product.photoUrl); }
  });
});
