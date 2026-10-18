import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
// AI between people and payments: concierge pick → natural-language chip-in → plain-language explainer, before and after checkout.
// Setup goes through the API (fast); the three AI features are driven in the browser. Works with Gemini on or off (rules fallback).
const SHOTS = '../screenshots/'; const NOFAB = '.drawer,#fx-layer{visibility:hidden !important}';
const BASE = process.env.BASE_URL ?? 'http://localhost:3000'; const uniq = Date.now();
const HUMAN = { 'x-turnstile-token': 'XXXX.DUMMY.TOKEN.XXXX' }; // Cloudflare's always-pass test keys accept any token
async function user(name: string) { const r = await pwRequest.newContext({ baseURL: BASE });
  const s = await r.post('/api/auth/signup', { data: { email: `${name.toLowerCase()}${uniq}@ai.io`, password: 'password123', name } }); expect(s.status()).toBe(201); return r; }
const ok = async (p: Promise<any>) => { const r = await p; expect(r.status(), await r.text()).toBeLessThan(300); return r.json(); };

test('AI bridges people and payment: concierge, chip-in in plain words, payment explainer', async ({ browser }) => {
  const org = await user('Olive'); const f0 = await user('Jon'); const f1 = await user('Priya');
  const b = (await ok(org.post('/api/bouquets', { data: { recipientName: 'Maya', occasion: 'Birthday', neededBy: new Date(Date.now() + 10 * 864e5).toISOString(), shipBufferDays: 3 } }))).bouquet;
  for (const [i, f] of ([f0, f1] as APIRequestContext[]).entries()) {
    await ok(f.post(`/api/join/${b.inviteToken}`, { headers: HUMAN, data: { displayName: i ? 'Priya' : 'Jon', phone: '+1206555010' + i, budgetMaxCents: 50000 } }));
    const qs = (await ok(f.get(`/api/bouquets/${b.id}/questions`))).questions;
    await ok(f.post(`/api/bouquets/${b.id}/cards`, { data: { answers: Object.fromEntries(qs.map((q: any) => [q.id, 0])) } }));
  }
  await ok(org.post(`/api/bouquets/${b.id}/fuse`));

  // 1) Concierge during the deck stage
  const jon = await (await browser.newContext({ storageState: await f0.storageState() })).newPage();
  await jon.goto(`/b/${b.id}`); await expect(jon.getByTestId('concierge')).toBeVisible();
  await jon.getByTestId('concierge-ask').click(); await expect(jon.getByTestId('concierge-pick').first()).toBeVisible();
  await expect(jon.getByTestId('concierge-tier')).toContainText(/Within reach if everyone|Limits could cover|more than everyone’s limits/);
  await expect(jon.getByTestId('concierge-why')).not.toBeEmpty(); await expect(jon.getByTestId('concierge-standout').first()).not.toBeEmpty(); await expect(jon.getByTestId('concierge-source')).toBeVisible();
  await jon.getByTestId('concierge').scrollIntoViewIfNeeded(); await jon.getByTestId('concierge').screenshot({ path: SHOTS + '16a-ai-concierge.png' });
  await jon.getByTestId('concierge-vote').first().click(); await expect(jon.getByTestId('concierge-vote').first()).toHaveText('Voted ✓');
  await ok(org.post(`/api/bouquets/${b.id}/choose`)); // top-voted = the concierge's pick

  // 2) Natural-language chip-in → read-back → Visa sheet prefilled → hold
  await jon.reload(); await expect(jon.getByTestId('chipin-ai')).toBeVisible();
  await jon.getByTestId('chipin-text').fill('I can do about $30, $40 max, and I get paid Friday'); await jon.getByTestId('chipin-understand').click();
  await expect(jon.getByTestId('chipin-plan')).toBeVisible();
  await expect(jon.getByTestId('chipin-soft')).toHaveText('$30'); await expect(jon.getByTestId('chipin-cap')).toHaveText('$40'); await expect(jon.getByTestId('chipin-payday')).toHaveText('$10'); await expect(jon.getByTestId('chipin-plan')).toContainText('More on Fri');
  await expect(jon.getByTestId('chipin-summary')).toContainText('Hold $30 now'); await expect(jon.getByTestId('chipin-schedule')).toContainText('up to $10 more');
  expect(await jon.getByTestId('chipin-text').evaluate((e: HTMLTextAreaElement) => e.scrollWidth <= e.clientWidth + 1)).toBe(true); // whole sentence visible, wraps instead of truncating
  await expect(jon.getByTestId('chipin-source')).toHaveText(/read by (Gemini|Bouquet rules)/);
  await jon.waitForTimeout(700); await jon.getByTestId('chipin-ai').screenshot({ path: SHOTS + '16b-ai-chipin.png' });
  await jon.getByTestId('chipin-confirm').click(); await expect(jon.getByTestId('pay-sheet')).toBeVisible();
  await expect(jon.getByTestId('pay-confirm')).toHaveText('Hold $30', { timeout: 15000 });
  await jon.getByTestId('pay-confirm').click(); await expect(jon.getByText(/•••• 4242/)).toBeVisible();
  await expect(jon.locator('input[name=budgetMax]')).toHaveValue('40'); // the spoken cap became the private budget
  // an over-cap ask is trimmed to what fits, before any money moves
  await jon.getByTestId('chipin-text').fill('$25, $40 max'); await jon.getByTestId('chipin-understand').click();
  await expect(jon.getByTestId('chipin-confirm')).toHaveText('Looks right: hold $10'); await expect(jon.getByTestId('chipin-warning').first()).toContainText('only $10 more fits');
  await jon.getByText('Not quite').click();

  // 3) Explainer before checkout (tier 1 funded by Priya + Jon)
  const st = await ok(f1.get(`/api/bouquets/${b.id}`)); const t1 = st.tiers[0].thresholdCents;
  await ok(f1.post(`/api/bouquets/${b.id}/contributions`, { headers: HUMAN, data: { amountCents: Math.max(100, t1), cardNumber: '4242424242424242', idempotencyKey: `ai-${uniq}` } }));
  await jon.reload(); await jon.getByTestId('explain-pay').click();
  await expect(jon.getByTestId('explain-text')).toContainText(/you pay at most your \$30 hold/i);
  await expect(jon.getByTestId('explain-source')).toBeVisible();
  await jon.waitForTimeout(700); await jon.getByTestId('explain-text').screenshot({ path: SHOTS + '16c-ai-explain-preview.png' });

  // 4) Top-up plan: Priya (no payday, room under her cap) gets her own one-tap ask; Jon's room updates live, no reload
  const priya = await (await browser.newContext({ storageState: await f1.storageState() })).newPage();
  await priya.goto(`/b/${b.id}`); await expect(priya.getByTestId('topup')).toBeVisible();
  await expect(priya.getByTestId('topup-title')).toHaveText(/^Top up \$\d+\?$/); await expect(priya.getByTestId('topup-message')).toContainText('unlocks');
  await expect(priya.getByTestId('topup-group')).toContainText(/^\+\$\d+ from you · /);
  await priya.waitForTimeout(600); await priya.getByTestId('topup').screenshot({ path: SHOTS + '16e-ai-topup.png' });
  const before = await jon.getByTestId('funded').textContent();
  await priya.getByTestId('topup-accept').click(); await expect(priya.getByTestId('topup-done')).toBeVisible(); await expect(priya.getByTestId('topup-phonecheck')).toContainText('phone check passed');
  await expect(jon.getByTestId('funded')).not.toHaveText(before!, { timeout: 20000 }); // live: WebSocket / SSE / poll
  await expect(jon.getByTestId('topup')).toHaveCount(0); // Jon's payday is later and Priya covered it: Jon isn't nagged

  // 5) …and after checkout
  await ok(org.post(`/api/bouquets/${b.id}/lock`));
  await jon.reload(); await jon.getByTestId('explain-pay').click();
  await expect(jon.getByTestId('explain-text')).toContainText(/You paid \$[\d.]+ of your \$30 hold/i);
  await expect(jon.getByTestId('receipt-charged')).toHaveText(/^\$[\d.]+$/); await expect(jon.getByTestId('receipt-why')).toContainText('split in proportion');
  await jon.waitForTimeout(800); await jon.screenshot({ path: SHOTS + '16d-ai-explain-paid.png', fullPage: true, style: NOFAB });
});
