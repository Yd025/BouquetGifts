import { describe, it, expect } from 'vitest';
import { MockAi } from '../src/adapters.js';
import { fundingBouquet } from './helpers.js';
const VISA = '4242424242424242';

describe('one money source per person', { timeout: 60000 }, () => {
  it('after buying: charged + back = held for everyone, the charges add up to the funded price, and the receipt matches the room', async () => {
    const { org, friends, b, choose } = await fundingBouquet(new MockAi()); const ch = await choose();
    const people = [org, ...friends]; const amounts = [3000, 5000, 7000];
    for (const [i, p] of people.entries()) expect((await p.post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: amounts[i], cardNumber: VISA, idempotencyKey: `m-${i}-${b.id}` })).status).toBe(201);
    expect((await org.post(`/api/bouquets/${b.id}/lock`)).status).toBe(200);
    let charged = 0;
    for (const [i, p] of people.entries()) {
      const st = (await p.get(`/api/bouquets/${b.id}`)).body; const r = st.me.receipt;
      expect(r.heldCents).toBe(amounts[i]); expect(r.chargedCents + r.backCents).toBe(r.heldCents); expect(r.chargedCents).toBeLessThanOrEqual(r.heldCents);
      const ex = (await p.get(`/api/bouquets/${b.id}/explain`)).body.receipt;
      expect(ex.chargedCents).toBe(r.chargedCents); expect(ex.releasedCents).toBe(r.backCents); // the receipt and the room say the same thing
      charged += r.chargedCents;
    }
    const st = (await org.get(`/api/bouquets/${b.id}`)).body;
    const tier = st.tiers.find((t: any) => t.id === st.bouquet.capturedTierId);
    expect(charged).toBe(st.bouquet.capturedCents); expect(charged).toBe(tier.thresholdCents);
    void ch;
  });
  it('with only two people holding, nobody sees an exact share before buying, only "at most your hold"', async () => {
    const { friends, b, choose } = await fundingBouquet(new MockAi()); const ch = await choose(); const price = ch.tiers[0].thresholdCents;
    const a = Math.ceil(price / 2) + 500, c = Math.ceil(price / 2) + 1500;
    expect((await friends[0].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: a, cardNumber: VISA, idempotencyKey: `t0-${b.id}` })).status).toBe(201);
    expect((await friends[1].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: c, cardNumber: VISA, idempotencyKey: `t1-${b.id}` })).status).toBe(201);
    for (const [f, held] of [[friends[0], a], [friends[1], c]] as const) {
      const co = (await f.get(`/api/bouquets/${b.id}`)).body.totals.checkout;
      expect(co.atMost).toBe(true); expect(co.myChargeCents).toBe(held); expect(co.myHeldCents).toBe(held);
      const ex = (await f.get(`/api/bouquets/${b.id}/explain`)).body;
      expect(ex.receipt.mode).toBe('atmost'); expect(ex.receipt.chargedCents).toBe(held); expect(ex.rules).toContain('at most');
    }
  });
});
