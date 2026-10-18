import { describe, it, expect } from 'vitest';
import { MockAi } from '../src/adapters.js';
import { fundingBouquet } from './helpers.js';
const TOK = 'tok_test_visa_4242';

describe('one money source per person', { timeout: 60000 }, () => {
  it('after buying: charged + back = held for everyone, the charges add up to the funded price, and the receipt matches the room', async () => {
    const { org, friends, b, choose } = await fundingBouquet(new MockAi()); const ch = await choose();
    const people = [org, ...friends]; const amounts = [3000, 5000, 7000];
    for (const [i, p] of people.entries()) expect((await p.post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: amounts[i], cardToken: TOK, last4: '4242', idempotencyKey: `m-${i}-${b.id}` })).status).toBe(201);
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
    expect((await friends[0].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: a, cardToken: TOK, last4: '4242', idempotencyKey: `t0-${b.id}` })).status).toBe(201);
    expect((await friends[1].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: c, cardToken: TOK, last4: '4242', idempotencyKey: `t1-${b.id}` })).status).toBe(201);
    for (const [f, held] of [[friends[0], a], [friends[1], c]] as const) {
      const co = (await f.get(`/api/bouquets/${b.id}`)).body.totals.checkout;
      expect(co.atMost).toBe(true); expect(co.myChargeCents).toBeNull(); expect(co.myHeldCents).toBe(held);
      const ex = (await f.get(`/api/bouquets/${b.id}/explain`)).body;
      expect(ex.receipt.mode).toBe('atmost'); expect(ex.receipt.chargedCents).toBe(held); expect(ex.rules).toContain('at most');
    }
  });
});

describe('paying the store', { timeout: 60000 }, () => {
  it('issues single-use virtual cards that add up to exactly the charged total, records them in the ledger, and only once', async () => {
    const { ctx, org, friends, b, choose } = await fundingBouquet(new MockAi()); await choose();
    for (const [i, p] of [org, ...friends].entries()) expect((await p.post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: [4000, 6000, 6000][i], cardToken: TOK, last4: '4242', idempotencyKey: `v-${i}-${b.id}` })).status).toBe(201);
    const st = (await org.post(`/api/bouquets/${b.id}/lock`)).body;
    const cards = st.bouquet.vcards; expect(cards.length).toBeGreaterThan(0);
    expect(cards.reduce((a: number, c: any) => a + c.amountCents, 0)).toBe(st.bouquet.capturedCents);
    for (const c of cards) { expect(c.last4).toMatch(/^\d{4}$/); expect(c.merchant).toBeTruthy(); expect(c.orderRef).toMatch(/^BQ-/); expect(c.cardId).toBeUndefined(); }
    await org.post(`/api/bouquets/${b.id}/lock`); // a repeat checkout does not issue another card
    const led = await ctx.db.query(`SELECT * FROM ledger_events WHERE bouquet_id=$1 AND type='vcard'`, [b.id]);
    expect(led.length).toBe(cards.length); expect(led.reduce((a: number, e: any) => a + e.amount_cents, 0)).toBe(st.bouquet.capturedCents);
  });
});

describe('a capture that keeps failing', { timeout: 60000 }, () => {
  it('is retried by the sweep, then released instead of staying pending forever', async () => {
    const { MockVisaPayments } = await import('../src/adapters.js');
    class Broken extends MockVisaPayments { tries = 0; async capture() { this.tries++; throw new Error('processor down'); } }
    const visa = new Broken(); const { ctx, org, friends, b, choose } = await fundingBouquet(new MockAi(), { payments: visa }); await choose();
    for (const [i, p] of [org, ...friends].entries()) expect((await p.post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: [4000, 6000, 6000][i], cardToken: TOK, last4: '4242', idempotencyKey: `x-${i}-${b.id}` })).status).toBe(201);
    expect((await org.post(`/api/bouquets/${b.id}/lock`)).status).toBe(200);
    expect((await friends[0].get(`/api/bouquets/${b.id}`)).body.me.contributions.some((c: any) => c.status === 'capture_pending')).toBe(true);
    await ctx.sweep(); await ctx.sweep();
    const me = (await friends[0].get(`/api/bouquets/${b.id}`)).body.me;
    expect(me.contributions.every((c: any) => c.status === 'released' || c.status === 'captured')).toBe(true);
    expect(me.receipt.chargedCents + me.receipt.backCents).toBe(me.receipt.heldCents);
    expect(visa.tries).toBeGreaterThanOrEqual(3);
  });
});

