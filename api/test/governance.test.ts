import { describe, it, expect } from 'vitest';
import { MockAi } from '../src/adapters.js';
import { fundingBouquet } from './helpers.js';

const TOK = 'tok_test_visa_4242';
describe("the organizer can't decide alone", { timeout: 30000 }, () => {
  it('cannot choose a gift with fewer votes than the top pick; can break a tie', async () => {
    const { org, friends, b, fused } = await fundingBouquet(new MockAi());
    const [a, c] = fused.candidates;
    for (const f of friends) await f.post(`/api/bouquets/${b.id}/vote`).send({ candidateId: a.id });
    const r = await org.post(`/api/bouquets/${b.id}/choose`).send({ candidateId: c.id }); expect(r.status).toBe(409); expect(r.body.error).toMatch(/top pick has 2/);
    expect((await org.post(`/api/bouquets/${b.id}/choose`).send({ candidateId: a.id })).status).toBe(200);
  });
  it('cannot check out on their own hold alone before the deadline', async () => {
    const { org, friends, b, choose } = await fundingBouquet(new MockAi()); const ch = await choose(); const price = ch.tiers[0].thresholdCents;
    await org.patch(`/api/bouquets/${b.id}/budget`).send({ budgetMinCents: 0, budgetMaxCents: price });
    expect((await org.post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: price, cardToken: TOK, last4: '4242', idempotencyKey: 'g-o-' + b.id })).status).toBe(201);
    const r = await org.post(`/api/bouquets/${b.id}/lock`); expect(r.status).toBe(409); expect(r.body.error).toMatch(/at least one friend/);
    expect((await friends[0].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 500, cardToken: TOK, last4: '4242', idempotencyKey: 'g-f-' + b.id })).status).toBe(201);
    expect((await org.post(`/api/bouquets/${b.id}/lock`)).status).toBe(200);
  });
});
