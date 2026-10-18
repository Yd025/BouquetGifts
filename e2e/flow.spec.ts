import { test, expect, Browser, Page } from '@playwright/test';
const SHOTS = '../screenshots/';
// a real product photo actually decoded in the browser (not a broken <img>)
const expectLoaded = async (img: any) => { await expect(img).toBeVisible(); await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0)).toBe(true); };
const uniq = Date.now();
// the 🎬 Judge demo button is position:fixed; a full-page capture paints it mid-page over content, so product shots hide it (10d shows it on purpose)
const NOFAB = '.drawer,#fx-layer{visibility:hidden !important}';
const ADJ: Record<string, string> = { 'Sunrise Hiker': 'Trail-Ready', 'Coffee Snob': 'Caffeinated', 'Brunch Royalty': 'Brunch-Loving', Maker: 'Crafty', 'Film Shooter': 'Grainy', 'Music Head': 'Rhythm-Driven', 'Plant Parent': 'Green-Thumbed', Bookworm: 'Well-Read', 'Hates Clutter': 'Minimalist', 'Cozy Nester': 'Cozy' }; // mirrors api/src/domain.ts
// wait for every finite CSS animation on the element, its subtree and its ancestors (so a screenshot never catches a fade-in)
const settle = (loc: any) => loc.evaluate(async (el: Element) => { const anims = [...el.getAnimations({ subtree: true })];
  for (let p = el.parentElement; p; p = p.parentElement) anims.push(...p.getAnimations());
  await Promise.all(anims.filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); });
// a modal is crisp when nothing above it is translucent and it is the topmost thing at its centre (no backdrop stacked over it)
const expectCrisp = async (loc: any, inner?: any) => {
  const check = (el: Element) => { let o = 1; for (let p: Element | null = el; p; p = p.parentElement) o *= Number(getComputedStyle(p).opacity);
    const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { opacity: o, topmost: !!top && el.contains(top) }; };
  expect(await loc.evaluate(check)).toEqual({ opacity: 1, topmost: true });
  if (inner) expect(await inner.evaluate(check)).toEqual({ opacity: 1, topmost: true }); };
async function signup(browser: Browser, name: string, next = '') {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto('/signup' + (next ? `?next=${encodeURIComponent(next)}` : '')); await page.waitForLoadState('networkidle');
  await page.fill('input[name=name]', name); await page.fill('input[name=email]', `${name.toLowerCase()}${uniq}@e2e.io`); await page.fill('input[name=password]', 'password123');
  await page.click('button[type=submit]'); return page;
}
async function fillCard(page: Page, pref: string[], story: string, shot?: string) {
  await expect(page.getByTestId('q-card').or(page.getByTestId('q-memory'))).toBeVisible(); // the questionnaire loads async
  for (let k = 0; k < 8; k++) {
    if (!(await page.getByTestId('q-card').isVisible().catch(() => false))) break;
    if (shot && k === 0) { await settle(page.getByTestId('q-card')); await page.screenshot({ path: SHOTS + shot + '-a.png', fullPage: true, style: NOFAB }); }
    if (shot && (await page.getByTestId('drawn-badge').isVisible().catch(() => false))) { await page.waitForTimeout(750); await page.screenshot({ path: SHOTS + shot + '-b-drawn.png', fullPage: true, style: NOFAB }); shot = undefined; }
    const before = await page.getByTestId('q-progress').textContent();
    const opts = page.getByTestId('q-opt'); const n = await opts.count(); let picked = false;
    for (let i = 0; i < n && !picked; i++) { const t = (await opts.nth(i).textContent()) ?? ''; if (pref.some(p => t.toLowerCase().includes(p))) { await opts.nth(i).click(); picked = true; } }
    if (!picked) await opts.last().click();
    await expect(page.getByTestId('q-progress')).not.toHaveText(before!);
  }
  await expect(page.getByTestId('q-memory')).toBeVisible(); await page.getByTestId('story').fill(story);
}
const HIKE_COFFEE = ['hike', 'pour-over', 'camping', 'café', 'mountains', 'latte', 'instant coffee', 'trail map', 'clutter'];

