import { describe, it, expect } from 'vitest';
import { MockAi } from '../src/adapters.js';
import { fundingBouquet } from './helpers.js';
const TOK = 'tok_test_visa_4242';

describe('demo shortcuts cannot touch other people’s gifts', { timeout: 60000 }, () => {
  it('moving the deadline expires only the organizer’s own gift and releases its holds', async () => {
    const { org, friends, b, choose } = await fundingBouquet(new MockAi()); await choose();
    const other = (await friends[0].post('/api/bouquets').send({ recipientName: 'Sam', occasion: 'Birthday', neededBy: new Date(Date.now() + 10 * 864e5).toISOString(), shipBufferDays: 3 })).body.bouquet;
    expect((await friends[1].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 2000, cardToken: TOK, last4: '4242', idempotencyKey: `s1-${b.id}` })).status).toBe(201);
    expect((await friends[0].post('/api/dev/deadline').send({ bouquetId: b.id })).status).toBe(403); // a member, not the organizer
    const r = await org.post('/api/dev/deadline').send({ bouquetId: b.id }); expect(r.status).toBe(200); expect(r.body.expired).toBe(1);
    expect((await org.get(`/api/bouquets/${b.id}`)).body.bouquet.status).toBe('expired');
    expect((await friends[1].get(`/api/bouquets/${b.id}`)).body.me.contributions[0].status).toBe('released');
    expect((await friends[0].get(`/api/bouquets/${other.id}`)).body.bouquet.status).toBe('collecting');
    expect((await org.post('/api/dev/deadline').send({ bouquetId: b.id })).status).toBe(409);
  });
  it('"jump to my payday" sets only my payday to today', async () => {
    const { friends, b, choose } = await fundingBouquet(new MockAi()); await choose();
    const r = await friends[0].post('/api/dev/payday').send({ bouquetId: b.id }); expect(r.status).toBe(200);
    expect((await friends[0].get(`/api/bouquets/${b.id}`)).body.me.payday).toBe(r.body.payday);
    expect((await friends[1].get(`/api/bouquets/${b.id}`)).body.me.payday).toBeNull();
  });
});

describe('double tap on the pay sheet', { timeout: 60000 }, () => {
  it('two concurrent requests with the same key make exactly one hold and no 500', async () => {
    const { friends, b, choose } = await fundingBouquet(new MockAi()); await choose();
    const send = () => friends[0].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 3000, cardToken: TOK, last4: '4242', idempotencyKey: `dbl-${b.id}` });
    const [a, c] = await Promise.all([send(), send()]);
    for (const r of [a, c]) expect([200, 201]).toContain(r.status);
    expect([a.status, c.status]).toContain(201);
    const st = (await friends[0].get(`/api/bouquets/${b.id}`)).body;
    expect(st.me.contributions.filter((x: any) => x.status === 'held').length).toBe(1); expect(st.me.receipt.heldCents).toBe(3000);
  });
});

describe('card numbers never reach the server', { timeout: 60000 }, () => {
  it('accepts a browser token + last4, rejects a raw card number, and stores only last4', async () => {
    const { ctx, friends, b, choose } = await fundingBouquet(new MockAi()); await choose();
    expect((await friends[0].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 2000, cardNumber: '4242424242424242', idempotencyKey: `raw-${b.id}` })).status).toBe(400);
    expect((await friends[0].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 2000, cardToken: TOK, last4: '4242', cardNumber: '4242424242424242', idempotencyKey: `mix-${b.id}` })).status).toBe(400);
    expect((await friends[0].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 2000, cardToken: '4242424242424242', last4: '4242', idempotencyKey: `bad-${b.id}` })).status).toBe(400);
    expect((await friends[0].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 2000, cardToken: TOK, last4: '4242', idempotencyKey: `ok-${b.id}` })).status).toBe(201);
    const rows = await ctx.db.query('SELECT card_last4 FROM contributions WHERE bouquet_id=$1', [b.id]); expect(rows).toEqual([{ card_last4: '4242' }]);
  });
});
