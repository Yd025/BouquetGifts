import { describe, it, expect } from 'vitest';
import { MockAi } from '../src/adapters.js';
import { conditionalIn, parseChipInRules, matchTier, matchTiers, planChipIn } from '../src/bridge.js';
import { fundingBouquet } from './helpers.js';

const NOW = new Date('2026-10-17T20:00:00Z'); const VISA = '4242424242424242'; const BUY_BY = '2026-10-25T00:00:00Z';
const TIERS = [{ id: 't1', title: 'Pour-over kit', level: 1 }, { id: 't2', title: '+ Polaroid 600 camera', level: 2 }, { id: 't3', title: '+ Vinyl turntable', level: 3 }];

describe('conditional amounts ("or $40 if it gets us the Polaroid")', () => {
  it('reads the extra and what it is for, keeping the unconditional amount as the cap', () => {
    expect(parseChipInRules('$30, or $40 if it gets us the Polaroid', NOW)).toMatchObject({ softCents: 3000, capCents: 3000, conditional: { cents: 4000, phrase: 'Polaroid' } });
    expect(parseChipInRules('I can do 30 bucks, 40 if we can get the turntable', NOW)).toMatchObject({ capCents: 3000, conditional: { cents: 4000, phrase: 'turntable' } });
    expect(parseChipInRules('$25 or $35 if that unlocks the next tier, paid Friday', NOW)).toMatchObject({ softCents: 2500, capCents: 2500, payday: '2026-10-23', conditional: { cents: 3500 } });
    expect(parseChipInRules('about $30, $40 max, and I get paid Friday', NOW)!.conditional).toBeNull(); // plain caps are not conditions
    expect(conditionalIn('I can do $30')).toBeNull();
    expect(parseChipInRules('if we can get the polaroid camera I’ll do $60', NOW)).toMatchObject({ capCents: 6000, conditional: null }); // only one amount said
  });
  it('asks instead of guessing when a phrase fits two tiers ("the Record": an LP or the record-care kit)', () => {
    const t = [{ id: 'a', title: 'Pour-over kit', level: 1 }, { id: 'b', title: '+ Mitski LP on gold vinyl', level: 2 }, { id: 'c', title: '+ Record care kit (brush, fluid, sleeves)', level: 3 }];
    expect(matchTiers('the Record', t, null).map(x => x.id)).toEqual(['b', 'c']); expect(matchTier('the Record', t, null)).toBeNull();
    expect(matchTiers('Mitski', t, null).map(x => x.id)).toEqual(['b']); expect(matchTiers('care kit', t, null).map(x => x.id)).toEqual(['c']);
    const d = parseChipInRules('$27, or $42 if it gets us the Record', new Date('2026-10-17T20:00:00Z'))!;
    const p = planChipIn(d, { pledgedCents: 0, buyByAt: '2026-10-25T00:00:00Z', nextTierGapCents: 1000, ambiguous: true, conditionTier: null });
    expect(p.condition).toBeNull(); expect(p.warnings.join(' ')).not.toMatch(/couldn’t match/); expect(p.holdNowCents).toBe(2700);
  });
  it('matches the phrase to a tier by title words, or "next tier" to the next one', () => {
    expect(matchTier('the Polaroid', TIERS, null)!.id).toBe('t2'); expect(matchTier('turntable', TIERS, null)!.id).toBe('t3');
    expect(matchTier('next tier', TIERS, TIERS[1])!.id).toBe('t2'); expect(matchTier('a spaceship', TIERS, null)).toBeNull();
  });
  it('plans: extra waits for its tier, is held now only if it finishes that tier now, and is never invented', () => {
    const d = parseChipInRules('$30, or $40 if it gets us the Polaroid', NOW)!;
    const wait = planChipIn(d, { pledgedCents: 0, buyByAt: BUY_BY, nextTierGapCents: 2000, conditionTier: { id: 't2', title: 'Polaroid 600 camera', isNext: false, gapCents: 9000 } });
    expect(wait).toMatchObject({ holdNowCents: 3000, capCents: 4000, condition: { extraCents: 1000, tierId: 't2', unlocksNow: false } });
    expect(wait.summary).toBe('Hold $30 now. +$10 only if the group goes for the Polaroid 600 camera.');
    const now = planChipIn(d, { pledgedCents: 0, buyByAt: BUY_BY, nextTierGapCents: 3500, conditionTier: { id: 't2', title: 'Polaroid 600 camera', isNext: true, gapCents: 3500 } });
    expect(now).toMatchObject({ holdNowCents: 3500, condition: { unlocksNow: true } }); expect(now.holdNowCents).toBeLessThanOrEqual(4000);
    const far = planChipIn(d, { pledgedCents: 0, buyByAt: BUY_BY, nextTierGapCents: 5000, conditionTier: { id: 't2', title: 'Polaroid', isNext: true, gapCents: 5000 } });
    expect(far.holdNowCents).toBe(3000); // $40 can't finish it alone → don't hold the extra yet
    const none = planChipIn(d, { pledgedCents: 0, buyByAt: BUY_BY, nextTierGapCents: 2000, conditionTier: null });
    expect(none).toMatchObject({ capCents: 3000, condition: null, holdNowCents: 3000 }); expect(none.warnings[0]).toMatch(/couldn’t match “Polaroid”/);
  });
});

