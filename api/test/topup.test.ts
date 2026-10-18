import { describe, it, expect } from 'vitest';
import { MockAi } from '../src/adapters.js';
import { planTopUps } from '../src/bridge.js';
import { fundingBouquet } from './helpers.js';

const NOW = new Date('2026-10-17T20:00:00Z'); const VISA = '4242424242424242';
describe('top-up planner', () => {
  it('splits the gap across private headroom, whole dollars, never above a cap, and sums to at least the gap', () => {
    for (let k = 0; k < 200; k++) {
      const people = Array.from({ length: 1 + (k % 5) }, (_, i) => ({ id: 'p' + i, headroomCents: 100 + ((k * 7919 + i * 104729) % 9000), payday: null }));
      const gap = 1 + ((k * 31337) % 12000); const total = people.reduce((a, p) => a + p.headroomCents, 0);
      const plan = planTopUps(gap, people, NOW);
      if (total < gap) { expect(plan).toBeNull(); continue; }
      const asks = [...plan!.values()].map(a => a.cents); const sum = asks.reduce((a, x) => a + x, 0);
      expect(sum).toBeGreaterThanOrEqual(gap); expect(sum - gap).toBeLessThan(100); // sums to the gap, rounded up to a whole dollar at most once
      expect(asks.every(c => c % 100 === 0)).toBe(true);
      for (const [id, a] of plan!) { expect(a.cents).toBeLessThanOrEqual(people.find(p => p.id === id)!.headroomCents); expect(a.cents).toBeGreaterThanOrEqual(100); }
    }
  });
  it('never dumps the gap on one friend: shares follow remaining room, each within its cap', () => {
    const p = [{ id: 'jon', headroomCents: 1000, payday: null }, { id: 'priya', headroomCents: 4000, payday: null }, { id: 'sam', headroomCents: 5000, payday: null }];
    const plan = planTopUps(3000, p, NOW)!;
    expect([...plan.keys()].sort()).toEqual(['jon', 'priya', 'sam']);
    expect(plan.get('jon')!.cents).toBe(300); expect(plan.get('priya')!.cents).toBe(1200); expect(plan.get('sam')!.cents).toBe(1500);
    for (const x of p) expect(plan.get(x.id)!.cents).toBeLessThanOrEqual(x.headroomCents);
    expect(planTopUps(10001, p, NOW)).toBeNull(); // $100.01 > $100 of room in total: unreachable, nobody is asked
  });
  it('asks people who can pay now first, and schedules payday friends only when needed', () => {
    const p = [{ id: 'a', headroomCents: 1000, payday: null }, { id: 'b', headroomCents: 3000, payday: null }, { id: 'c', headroomCents: 2000, payday: '2026-10-23' }];
    const small = planTopUps(750, p, NOW)!; expect(small.has('c')).toBe(false); expect(small.get('a')).toEqual({ cents: 200, availableAt: null });
    const big = planTopUps(5000, p, NOW)!; expect(big.get('c')!.availableAt).toBe('2026-10-23');
    expect(planTopUps(5000, p, new Date('2026-10-23T01:00:00Z'))!.get('c')!.availableAt).toBeNull(); // payday arrived
    expect(planTopUps(9000, p, NOW)).toBeNull(); // unreachable: nobody is nagged
    const after = planTopUps(500, [{ ...p[0], alreadyAsked: true }, p[1]], NOW)!; expect(after.has('a')).toBe(false); expect(after.get('b')!.cents).toBe(500); // no double-asking
  });
});

