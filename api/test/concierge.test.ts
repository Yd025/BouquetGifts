import { describe, it, expect } from 'vitest';
import { MockAi } from '../src/adapters.js';
import { conciergeRules } from '../src/bridge.js';
import { fundingBouquet } from './helpers.js';

describe('gift concierge (rules)', () => {
  const tiers = (a: number, b: number, c: number) => [{ level: 1, title: 'Mug', thresholdCents: a }, { level: 2, title: '+ Map', thresholdCents: b }, { level: 3, title: '+ Stove', thresholdCents: c }];
  it('ranks by kept cards and votes, and reports the reachable tier + next upgrade without leaking the budget sum', () => {
    const picks = conciergeRules({ groupBudgetCents: 13000, members: 3, traitKeeps: { 'Sunrise Hiker': 3, 'Coffee Snob': 2, Bookworm: 0 },
      candidates: [{ id: 'a', title: 'Book Nook', rare: false, traits: ['Bookworm'], votes: 0, citedFriends: ['Jon'], tiers: tiers(3000, 6000, 9000) },
        { id: 'b', title: 'Trail Café Kit', rare: true, traits: ['Sunrise Hiker', 'Coffee Snob'], votes: 1, citedFriends: ['Jon', 'Ana'], tiers: tiers(6000, 12000, 18000) }] });
    expect(picks.map(p => p.candidateId)).toEqual(['b', 'a']);
    expect(picks[0].reachableTier?.level).toBe(2); expect(picks[0].nextTier).toEqual({ level: 3, title: 'Stove', thresholdCents: 18000 });
    expect(picks[0].why).toMatch(/Sunrise Hiker \(kept ×3\) and Coffee Snob \(kept ×2\)/); expect(picks[0].why).not.toContain('$130');
    expect(picks[1].nextTier).toBeNull();
  });
  it('says when even tier 1 is over budget', () => {
    const [p] = conciergeRules({ groupBudgetCents: 1000, members: 1, traitKeeps: {}, candidates: [{ id: 'x', title: 'Kit', rare: false, traits: ['Maker'], votes: 0, citedFriends: [], tiers: tiers(3000, 6000, 9000) }] });
    expect(p.reachableTier).toBeNull(); expect(p.why).toMatch(/Even tier 1 \(\$30\) is above/);
  });
});

describe('GET /concierge', { timeout: 30000 }, () => {
  it('ranks the gifts on the table during the deck stage (rules), and is closed otherwise', async () => {
    const { friends, b, fused, choose } = await fundingBouquet(new MockAi());
    const r = (await friends[0].get(`/api/bouquets/${b.id}/concierge`)).body;
    expect(r.source).toBe('rules'); expect(r.picks.length).toBeGreaterThan(0); expect(r.picks.length).toBeLessThanOrEqual(3);
    for (const p of r.picks) expect(fused.candidates.map((c: any) => c.id)).toContain(p.candidateId);
    // keeping a trait card moves gifts built on it up
    const t = fused.traits.find((x: any) => !r.picks[0].why.includes(x.label));
    if (t) { for (const f of friends) await f.post(`/api/bouquets/${b.id}/picks`).send({ traitId: t.id, keep: true });
      const r2 = (await friends[0].get(`/api/bouquets/${b.id}/concierge`)).body; expect(r2.picks[0].why).toContain(t.label); }
    await choose(); expect((await friends[0].get(`/api/bouquets/${b.id}/concierge`)).status).toBe(409);
  });
  it('uses Gemini wording for the top pick when it keeps the figures', async () => {
    const ai = Object.assign(new MockAi(), { provider: 'gemini', reword: async (_k: string, t: string) => `Gemini says: ${t}` });
    const { friends, b } = await fundingBouquet(ai);
    const r = (await friends[1].get(`/api/bouquets/${b.id}/concierge`)).body;
    expect(r.source).toBe('gemini'); expect(r.picks[0].why).toMatch(/^Gemini says: /); if (r.picks[1]) expect(r.picks[1].why).not.toMatch(/^Gemini/);
  });
});