describe('holds older than six days', { timeout: 60000 }, () => {
  it('are re-authorized once by the sweep and logged, without changing anyone’s money', async () => {
    const { ctx, friends, b, choose } = await fundingBouquet(new MockAi()); await choose();
    expect((await friends[0].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 2000, cardToken: TOK, last4: '4242', idempotencyKey: `ra-${b.id}` })).status).toBe(201);
    await ctx.sweep(); expect((await ctx.db.query(`SELECT * FROM ledger_events WHERE type='reauth'`)).length).toBe(0);
    ctx.clock.offsetMs = 6 * 864e5 + 3600e3; await ctx.sweep(); await ctx.sweep();
    const ev = await ctx.db.query(`SELECT * FROM ledger_events WHERE type='reauth' AND bouquet_id=$1`, [b.id]); expect(ev.length).toBe(1); expect(ev[0].amount_cents).toBe(2000);
    const me = (await friends[0].get(`/api/bouquets/${b.id}`)).body.me; expect(me.receipt.heldCents).toBe(2000); expect(me.contributions[0].status).toBe('held');
    ctx.clock.offsetMs = 0;
  });
});

describe('seeded demo', { timeout: 60000 }, () => {
  it('the organizer of the seeded demo gift chips in $40 when the gift is picked, so Bought shows their own receipt', async () => {
    const { ctx, org, b, choose } = await fundingBouquet(new MockAi());
    await ctx.db.query('UPDATE bouquets SET is_demo=true WHERE id=$1', [b.id]); await ctx.db.query('UPDATE members SET budget_max_cents=8000 WHERE bouquet_id=$1 AND user_id=(SELECT organizer_id FROM bouquets WHERE id=$1)', [b.id]);
    await choose();
    const me = (await org.get(`/api/bouquets/${b.id}`)).body.me; expect(me.receipt.heldCents).toBe(4000);
  });
});

describe('a renewal the card declines', { timeout: 60000 }, () => {
  it('releases that hold (ledger release), tells the friend, drops the funded total, and the hold is never captured', async () => {
    const { MockVisaPayments } = await import('../src/adapters.js');
    const visa = new MockVisaPayments(); const { ctx, org, friends, b, choose } = await fundingBouquet(new MockAi(), { payments: visa }); const ch = await choose();
    const price = ch.tiers[0].thresholdCents;
    expect((await friends[0].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 2000, cardToken: TOK, last4: '4242', idempotencyKey: `rd0-${b.id}` })).status).toBe(201);
    ctx.clock.offsetMs = 3 * 864e5;
    expect((await friends[1].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: price, cardToken: TOK, last4: '4242', idempotencyKey: `rd1-${b.id}` })).status).toBe(201);
    const heldSum = async () => Number((await ctx.db.query(`SELECT COALESCE(SUM(amount_cents),0)::int AS s FROM contributions WHERE bouquet_id=$1 AND status='held'`, [b.id]))[0].s);
    const before = await heldSum();
    ctx.clock.offsetMs = 6 * 864e5 + 3600e3; visa.declineReauth = true; await ctx.sweep(); visa.declineReauth = false;
    const me = (await friends[0].get(`/api/bouquets/${b.id}`)).body.me;
    expect(me.contributions[0].status).toBe('released'); expect(me.holdNotice).toMatch(/couldn’t renew the hold/);
    expect((await ctx.db.query(`SELECT * FROM ledger_events WHERE type='release' AND bouquet_id=$1`, [b.id])).length).toBe(1);
    expect(await heldSum()).toBe(before - 2000);
    expect((await org.post(`/api/bouquets/${b.id}/lock`)).status).toBe(200);
    const c0 = (await ctx.db.query(`SELECT c.* FROM contributions c WHERE c.idempotency_key=$1`, [`rd0-${b.id}`]))[0]; expect(c0.status).toBe('released'); expect(c0.captured_cents).toBe(0);
    ctx.clock.offsetMs = 0;
  });
  it('a renewal that works stores the new hold id', async () => {
    const { ctx, friends, b, choose } = await fundingBouquet(new MockAi()); await choose();
    await friends[0].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 2000, cardToken: TOK, last4: '4242', idempotencyKey: `rn-${b.id}` });
    const [{ hold_id: h0 }] = await ctx.db.query('SELECT hold_id FROM contributions WHERE idempotency_key=$1', [`rn-${b.id}`]);
    ctx.clock.offsetMs = 6 * 864e5 + 3600e3; await ctx.sweep(); ctx.clock.offsetMs = 0;
    const [{ hold_id: h1, status }] = await ctx.db.query('SELECT hold_id, status FROM contributions WHERE idempotency_key=$1', [`rn-${b.id}`]);
    expect(status).toBe('held'); expect(h1).not.toBe(h0);
  });
});