describe('GET /topup + one-tap accept', { timeout: 30000 }, () => {
  it('each friend sees only their own ask; one tap re-uses the saved Visa token and moves the group to the next tier', async () => {
    const { org, friends, b, choose } = await fundingBouquet(new MockAi()); const ch = await choose();
    const [t1, t2] = ch.tiers.map((t: any) => t.thresholdCents);
    for (const [i, f] of friends.entries()) await f.patch(`/api/bouquets/${b.id}/budget`).send({ budgetMinCents: 0, budgetMaxCents: t2 });
    expect((await friends[0].get(`/api/bouquets/${b.id}/topup`)).body.ask).toBeNull(); // no saved card yet → no one-tap ask
    const a0 = Math.ceil(t1 / 2), a1 = t1 - a0;
    await friends[0].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: a0, cardNumber: VISA, idempotencyKey: 'tu-0-' + b.id });
    await friends[1].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: a1, cardNumber: VISA, idempotencyKey: 'tu-1-' + b.id });
    const r0 = (await friends[0].get(`/api/bouquets/${b.id}/topup`)).body, r1 = (await friends[1].get(`/api/bouquets/${b.id}/topup`)).body;
    expect(r0.ask.cents + r1.ask.cents).toBeGreaterThanOrEqual(t2 - t1); expect(r0.ask.tierPriceCents).toBe(t2); expect(r0.ask.last4).toBe('4242');
    expect(Object.keys(r0.ask).sort()).toEqual(['availableAt', 'cents', 'friends', 'last4', 'message', 'tierPriceCents', 'tierTitle']); // only my own ask: no one else's amount, cap or id
    expect(r0.ask.message).toContain(`Top up $`); expect(r0.source).toBe('rules');
    expect((await org.get(`/api/bouquets/${b.id}/topup`)).body.ask).toBeNull(); // organizer never held: not asked
    // stale amount is refused, then the right one goes through with no card number (token)
    expect((await friends[0].post(`/api/bouquets/${b.id}/topup/accept`).send({ cents: r0.ask.cents + 100, idempotencyKey: 'acc-x-' + b.id })).status).toBe(409);
    // the one-tap top-up re-uses a saved card, so the carrier SIM Swap check runs first whatever the amount
    await friends[0].post('/api/dev/simswap').send({ bouquetId: b.id });
    const blocked = await friends[0].post(`/api/bouquets/${b.id}/topup/accept`).send({ cents: r0.ask.cents, idempotencyKey: 'acc-sw-' + b.id });
    expect(blocked.status).toBe(423); expect(blocked.body.error).toMatch(/SIM was changed/);
    await friends[0].post('/api/dev/simswap').send({ bouquetId: b.id, on: false });
    const ok0 = await friends[0].post(`/api/bouquets/${b.id}/topup/accept`).send({ cents: r0.ask.cents, idempotencyKey: 'acc-0-' + b.id }); expect(ok0.status).toBe(201);
    const again = await friends[0].post(`/api/bouquets/${b.id}/topup/accept`).send({ cents: r0.ask.cents, idempotencyKey: 'acc-0-' + b.id }); expect(again.status).toBe(200); // idempotent
    const r1b = (await friends[1].get(`/api/bouquets/${b.id}/topup`)).body; // recalculated after Jon's top-up
    expect((await friends[0].get(`/api/bouquets/${b.id}/topup`)).body.ask).toBeNull(); // Jon isn't asked twice
    expect(r1b.ask.cents).toBeGreaterThanOrEqual(t2 - t1 - r0.ask.cents); expect((await friends[1].post(`/api/bouquets/${b.id}/topup/accept`).send({ cents: r1b.ask.cents, idempotencyKey: 'acc-1-' + b.id })).status).toBe(201);
    const st = (await org.get(`/api/bouquets/${b.id}`)).body;
    expect(st.totals.heldCents).toBeGreaterThanOrEqual(t2); expect(st.tiers.find((t: any) => t.thresholdCents === t2).unlocked).toBe(true);
    for (const f of friends) { const me = (await f.get(`/api/bouquets/${b.id}`)).body.me; expect(me.contributions.reduce((x: number, c: any) => x + c.amount_cents, 0)).toBeLessThanOrEqual(t2); }
  });
  it('payday friends get a scheduled ask that opens on payday', async () => {
    const { friends, b, choose, ctx } = await fundingBouquet(new MockAi()); const ch = await choose();
    const [t1, t2] = ch.tiers.map((t: any) => t.thresholdCents);
    const payday = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
    await friends[0].patch(`/api/bouquets/${b.id}/budget`).send({ budgetMinCents: 0, budgetMaxCents: t2 + 5000, payday });
    await friends[0].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: t1, cardNumber: VISA, idempotencyKey: 'pd-' + b.id });
    const r = (await friends[0].get(`/api/bouquets/${b.id}/topup`)).body; expect(r.ask.availableAt).toBe(payday); expect(r.ask.message).toMatch(/On your payday/);
    expect((await friends[0].post(`/api/bouquets/${b.id}/topup/accept`).send({ cents: r.ask.cents, idempotencyKey: 'pd-a-' + b.id })).status).toBe(409);
    ctx.clock.offsetMs = 3 * 864e5 + 3600e3; // payday arrives
    const r2 = (await friends[0].get(`/api/bouquets/${b.id}/topup`)).body; expect(r2.ask.availableAt).toBeNull();
    expect((await friends[0].post(`/api/bouquets/${b.id}/topup/accept`).send({ cents: r2.ask.cents, idempotencyKey: 'pd-b-' + b.id })).status).toBe(201);
    ctx.clock.offsetMs = 0;
  });
});

describe("top-up 'I'm done'", { timeout: 30000 }, () => {
  it('stops my asks and re-splits the gap across the others', async () => {
    const { friends, b, choose } = await fundingBouquet(new MockAi()); const ch = await choose();
    const [t1, t2] = ch.tiers.map((t: any) => t.thresholdCents);
    for (const f of friends) await f.patch(`/api/bouquets/${b.id}/budget`).send({ budgetMinCents: 0, budgetMaxCents: t2 });
    const a0 = Math.ceil(t1 / 2), a1 = t1 - a0;
    await friends[0].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: a0, cardNumber: VISA, idempotencyKey: 'dn-0-' + b.id });
    await friends[1].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: a1, cardNumber: VISA, idempotencyKey: 'dn-1-' + b.id });
    expect((await friends[0].get(`/api/bouquets/${b.id}/topup`)).body.ask).not.toBeNull();
    expect((await friends[0].post(`/api/bouquets/${b.id}/topup/done`)).status).toBe(200);
    expect((await friends[0].get(`/api/bouquets/${b.id}/topup`)).body.ask).toBeNull();
    const r1 = (await friends[1].get(`/api/bouquets/${b.id}/topup`)).body;
    expect(r1.ask.cents).toBeGreaterThanOrEqual(t2 - t1); expect(r1.ask.friends).toBe(1); // the whole gap now sits with the one friend still in
  });
});
