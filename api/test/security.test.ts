import { describe, it, expect } from 'vitest';
import { MockAi } from '../src/adapters.js';
import { fundingBouquet } from './helpers.js';
const VISA = '4242424242424242';

describe('demo shortcuts cannot touch other people’s gifts', { timeout: 60000 }, () => {
  it('moving the deadline expires only the organizer’s own gift and releases its holds', async () => {
    const { org, friends, b, choose } = await fundingBouquet(new MockAi()); await choose();
    const other = (await friends[0].post('/api/bouquets').send({ recipientName: 'Sam', occasion: 'Birthday', neededBy: new Date(Date.now() + 10 * 864e5).toISOString(), shipBufferDays: 3 })).body.bouquet;
    expect((await friends[1].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 2000, cardNumber: VISA, idempotencyKey: `s1-${b.id}` })).status).toBe(201);
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
