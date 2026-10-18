import { describe, it, expect } from 'vitest';
import { MockAi, MockVisaPayments } from '../src/adapters.js';
import { fundingBouquet } from './helpers.js';

const VISA = '4242424242424242';
describe('Visa calls run outside the DB transaction (pending → settled)', { timeout: 30000 }, () => {
  it('a processor error at capture leaves holds capture_pending; the next checkout call settles them once, ledger exact', async () => {
    class FlakyVisa extends MockVisaPayments { fails = 1; captures = 0; async capture(id: string, c: number) { if (this.fails-- > 0) throw new Error('processor timeout'); this.captures++; return super.capture(id, c); } }
    const visa = new FlakyVisa(); const { org, friends, b, choose } = await fundingBouquet(new MockAi(), { payments: visa }); const ch = await choose();
    const price = ch.tiers[0].thresholdCents; const half = Math.ceil(price / 2);
    for (const [i, f] of friends.entries()) expect((await f.post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: half, cardNumber: VISA, idempotencyKey: `st-${i}-${b.id}` })).status).toBe(201);
    const first = await org.post(`/api/bouquets/${b.id}/lock`); expect(first.status).toBe(200); expect(first.body.bouquet.status).toBe('purchased');
    const st1: string[] = []; for (const f of friends) st1.push(...(await f.get(`/api/bouquets/${b.id}`)).body.me.contributions.map((c: any) => c.status));
    expect(st1.some((s: string) => s === 'capture_pending')).toBe(true); // one capture failed and is waiting for a retry
    expect((await org.post(`/api/bouquets/${b.id}/lock`)).status).toBe(200); // retry settles what is pending
    for (const f of friends) expect((await f.get(`/api/bouquets/${b.id}`)).body.me.contributions.every((c: any) => c.status === 'captured')).toBe(true);
    expect((await org.post(`/api/bouquets/${b.id}/lock`)).status).toBe(200); // a third call is a no-op
    expect(visa.captures).toBe(2);
    const st = (await org.get(`/api/bouquets/${b.id}`)).body;
    const charged = [];
    for (const f of friends) charged.push((await f.get(`/api/bouquets/${b.id}`)).body.me.contributions.reduce((a: number, c: any) => a + c.captured_cents, 0));
    expect(charged.reduce((a, c) => a + c, 0)).toBe(price); expect(st.bouquet.status).toBe('purchased');
  });
});

describe('withdraw my hold', { timeout: 30000 }, () => {
  it('releases only my holds before checkout, updates the total, and is refused after checkout', async () => {
    const visa = new MockVisaPayments(); const { org, friends, b, choose } = await fundingBouquet(new MockAi(), { payments: visa }); const ch = await choose();
    const price = ch.tiers[0].thresholdCents;
    expect((await friends[0].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 1500, cardNumber: VISA, idempotencyKey: `w0-${b.id}` })).status).toBe(201);
    expect((await friends[1].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: price, cardNumber: VISA, idempotencyKey: `w1-${b.id}` })).status).toBe(201);
    const w = await friends[0].post(`/api/bouquets/${b.id}/contributions/withdraw`); expect(w.status).toBe(200); expect(w.body.withdrawn).toBe(1);
    expect(w.body.me.contributions.every((c: any) => c.status === 'released')).toBe(true);
    expect((await org.get(`/api/bouquets/${b.id}`)).body.totals.heldCents).toBe(price);
    expect((await friends[0].post(`/api/bouquets/${b.id}/contributions/withdraw`)).status).toBe(409); // nothing left
    expect((await org.post(`/api/bouquets/${b.id}/lock`)).status).toBe(200);
    expect((await friends[1].post(`/api/bouquets/${b.id}/contributions/withdraw`)).status).toBe(409); // too late: bought
  });
});
