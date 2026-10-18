import { describe, it, expect } from 'vitest';
import { MockAi } from '../src/adapters.js';
import { GeminiAi } from '../src/gemini.js';
import { keepsFigures, explainRules, figures } from '../src/bridge.js';
import { fundingBouquet } from './helpers.js';

const VISA = '4242424242424242';
const reply = (t: string) => (async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: t }] } }] }) })) as unknown as typeof fetch;

describe('payment explainer (rules)', () => {
  it('keepsFigures only accepts rewrites with exactly the same dollar amounts', () => {
    const t = 'You pay $41.54 of your $50 hold and $8.46 goes back.';
    expect(keepsFigures(t, 'Of your $50 hold you pay $41.54; $8.46 returns to your card.')).toBe(true);
    expect(keepsFigures(t, 'You pay about $42 and get $8 back.')).toBe(false); // rounded = changed
    expect(keepsFigures(t, 'You pay $41.54 of $50, $8.46 back, plus a $5 fee.')).toBe(false); // invented amount
    expect(figures('$1,200 and $3.50')).toEqual(['$1200', '$3.50']);
  });
  it('says what each state means for this person', () => {
    const base = { recipient: 'Maya', gift: 'Trail Kit', organizer: 'Olivia', buyBy: '2026-10-24T20:00:00Z', tiersCount: 3, isOrganizer: false, nextTierTitle: null, nextTierGapCents: null, firstTierGapCents: null } as any;
    expect(explainRules({ ...base, status: 'funding', holders: 0, heldCents: 0, myHeldCents: 0, myChargeCents: 0, tierLevel: null, tierTitle: null, chargeCents: null, firstTierGapCents: 4500 }))
      .toMatch(/Nothing is charged yet\. The first item of Trail Kit needs \$45 more/);
    const f = explainRules({ ...base, status: 'funding', holders: 2, heldCents: 9000, myHeldCents: 5000, myChargeCents: 4167, tierLevel: 1, tierTitle: 'Mug', chargeCents: 7500, nextTierTitle: 'Map', nextTierGapCents: 3000 });
    expect(f).toMatch(/if Olivia checks out now, you pay \$41\.67 of your \$50 hold and \$8\.33 goes back/); expect(f).toMatch(/Map would need \$30 more/);
    expect(f).toContain('the first item (Mug) costs $75 in total and the group holds $90, so that is fully funded'); expect(f).toContain('charged exactly $75'); expect(f).toContain('the other $15 is released');
    expect(explainRules({ ...base, status: 'purchased', holders: 2, heldCents: 0, myHeldCents: 5000, myChargeCents: 4167, tierLevel: 1, tierTitle: 'Mug', chargeCents: 7500 })).toMatch(/You paid \$41\.67 of your \$50 hold\. The other \$8\.33 went back/);
    expect(explainRules({ ...base, status: 'expired', holders: 0, heldCents: 0, myHeldCents: 1500, myChargeCents: 0, tierLevel: null, tierTitle: null, chargeCents: null })).toMatch(/Nobody was charged, including your \$15 hold/);
  });
  it('GeminiAi.reword is rejected when it drops or invents an amount', async () => {
    const t = 'You pay $30 of your $40 hold and $10 goes back.';
    expect(await new GeminiAi('k', { fetch: reply('Your share is $30; the other $10 of your $40 hold comes right back.') }).reword('explain', t)).toMatch(/\$30/);
    expect(await new GeminiAi('k', { fetch: reply('You pay roughly thirty dollars.') }).reword('explain', t)).toBeNull();
    expect(await new GeminiAi('k', { fetch: reply('You pay $30 plus $2 tax.') }).reword('explain', t)).toBeNull();
  });
});