test('demo account login works', async ({ page }) => {
  await page.goto('/'); const hero = page.getByTestId('hero-strip'); await expect(hero.getByTestId('strip-item')).toHaveCount(3); // real catalog products in the hero
  for (const img of await hero.getByTestId('strip-photo').all()) await expectLoaded(img);
  for (const a of await hero.locator('a').all()) await expect(a).toHaveAttribute('href', /^https:\/\/[a-z.]+\/products\//);
  await expect(hero.locator('[data-unlocked="1"]')).toHaveCount(2); await expect(hero.locator('[data-unlocked="0"]')).toHaveCount(1);
  await settle(page.getByTestId('hero-gift')); await page.screenshot({ path: SHOTS + '01-landing.png', fullPage: true, style: NOFAB });
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300); // phone: the headline and pitch fit, nothing is clipped sideways
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: SHOTS + '01b-landing-mobile.png', style: NOFAB }); await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/login'); await page.waitForLoadState('networkidle'); await page.fill('input[name=email]', 'demo@bouquet.gift'); await page.fill('input[name=password]', 'wrong-pass');
  await page.click('button[type=submit]'); await expect(page.locator('.err')).toContainText('Wrong email or password');
  await page.fill('input[name=password]', 'bouquet123'); await page.screenshot({ path: SHOTS + '02-login.png' });
  await page.click('button[type=submit]'); await expect(page.getByTestId('nav-user')).toContainText('Adelin');
});

