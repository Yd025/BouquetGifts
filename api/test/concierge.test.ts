import { describe, it, expect } from 'vitest';
import { MockAi } from '../src/adapters.js';
import { conciergeRules } from '../src/bridge.js';
import { fundingBouquet } from './helpers.js';

describe('gift concierge (rules)', () => {
  const tiers = (a: number, b: number, c: number) => [{ level: 1, title: 'Mug', thresholdCents: a }, { level: 2, title: '+ Map', thresholdCents: b }, { level: 3, title: '+ Stove', thresholdCents: c }];
  const base = { groupBudgetCents: 13000, cardholders: ['Jon', 'Ana', 'Sam'], traitKeeps: { 'Sunrise Hiker': 3, 'Coffee Snob': 2, Bookworm: 1, 'Film Shooter': 0 } };
  const kit = { id: 'b', title: 'Trail Café Kit', rare: true, traits: ['Sunrise Hiker', 'Coffee Snob'], votes: 1, contributors: ['Jon', 'Ana'], cover: 'u1', tiers: tiers(6000, 12000, 18000) };
  const nook = { id: 'a', title: 'Book Nook', rare: false, traits: ['Bookworm', 'Cozy Nester'], votes: 0, contributors: ['Sam'], cover: 'u2', tiers: tiers(3000, 6000, 9000) };
  const trio = { id: 'c', title: 'Trail Book Duo', rare: false, traits: ['Sunrise Hiker', 'Bookworm'], votes: 0, contributors: ['Jon', 'Ana', 'Sam'], cover: 'u3', tiers: tiers(5000, 9000, 20000) };
  it('ranks, gives every pick a different standout, cites every contributor and labels budget in dollars (never the summed caps)', () => {
    const picks = conciergeRules({ ...base, candidates: [nook, kit, trio] });
    expect(picks.map(p => p.candidateId)).toEqual(['b', 'c', 'a']);
    expect(new Set(picks.map(p => p.standout)).size).toBe(3);
    expect(picks.find(p => p.candidateId === 'c')!.standout).toBe('The only pick that draws on all 3 friends’ cards.');
    expect(picks.find(p => p.candidateId === 'a')!.standout).toBe('The only one your budget covers in full today ($90).');
    expect(picks[0].why).toContain('Uses Jon and Ana’s cards (not Sam’s)'); expect(picks[1].why).toContain('Uses Jon, Ana and Sam’s cards');
    expect(picks[0].budget).toEqual({ coversCents: 12000, items: 2, totalCents: 18000, items_total: 3, full: false }); expect(picks[0].nextUpgrade).toEqual({ title: 'Stove', priceCents: 18000 });
    for (const p of picks) expect(JSON.stringify(p)).not.toContain('13000');
  });
  it('drops near-duplicates (same lead product, or traits already covered by a better pick)', () => {
    const sub = { ...nook, id: 'd', title: 'Hiker Treasure Box', traits: ['Sunrise Hiker'], contributors: ['Jon', 'Ana'], cover: 'u9' };
    const samePhoto = { ...nook, id: 'e', title: 'Café Box', traits: ['Coffee Snob', 'Film Shooter'], cover: 'u1' };
    const ids = conciergeRules({ ...base, candidates: [kit, sub, samePhoto, nook] }).map(p => p.candidateId);
    expect(ids).toContain('b'); expect(ids).not.toContain('d'); expect(ids).not.toContain('e'); expect(ids).toContain('a');
  });
  it('says plainly when even the first item is over budget', () => {
    const [p] = conciergeRules({ ...base, groupBudgetCents: 1000, candidates: [nook] });
    expect(p.budget.coversCents).toBe(0); expect(p.nextUpgrade).toEqual({ title: 'Mug', priceCents: 3000 });
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
      const r2 = (await friends[0].get(`/api/bouquets/${b.id}/concierge`)).body; expect(r2.picks.some((p: any) => p.why.includes(t.label))).toBe(true); }
    await choose(); expect((await friends[0].get(`/api/bouquets/${b.id}/concierge`)).status).toBe(409);
  });
  it('uses Gemini wording for the top pick when it keeps the figures', async () => {
    const ai = Object.assign(new MockAi(), { provider: 'gemini', reword: async (_k: string, t: string) => `Gemini says: ${t}` });
    const { friends, b } = await fundingBouquet(ai);
    const r = (await friends[1].get(`/api/bouquets/${b.id}/concierge`)).body;
    expect(r.source).toBe('gemini'); expect(r.picks[0].why).toMatch(/^Gemini says: /); if (r.picks[1]) expect(r.picks[1].why).not.toMatch(/^Gemini/);
  });
});