describe('conditional chip-in end to end', { timeout: 30000 }, () => {
  it('the extra is only offered as a top-up when the group is going for that tier', async () => {
    const { friends, b, choose } = await fundingBouquet(new MockAi()); const ch = await choose();
    const tiers = ch.tiers; expect(tiers.length).toBeGreaterThanOrEqual(3);
    const [t1, t2, t3] = tiers.map((t: any) => t.thresholdCents); const word = tiers[2].title.replace(/^\+ /, '').split(/\s+/).find((w: string) => w.length >= 4);
    const f = friends[0]; const base = Math.ceil(t1 / 100) * 100; const extra = 4000;
    const said = `$${base / 100}, or $${(base + extra) / 100} if it gets us the ${word}`;
    let u = (await f.post(`/api/bouquets/${b.id}/chip-in/understand`).send({ text: said })).body;
    if (u.choices) { // the word matched more than one tier: nothing is planned until the person taps which one
      expect(u.plan.condition).toBeNull(); expect(u.choices.map((c: any) => c.tierId)).toContain(tiers[2].id);
      u = (await f.post(`/api/bouquets/${b.id}/chip-in/understand`).send({ text: said, conditionTierId: tiers[2].id })).body; }
    expect(u.source).toBe('rules'); expect(u.plan.condition).toMatchObject({ tierId: tiers[2].id, extraCents: extra, unlocksNow: false });
    expect(u.plan.holdNowCents).toBe(base); expect(u.plan.capCents).toBe(base + extra);
    expect((await f.patch(`/api/bouquets/${b.id}/budget`).send({ budgetMinCents: u.plan.softCents, budgetMaxCents: u.plan.capCents, condition: { tierId: 'nope', baseCents: base } })).status).toBe(400);
    expect((await f.patch(`/api/bouquets/${b.id}/budget`).send({ budgetMinCents: u.plan.softCents, budgetMaxCents: u.plan.capCents, condition: { tierId: u.plan.condition.tierId, baseCents: base } })).status).toBe(200);
    expect((await f.post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: base, cardNumber: VISA, idempotencyKey: 'cd-0-' + b.id })).status).toBe(201);
    // Next tier is tier 2 (below the condition): the extra is off-limits, and nobody else can cover the gap → no ask
    expect((await f.get(`/api/bouquets/${b.id}/topup`)).body.ask).toBeNull();
    // Friend 2 funds tier 2 on their own; now the group is going for tier 3, so the conditional extra is in play
    const g = friends[1]; await g.patch(`/api/bouquets/${b.id}/budget`).send({ budgetMinCents: 0, budgetMaxCents: t3 });
    expect((await g.post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: t2 - base, cardNumber: VISA, idempotencyKey: 'cd-1-' + b.id })).status).toBe(201);
    const ask = (await f.get(`/api/bouquets/${b.id}/topup`)).body.ask; expect(ask).not.toBeNull();
    expect(ask.cents).toBeLessThanOrEqual(extra); expect(ask.tierPriceCents).toBe(t3);
  });
});
