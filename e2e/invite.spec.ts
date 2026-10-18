import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
// Real user on a phone: the invite link opens ONE money-first screen (gift, price, who's in, quick amounts, hold), no signup wall.
const BASE = process.env.BASE_URL ?? 'http://localhost:3000'; const uniq = Date.now();
const HUMAN = { 'x-turnstile-token': 'XXXX.DUMMY.TOKEN.XXXX' };
async function user(name: string) { const r = await pwRequest.newContext({ baseURL: BASE });
  expect((await r.post('/api/auth/signup', { data: { email: `${name.toLowerCase()}${uniq}@inv.io`, password: 'password123', name } })).status()).toBe(201); return r; }
const ok = async (p: Promise<any>) => { const r = await p; expect(r.status(), await r.text()).toBeLessThan(300); return r.json(); };

test('invite → one screen → $40 hold as a guest on a 390px phone → optional card after', async ({ browser }) => {
  const org = await user('Adelin'); const f0 = await user('Jon');
  const b = (await ok(org.post('/api/bouquets', { data: { recipientName: 'Maya', occasion: 'Birthday', neededBy: new Date(Date.now() + 10 * 864e5).toISOString(), shipBufferDays: 3 } }))).bouquet;
  for (const f of [f0, org] as APIRequestContext[]) {
    if (f === f0) await ok(f.post(`/api/join/${b.inviteToken}`, { headers: HUMAN, data: { displayName: 'Jon', phone: '+12065550141', budgetMaxCents: 50000 } }));
    const qs = (await ok(f.get(`/api/bouquets/${b.id}/questions`))).questions;
    await ok(f.post(`/api/bouquets/${b.id}/cards`, { data: { answers: Object.fromEntries(qs.map((q: any) => [q.id, 0])) } }));
  }
  await ok(org.post(`/api/bouquets/${b.id}/fuse`)); await ok(org.post(`/api/bouquets/${b.id}/choose`));
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
  await p.goto(`/join/${b.inviteToken}`);
  await expect(p.getByTestId('chip-first')).toBeVisible(); await expect(p.getByRole('heading', { level: 1 })).toContainText('Chip in on Maya’s gift');
  await expect(p.getByTestId('cf-meta')).toContainText(/\$\d+ for the whole gift.*Be the first to chip in.*open until/);
  expect((await p.getByTestId('cf-hold').boundingBox())!.y + 46).toBeLessThanOrEqual(844); // Chip in is above the fold on a 390×844 phone
  // "Just say it" is the primary input on the invite too: read back, then it fills the amount
  await p.getByTestId('chipin-text').fill('$30, $40 max'); await p.getByTestId('chipin-understand').click();
  await expect(p.getByTestId('chipin-soft')).toHaveText('$30'); await p.getByTestId('chipin-confirm').click(); await expect(p.getByTestId('cf-hold')).toHaveText('Chip in $30');
  await p.getByTestId('cf-amt-40').click(); await expect(p.getByTestId('cf-hold')).toHaveText('Chip in $40');
  await expect(p.getByTestId('cf-fine')).toContainText('never more than $40');
  await p.fill('input[name=displayName]', 'Priya'); await p.fill('input[name=phone]', '+12065550199');
  for (const sel of ['input[name=displayName]', 'input[name=phone]', 'input[name=card]', '[data-testid=cf-amount]', '[data-testid=chipin-text]']) // no iOS zoom on focus
    expect(await p.locator(sel).evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
  for (const sel of ['[data-testid=cf-amt-40]', '[data-testid=cf-hold]']) expect((await p.locator(sel).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await p.screenshot({ path: '../screenshots/05b-invite-chipin-mobile.png', fullPage: true, style: '#fx-layer{visibility:hidden !important}' });
  await p.getByTestId('cf-hold').click();
  await expect(p).toHaveURL(new RegExp(`/b/${b.id}`)); await expect(p.getByTestId('late-card')).toBeVisible();
  const st = await (await ctx.request.get(`/api/bouquets/${b.id}`)).json();
  expect(st.me.isGuest).toBe(true); expect(st.me.contributions).toMatchObject([{ amount_cents: 4000, status: 'held' }]);
  // the optional card after the money ask: mint it on the phone; the minted card must not cover "Add to the bouquet"
  await p.getByTestId('late-card-open').click();
  await expect(p.getByTestId('q-card')).toBeVisible();
  while (!(await p.getByTestId('q-memory').isVisible())) { await p.getByTestId('q-opt').first().click(); await p.waitForTimeout(400); }
  await p.getByTestId('mint-card').click(); await expect(p.getByTestId('mint-done')).toBeVisible({ timeout: 5000 }); await p.waitForTimeout(500);
  await expect(p.getByTestId('mint-done')).toBeInViewport();
  const done = (await p.getByTestId('mint-done').boundingBox())!; const card = (await p.getByTestId('minted-card').boundingBox())!;
  expect(await p.evaluate(([x, y]) => (document.elementFromPoint(x, y) as HTMLElement)?.closest('[data-testid=mint-done]') !== null, [done.x + done.width / 2, done.y + done.height / 2])).toBe(true);
  void card; await p.screenshot({ path: '../screenshots/08c-card-minted-mobile.png', style: '#fx-layer{visibility:hidden !important}' });
  await p.getByTestId('mint-done').click(); await expect(p.getByTestId('late-card')).toHaveCount(0);
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
