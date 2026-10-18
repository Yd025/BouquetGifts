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

describe('paying the store', { timeout: 60000 }, () => {
  it('issues single-use virtual cards that add up to exactly the charged total, records them in the ledger, and only once', async () => {
    const { ctx, org, friends, b, choose } = await fundingBouquet(new MockAi()); await choose();
    for (const [i, p] of [org, ...friends].entries()) expect((await p.post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: [4000, 6000, 6000][i], cardNumber: VISA, idempotencyKey: `v-${i}-${b.id}` })).status).toBe(201);
    const st = (await org.post(`/api/bouquets/${b.id}/lock`)).body;
    const cards = st.bouquet.vcards; expect(cards.length).toBeGreaterThan(0);
    expect(cards.reduce((a: number, c: any) => a + c.amountCents, 0)).toBe(st.bouquet.capturedCents);
    for (const c of cards) { expect(c.last4).toMatch(/^\d{4}$/); expect(c.merchant).toBeTruthy(); expect(c.orderRef).toMatch(/^BQ-/); expect(c.cardId).toBeUndefined(); }
    await org.post(`/api/bouquets/${b.id}/lock`); // a repeat checkout does not issue another card
    const led = await ctx.db.query(`SELECT * FROM ledger_events WHERE bouquet_id=$1 AND type='vcard'`, [b.id]);
    expect(led.length).toBe(cards.length); expect(led.reduce((a: number, e: any) => a + e.amount_cents, 0)).toBe(st.bouquet.capturedCents);
  });
});