describe('GET /explain', { timeout: 30000 }, () => {
  it('explains the checkout preview and the final charge per person, with the rules when Gemini is off', async () => {
    const { org, friends, b, choose } = await fundingBouquet(new MockAi());
    expect((await friends[0].get(`/api/bouquets/${b.id}/explain`)).status).toBe(409); // still voting
    const ch = await choose(); const t1 = ch.tiers[0].thresholdCents;
    const before = (await friends[0].get(`/api/bouquets/${b.id}/explain`)).body;
    expect(before.source).toBe('rules'); expect(before.text).toContain('Nothing is charged yet');
    const a = Math.ceil(t1 * 0.6), c = Math.ceil(t1 * 0.6); // together over tier 1, so some of each hold is released
    await friends[0].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: a, cardNumber: VISA, idempotencyKey: 'ex-a-' + b.id });
    await friends[1].post(`/api/bouquets/${b.id}/contributions`).send({ amountCents: c, cardNumber: VISA, idempotencyKey: 'ex-c-' + b.id });
    const st = (await friends[0].get(`/api/bouquets/${b.id}`)).body; const co = st.totals.checkout;
    const pre = (await friends[0].get(`/api/bouquets/${b.id}/explain`)).body;
    const $ = (x: number) => '$' + (x / 100).toFixed(x % 100 ? 2 : 0);
    expect(co.atMost).toBe(true); expect(pre.text).toContain(`you pay at most your ${$(co.myHeldCents)} hold`); // two holders: exact share stays private
    // "fully funded" really means held ≥ tier price, and the text says it in that order
    // only two holders: a holder never sees the exact group total (they could back out the other's amount)
    expect(st.totals.blurred).toBe(true); expect(co.releaseCents).toBeNull(); expect(st.totals.heldCents).toBe(co.chargeCents);
    expect(pre.text).not.toContain('the group holds'); expect(pre.text).toContain('group total stays private'); expect(pre.text).toContain(`${$(co.chargeCents)} in total and that is fully funded`);
    // the organizer (not holding) sees the full reconciliation
    const ost = (await org.get(`/api/bouquets/${b.id}`)).body; const opre = (await org.get(`/api/bouquets/${b.id}/explain`)).body;
    expect(ost.totals.blurred).toBe(false); expect(ost.totals.heldCents).toBe(a + c);
    expect(co.chargeCents).toBeLessThanOrEqual(ost.totals.heldCents); expect(opre.text).toContain(`costs ${$(co.chargeCents)} in total and the group holds ${$(ost.totals.heldCents)}, so that is fully funded`);
    if (ost.totals.heldCents > co.chargeCents) expect(opre.text).toContain(`the other ${$(ost.totals.heldCents - co.chargeCents)} is released`);
    // every per-person share adds up to exactly the amount that will be captured
    const shares = await Promise.all([friends[0], friends[1], org].map(async x => (await x.get(`/api/bouquets/${b.id}`)).body.totals.checkout.myChargeCents));
    expect(shares.reduce((p: number, x: number) => p + x, 0)).toBeGreaterThanOrEqual(co.chargeCents); // "at most" caps cover the charge; exact sum is checked after buying in money.test expect(pre.text).toContain('if Org checks out now'); void org;
    await org.post(`/api/bouquets/${b.id}/lock`);
    const after = (await friends[0].get(`/api/bouquets/${b.id}/explain`)).body; const me = (await friends[0].get(`/api/bouquets/${b.id}`)).body.me;
    const paid = me.contributions.reduce((x: number, k: any) => x + (k.captured_cents ?? 0), 0);
    expect(after.text).toContain(`You paid ${$(paid)} of your ${$(a)} hold`);
    expect(after.receipt).toMatchObject({ mode: 'paid', chargedCents: paid, releasedCents: a - paid }); // receipt lines reconcile to the hold
    expect(pre.receipt).toMatchObject({ mode: 'atmost', chargedCents: co.myHeldCents, releasedCents: 0 });
    const caps = await Promise.all([friends[0], friends[1]].map(async x => (await x.get(`/api/bouquets/${b.id}`)).body.me.contributions.reduce((p: number, k: any) => p + (k.captured_cents ?? 0), 0)));
    const cap = (await org.get(`/api/bouquets/${b.id}`)).body.bouquet.capturedCents;
    expect(caps.reduce((p: number, x: number) => p + x, 0)).toBe(cap); expect(cap).toBe(co.chargeCents); expect(after.text).toContain(`charged exactly ${$(cap)}`);
    const orgView = (await org.get(`/api/bouquets/${b.id}/explain`)).body.text; expect(orgView).toMatch(/You didn’t place a hold, so you paid nothing/);
  });
  it('shows Gemini wording only when it keeps every figure', async () => {
    let mode = 'good';
    const ai = Object.assign(new MockAi(), { provider: 'gemini', reword: async (_k: string, t: string) => mode === 'good' ? `Plainly: ${t}` : null });
    const { friends, b, choose } = await fundingBouquet(ai); await choose();
    const g = (await friends[0].get(`/api/bouquets/${b.id}/explain`)).body; expect(g.source).toBe('gemini'); expect(g.text).toBe('Plainly: ' + g.rules);
    mode = 'bad'; const r = (await friends[0].get(`/api/bouquets/${b.id}/explain`)).body; expect(r.source).toBe('rules'); expect(r.text).toBe(r.rules);
  });
});

import { keepsRecipient } from '../src/bridge.js';
describe('Gemini rewording keeps whose gift it is', () => {
  it("rejects \"Olive's gift\" when the gift is for Maya", () => {
    expect(keepsRecipient("You're all set to pay $30 for Olive's gift since the Polaroid is fully funded at $237.", 'Maya')).toBe(false);
    expect(keepsRecipient('You pay $30 toward Maya’s gift; $237 is fully funded.', 'Maya')).toBe(true);
    expect(keepsRecipient('If Olive checks out now, you pay $30.', 'Maya')).toBe(true);
  });
});
