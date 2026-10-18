import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { MockAi } from '../src/adapters.js';
import { fundingBouquet } from './helpers.js';

const TOK = 'tok_test_visa_4242';
describe('one-screen chip-in from the invite link', { timeout: 30000 }, () => {
  it('shows the gift and price, then joins and holds in one step as a guest (cap = what they chose)', async () => {
    const { ctx, org, b, choose } = await fundingBouquet(new MockAi());
    const pre = (await request(ctx.app).get(`/api/invite/${b.inviteToken}`)).body; expect(pre.gift).toBeNull(); // still picking: no money ask yet
    await choose();
    const inv = (await request(ctx.app).get(`/api/invite/${b.inviteToken}`)).body;
    expect(inv.gift.title).toBeTruthy(); expect(inv.gift.topCents).toBeGreaterThan(0); expect(inv.gift.holders).toBe(0); expect(inv.gift.tiers.length).toBeGreaterThan(0);
    const g = request.agent(ctx.app);
    const r = await g.post(`/api/join/${b.inviteToken}`).send({ displayName: 'Lena', phone: '+12065550177', budgetMaxCents: 2500, hold: { amountCents: 2500, cardToken: TOK, last4: '4242', idempotencyKey: 'inv-hold-' + b.id } });
    expect(r.status).toBe(200); expect(r.body.me.isGuest).toBe(true); expect(r.body.me.budgetMaxCents).toBe(2500);
    expect(r.body.me.contributions).toMatchObject([{ amount_cents: 2500, status: 'held' }]);
    expect((await request(ctx.app).get(`/api/invite/${b.inviteToken}`)).body.gift.holders).toBe(1);
    // more than the cap they set is refused, and a declined card leaves no hold
    const g2 = request.agent(ctx.app);
    expect((await g2.post(`/api/join/${b.inviteToken}`).send({ displayName: 'Max', phone: '+12065550178', budgetMaxCents: 1500, hold: { amountCents: 2000, cardToken: TOK, last4: '4242', idempotencyKey: 'inv-hold2-' + b.id } })).status).toBe(400);
    // retry from the same browser after fixing the amount: already a member, so it just places the hold
    const again = await g2.post(`/api/join/${b.inviteToken}`).send({ displayName: 'Max', phone: '+12065550178', budgetMaxCents: 1500, hold: { amountCents: 1500, cardToken: TOK, last4: '4242', idempotencyKey: 'inv-hold3-' + b.id } });
    expect(again.status).toBe(200); expect(again.body.me.contributions).toMatchObject([{ amount_cents: 1500, status: 'held' }]);
    void org;
  });
});
