import { describe, it, expect } from 'vitest';
import { MockAi, MockVisaPayments } from '../src/adapters.js';
import { fundingBouquet } from './helpers.js';

const TOK = 'tok_test_visa_4242';
describe('cap is enforced under concurrency', { timeout: 30000 }, () => {
  it('5 parallel $150 holds on a $200 cap: exactly one lands, the rest are refused and their card holds released', async () => {
    // A slow card network widens the race window, the way a real authorization round trip does.
    class SlowVisa extends MockVisaPayments { released = 0; async hold(x: any) { await new Promise(r => setTimeout(r, 50)); return super.hold(x); } async release(id: string) { this.released++; return super.release(id); } }
    const visa = new SlowVisa(); const { friends, b, choose } = await fundingBouquet(new MockAi(), { payments: visa }); await choose();
    const f = friends[0]; await f.patch(`/api/bouquets/${b.id}/budget`).send({ budgetMinCents: 0, budgetMaxCents: 20000 });
    const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => f.post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: 15000, cardToken: TOK, last4: '4242', idempotencyKey: `race-${i}-${b.id}` })));
    expect(rs.filter(r => r.status === 201)).toHaveLength(1);
    expect(rs.filter(r => r.status === 400).every(r => /exceed your budget/.test(r.body.error))).toBe(true);
    const me = (await f.get(`/api/bouquets/${b.id}`)).body.me;
    const held = me.contributions.filter((c: any) => c.status === 'held').reduce((a: number, c: any) => a + c.amount_cents, 0);
    expect(visa.released).toBe(4); // every refused hold is let go at the card network
    expect(held).toBe(15000); expect(held).toBeLessThanOrEqual(me.budgetMaxCents);
  });
});