test('organizer + 3 friends + recipient reveal', async ({ browser }) => {
  const org = await signup(browser, 'Adelin');
  await expect(org).toHaveURL(/dashboard/); await org.screenshot({ path: SHOTS + '03-dashboard.png' });
  await org.getByTestId('new-bouquet').click(); await expect(org).toHaveURL(/\/new/); await org.waitForLoadState('networkidle');
  await org.fill('input[name=recipientName]', 'Maya'); await org.fill('textarea', 'Maya turns 25! Let’s make it special.');
  await org.screenshot({ path: SHOTS + '04-create.png', fullPage: true, style: NOFAB });
  await org.click('button[type=submit]');
  await expect(org.getByTestId('room-title')).toContainText('Maya');
  const invite = await org.getByTestId('invite-link').inputValue();
  const path = new URL(invite).pathname;

  const names = ['Jon', 'Priya', 'Sam']; const friends: Page[] = [];
  const memories = ['I still think about the dawn hike up Mt. Si when you pulled a pour-over kit out of your backpack.',
    'You lent me your film camera for Lisbon and made me shoot a whole roll of strangers smiling.',
    'On every road trip you DJ and I drive, and you have never once let me pick a song.'];
  for (const [k, n] of names.entries()) {
    const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.goto(path); await p.waitForLoadState('networkidle');
    if (k === 0) await p.screenshot({ path: SHOTS + '05-invite.png' });
    await p.getByTestId('invite-card').click();
    await p.fill('input[name=displayName]', n); await p.fill('input[name=phone]', `+1206555010${k}`);
    if (k === 0) await p.screenshot({ path: SHOTS + '06-join.png' });
    await p.getByTestId('join-submit').click(); await expect(p.getByTestId('room-title')).toBeVisible();
    await expect(p.getByTestId('invite-link')).toHaveCount(0); // invite link is organizer-only
    if (k === 0) await expect(p.getByTestId('cards-empty')).toContainText('No cards yet'); // the empty column says what will land there
    await fillCard(p, HIKE_COFFEE, memories[k], k === 0 ? '07-questionnaire' : undefined);
    await p.getByTestId('mint-card').click(); await expect(p.getByTestId('mint-overlay')).toBeVisible();
    if (k === 0) { await p.waitForTimeout(400); await p.screenshot({ path: SHOTS + '08a-pack-open.png' }); }
    await expect(p.getByTestId('minted-card')).toBeInViewport(); // overlay is portalled to <body>, not trapped in the panel
    const chips = await p.getByTestId('minted-card').getByTestId('stat-chips').textContent(); const title = await p.getByTestId('minted-card').locator('h3').textContent();
    expect(chips).toContain(title!.replace(/^The (\S+ )?/, '').trim().split(' ').slice(-2).join(' ')); // title trait is one of the chips
    if (k === 0) { await settle(p.getByTestId('minted-card')); await expectCrisp(p.getByTestId('minted-card')); await p.screenshot({ path: SHOTS + '08b-card-minted.png' }); }
    await p.getByTestId('mint-done').click(); await expect(p.getByText('Your card', { exact: true })).toBeVisible();
    friends.push(p);
  }
  if (process.env.E2E_REALTIME === '1') { // live room: the Durable Object pushes each friend's mint to the organizer, no reload
    await expect(org.getByTestId('live')).toHaveAttribute('data-mode', 'websocket'); await expect(org.getByText('Cards so far (3)')).toBeVisible({ timeout: 4000 }); await expect(org.getByTestId('still-writing')).toHaveCount(0); await expect(org.getByTestId('cards-empty')).toHaveCount(0);
  } else {
    if (process.env.E2E_FALLBACK === '1') await expect(org.getByTestId('live')).toHaveAttribute('data-mode', 'sse', { timeout: 10000 }); // worker down → SSE fallback
    await org.reload(); await expect(org.getByText('Cards so far (3)')).toBeVisible(); await expect(org.getByTestId('still-writing')).toHaveCount(0); }
  await org.getByTestId('fuse').click(); await expect(org.getByTestId('candidate').first()).toBeVisible();
  await expect(org.getByTestId('deck')).toBeVisible();
  await expect(org.getByTestId('draw-slot')).toContainText('Draw a card'); await expect(org.getByTestId('discard-pile')).toContainText('to pass');
  const cardTitles = await org.locator('.cards h3').allTextContents(); expect(cardTitles).toHaveLength(3); expect(new Set(cardTitles).size).toBe(3); // no look-alike cards
  // ideas stay face down until someone makes a gift: no photos or titles to anchor on yet
  for (const c of await org.getByTestId('candidate').all()) { await expect(c).toHaveAttribute('data-facedown', '1'); await expect(c.getByTestId('cand-photo')).toHaveCount(0); }
  await org.waitForTimeout(1100); await org.screenshot({ path: SHOTS + '09-deck.png', fullPage: true, style: NOFAB });
  // Friend 0 plays the deck: draw, keep, draw, discard, undo, keep, then fuse two hand cards with buttons.
  const p0 = friends[0]; await p0.reload();
  await p0.getByTestId('deck').click(); await expect(p0.getByTestId('drawn-card')).toBeVisible(); await p0.waitForTimeout(700);
  await p0.screenshot({ path: SHOTS + '09a-deck-draw.png', fullPage: true, style: NOFAB });
  const box = (await p0.getByTestId('drawn-card').boundingBox())!;
  await p0.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p0.mouse.down(); await p0.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 5 });
  await p0.screenshot({ path: SHOTS + '09b-mid-swipe.png', fullPage: true, style: NOFAB });
  await p0.mouse.move(box.x + box.width / 2 + 220, box.y + box.height / 2, { steps: 5 }); await p0.mouse.up();   // swipe right = keep
  await expect(p0.getByTestId('hand-card')).toHaveCount(1);
  await p0.getByTestId('deck').click(); await p0.getByTestId('discard').click();
  await expect(p0.getByTestId('discard-pile').locator('.stackcard')).toHaveCount(1);
  await p0.getByTestId('undo').click(); await expect(p0.getByTestId('discard-pile').locator('.stackcard')).toHaveCount(0);
  await p0.getByTestId('deck').click(); await p0.getByTestId('keep').click(); await expect(p0.getByTestId('hand-card')).toHaveCount(2);
  await p0.keyboard.press('Space'); await expect(p0.getByTestId('drawn-card')).toBeVisible(); await p0.keyboard.press('ArrowLeft');
  await expect(p0.getByTestId('discard-pile').locator('.stackcard')).toHaveCount(1);
  // Keep any cards still in the deck, then try pairs until one fuses (a rare pair without consensus is correctly refused).
  while (await p0.getByTestId('deck').isEnabled()) { await p0.getByTestId('deck').click(); await p0.getByTestId('keep').click(); await p0.waitForTimeout(450); }
  await expect(p0.getByTestId('match-note').filter({ hasText: 'kept' }).first()).toBeVisible(); // keeps move the matching ideas' bars
  const n = await p0.getByTestId('hand-card').count(); let fused = false;
  for (let a = 0; a < n && !fused; a++) for (let b = a + 1; b < n && !fused; b++) {
    for (const i of [0, 1, 2, 3, 4].slice(0, n)) if ((await p0.getByTestId('hand-card').nth(i).getAttribute('aria-pressed')) === 'true') await p0.getByTestId('hand-card').nth(i).click();
    await p0.getByTestId('hand-card').nth(a).click(); await p0.getByTestId('hand-card').nth(b).click();
    if (a === 0 && b === 1) await p0.screenshot({ path: SHOTS + '09c-hand-select.png', fullPage: true, style: NOFAB });
    await p0.getByTestId('fuse-hand').click();
    fused = await p0.getByTestId('fused-gift').waitFor({ timeout: 4000 }).then(() => true, () => false);
  }
  expect(fused).toBe(true);
  await expect(p0.getByTestId('fused-gift')).toBeInViewport(); await expect(p0.getByTestId('fuse-close')).toBeInViewport();
  await settle(p0.getByTestId('fused-gift')); await expectCrisp(p0.getByTestId('fused-gift')); await p0.screenshot({ path: SHOTS + '09d-fusion.png' });
  await p0.getByTestId('fuse-close').click(); await expect(p0.getByText('Voted ✓')).toBeVisible(); await expect(p0.getByTestId('facedown-ideas')).toHaveCount(0); // the first gift turns the ideas over
  for (const c of await p0.getByTestId('candidate').all()) { await expect(c.getByTestId('cand-art')).toHaveCount(0); await expectLoaded(c.getByTestId('cand-photo')); // every gift shows a real product photo
    await expect(c.locator('a.prodlink')).toHaveAttribute('href', /^https:\/\/[a-z.]+\/products\//); }
  for (const f of friends.slice(1)) { await f.reload(); await f.getByTestId('deck').click(); await f.getByTestId('keep').click(); await expect(f.getByTestId('hand-card')).toHaveCount(1);
    // Priya and Sam back the top named-recipe gift when there is one, so it wins 2–1 (every gift has a real product photo now).
    const named = f.getByTestId('candidate').filter({ hasNotText: /Duo Box|Treasure Box/ }); // answers are seeded per member, so a named recipe isn't guaranteed
    await ((await named.count()) ? named.first() : f.getByTestId('candidate').first()).getByTestId('vote').click(); await expect(f.getByText('Voted ✓')).toBeVisible(); }
  await org.reload(); await expect(org.getByTestId('kept-count').first()).toBeVisible().catch(() => {});
  for (const c of await org.getByTestId('candidate').all()) { await expect(c.getByTestId('cand-art')).toHaveCount(0); await expectLoaded(c.getByTestId('cand-photo')); } // incl. Jon's fused duo box
  const covers = await org.getByTestId('cand-photo').evaluateAll(els => els.map(e => (e as HTMLImageElement).getAttribute('src')));
  expect(new Set(covers).size).toBe(covers.length); // the fused duo never repeats a photo already on the table
  await org.waitForTimeout(1100); await org.screenshot({ path: SHOTS + '09e-gift-table.png', fullPage: true, style: NOFAB }); await expect(org.getByTestId('cand-photo').first()).toBeVisible(); await expectLoaded(org.getByTestId('cand-photo').first());
  await org.getByTestId('choose').click(); await expect(org.getByTestId('tier').first()).toBeVisible();
  await expectLoaded(org.getByTestId('tier-photo').first());
  const strip = org.getByTestId('gift-strip'); const nTiers = await org.getByTestId('tier').count(); // the whole gift, one tile per tier, all locked before anyone chips in
  await expect(strip.getByTestId('strip-item')).toHaveCount(nTiers); for (const img of await strip.getByTestId('strip-photo').all()) await expectLoaded(img);
  await expect(strip.locator('[data-unlocked="0"]')).toHaveCount(nTiers); await expect(org.getByTestId('checkout-preview')).toHaveCount(0);
  await expect(org.getByTestId('whos-in')).toContainText('0 of 4 in'); await expect(org.getByTestId('deadline-box')).toContainText('left to buy');
  expect(await org.getByTestId('tier').first().locator('a[href^="https://"]').first().getAttribute('href')).toMatch(/^https:\/\/[a-z.]+\/products\//);
  // the organizer chips in too ($20), so their Bought screen reads 'You paid $X of your $20 hold' (like the seeded Maya demo)
  await org.getByTestId('enter-amounts').click(); await org.fill('input[name=budgetMax]', '70'); await org.getByTestId('save-budget').click();
  await org.fill('input[name=amount]', '20'); await org.getByTestId('hold').click(); await expect(org.getByTestId('pay-confirm')).toBeEnabled({ timeout: 15000 });
  await org.getByTestId('pay-confirm').click(); await expect(org.getByTestId('pay-sheet')).toHaveCount(0); await expect(org.getByTestId('you-in')).toContainText('You’re in for $20');
  const amounts = [50, 40, 45]; let pops = 0;
  for (const [k, f] of friends.entries()) {
    await f.reload(); await expect(f.getByTestId('chipin-text')).toBeVisible(); await expect(f.getByTestId('claim')).toHaveCount(0); // no sign-up wall: guests chip in first
    if (k === 0) { await settle(f.locator('.cards')); await expect(f.locator('.cards h3')).toHaveCount(3); await f.screenshot({ path: SHOTS + '10a-guest-claim.png', fullPage: true, style: NOFAB }); }
    if (k === 0) { // chip order follows the card title: most answers first, and among equal counts the trait the title names comes first
      const bad = await f.locator('.cards .cardface.front').evaluateAll((els, adj) => els.flatMap(el => {
        const title = (el.querySelector('h3')?.textContent ?? '').toLowerCase();
        const chips = [...el.querySelectorAll('.chip.stat')].map(c => ({ label: (c.firstChild?.textContent ?? '').trim(), n: Number((c.querySelector('b')?.textContent ?? '').replace('×', '')) }));
        const named = (l: string) => title.includes(l.toLowerCase()) || (!!(adj as any)[l] && title.includes((adj as any)[l].toLowerCase()));
        return chips.slice(1).flatMap((c, i) => c.n > chips[i].n || (c.n === chips[i].n && named(c.label) && !named(chips[i].label)) ? [`${title}: ${chips[i].label} before ${c.label}`] : []);
      }), ADJ);
      expect(bad).toEqual([]); }
    await f.getByTestId('enter-amounts').click(); await f.fill('input[name=budgetMax]', '70'); await f.getByTestId('save-budget').click();
    if (k === 2) { // in a real 1280px viewport the Judge button sits in the page margin, clear of every panel
      const fab = (await f.getByTestId('demo-toggle').boundingBox())!; expect(fab.width).toBeLessThanOrEqual(48);
      const panelRight = await f.evaluate(() => Math.max(...[...document.querySelectorAll('main .panel')].filter(e => !e.closest('.drawer')).map(e => e.getBoundingClientRect().right)));
      expect(fab.x).toBeGreaterThanOrEqual(panelRight); }
    if (k === 2) { await f.getByTestId('demo-toggle').click(); await f.getByTestId('demo-simswap').click();
      await expect(f.getByTestId('sim-block')).toContainText('We didn’t place this hold'); await f.getByTestId('sim-block').scrollIntoViewIfNeeded(); await f.screenshot({ path: SHOTS + '10d-demo-simswap.png', fullPage: true }); await f.getByTestId('demo-toggle').click(); }
    await f.fill('input[name=amount]', String(amounts[k])); await f.getByTestId('hold').click(); await expect(f.getByTestId('pay-sheet')).toBeInViewport({ ratio: 0.95 });
    await expect(f.getByTestId('pay-confirm')).toBeEnabled({ timeout: 15000 }); await expect(f.getByTestId('pay-confirm')).toContainText('Hold $'); await expect(f.getByTestId('human-ok')).toBeVisible(); // Turnstile passed
    await settle(f.getByTestId('pay-sheet')); await expectCrisp(f.getByTestId('pay-sheet'), f.getByTestId('pay-confirm')); // opaque, nothing stacked over the Hold button
    expect(await f.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden'); // page behind the modal is scroll-locked
    if (k === 0) await f.screenshot({ path: SHOTS + '10b-pay-sheet.png' });
    await f.getByTestId('pay-confirm').click(); await expect(f.getByText('Card •••• 4242', { exact: true }).first()).toBeVisible();
    await expect(f.getByTestId('pay-sheet')).toHaveCount(0); expect(await f.evaluate(() => document.body.style.overflow)).toBe(''); // lock released on close
    await expect(f.getByTestId('hold')).toHaveText(`Add $${amounts[k]} more`); // a second hold reads as adding, not replacing
    await expect(f.getByTestId('you-in')).toContainText(`You’re in for $${amounts[k]}`); await expect(f.getByTestId('you-in')).toContainText('•••• 4242');
    // saving an account is optional and comes after the hold
    await f.getByTestId('claim').locator('summary').click(); await f.fill('input[name=claimEmail]', `${names[k].toLowerCase()}${uniq}@e2e.io`); await f.fill('input[name=claimPassword]', 'password123');
    await f.getByTestId('claim-save').click(); await expect(f.getByTestId('claim')).toHaveCount(0);
    if (await f.getByTestId('unlock-pop').waitFor({ timeout: 2500 }).then(() => true, () => false)) { pops++; if (pops === 1) await f.screenshot({ path: SHOTS + '10c-unlock-pop.png', fullPage: true, style: NOFAB }); }
  }
  expect(pops).toBeGreaterThan(0);
  { const f = friends[2]; await f.setViewportSize({ width: 390, height: 844 }); await f.waitForTimeout(400); // phone: no sideways scroll, nav fits, cards swipe in a row
    expect(await f.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const nav = (await f.locator('nav.nav').boundingBox())!; expect(nav.height).toBeLessThan(90);
    const tops = await f.locator('.cards > *').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top))); expect(new Set(tops).size).toBe(1);
    await settle(f.locator('.cards')); await f.screenshot({ path: SHOTS + '10e-mobile-room.png', fullPage: true, style: NOFAB }); await f.setViewportSize({ width: 1280, height: 860 }); }
  await expect(friends[2].getByTestId('petals')).toContainText('Sam');
  const f2 = friends[2]; await f2.reload(); await expect(f2.getByTestId('tier')).toHaveCount(nTiers); await expect(f2.getByTestId('funded')).toContainText('$155'); const unlocked = await f2.getByTestId('tier').and(f2.locator('.unlocked')).count();
  await expect(f2.getByTestId('gift-strip').locator('[data-unlocked="1"]')).toHaveCount(unlocked); // lit tiles = unlocked tiers
  await expect(f2.getByTestId('who-row')).toHaveCount(4); await expect(f2.getByTestId('whos-in')).toContainText('4 of 4 in'); await expect(f2.getByTestId('whos-in')).not.toContainText('$');
  await expect(f2.getByTestId('checkout-preview')).toContainText(/it costs \$\d+/);
  const fundedText = (await f2.getByTestId('funded').textContent())!;
  if (/fully funded/.test(fundedText)) await expect(f2.getByTestId('checkout-preview')).toContainText(/Fully funded.*goes back to their cards/); // over the goal: say what happens to the extra
  await expect(f2.getByTestId('my-share')).toContainText(/you pay \$[\d.]+ of your \$45 hold/);
  const share = Number((await f2.getByTestId('my-share').locator('b').textContent())!.replace('$', ''));
  await expect(f2.getByTestId('unlock-pop')).toHaveCount(0, { timeout: 8000 }); await settle(f2.getByTestId('gift-strip')); await settle(f2.locator('.cards')); await expect(f2.locator('.cards h3')).toHaveCount(3);
  await f2.screenshot({ path: SHOTS + '10-funding-bloom.png', fullPage: true, style: NOFAB });
  await org.reload(); await expect(org.getByTestId('funded')).toContainText('$155');
  await org.getByTestId('checkout').click(); await expect(org.getByText('Demo · no real money moved')).toBeVisible();
  await friends[0].reload(); await expect(friends[0].getByTestId('my-charge')).toBeVisible(); await expect(friends[0].getByTestId('vcard-line').first()).toContainText(/one-time Visa card •••• \d{4} \(sandbox\) · order #BQ-/); await expect(friends[0].getByText(/went back to your card/)).toBeVisible();
  await expect(org.getByTestId('my-receipt')).toContainText(/You paid \$[\d.]+ of your \$20(\.00)? hold/); await expect(org.getByTestId('gift-strip')).toBeVisible(); await expect(org.getByTestId('funded')).toContainText(/paid · \d of \d in the box/); await expect(org.getByTestId('countdown')).toHaveText('✓ Bought in time'); await expect(org.getByTestId('countdown')).not.toContainText('left');
  await f2.reload(); await expect(f2.getByTestId('my-charge')).toHaveText('$' + (share % 1 ? share.toFixed(2) : share)); // the preview was exactly what got charged
  await org.waitForTimeout(900);
  await org.screenshot({ path: SHOTS + '11-purchased.png', fullPage: true, style: NOFAB });
  const reveal = await org.getByTestId('reveal-link').inputValue();

  const rp = await (await browser.newContext()).newPage(); await rp.goto(new URL(reveal).pathname); await expect(rp.getByTestId('pack')).toBeEnabled({ timeout: 30000 });
  await rp.screenshot({ path: SHOTS + '12-reveal-pack.png' });
  await rp.getByTestId('pack').click(); await rp.waitForTimeout(450); await rp.screenshot({ path: SHOTS + '12b-reveal-tear.png' });
  await expect(rp.getByTestId('reveal-card')).toBeVisible(); await expect(rp.getByText(/^✿ You/).first()).toBeVisible(); // compliments, not raw trait names
  await expect(rp.getByTestId('reveal-card').locator('.story')).toBeInViewport(); // the friend's memory is on the card, not clipped off it
  await rp.waitForTimeout(900); await rp.screenshot({ path: SHOTS + '13-reveal-card.png' });
  for (let i = 0; i < 3; i++) await rp.getByTestId('next-card').click();
  await expect(rp.getByTestId('final-gift')).toBeVisible(); await expect(rp.getByTestId('garland')).toBeVisible();
  await expect(rp.getByTestId('legendary')).toBeVisible(); await expect(rp.getByTestId('confetti')).toBeVisible();
  await expectLoaded(rp.getByTestId('reveal-photo'));
  await rp.waitForTimeout(1200); await rp.screenshot({ path: SHOTS + '14-reveal-garland.png' });
  await org.goto('/dashboard'); await expectLoaded(org.getByTestId('dash-photo').first()); await org.screenshot({ path: SHOTS + '15b-dashboard-photos.png', fullPage: true, style: NOFAB });
});
