import { test, expect } from '@playwright/test';
test('profile, nav links and 404 page', async ({ page }) => {
  await page.goto('/login'); await page.waitForLoadState('networkidle');
  await page.fill('input[name=email]', 'demo@bouquet.gift'); await page.fill('input[name=password]', 'bouquet123'); await page.click('button[type=submit]');
  await expect(page).toHaveURL(/dashboard/);
  await page.getByTestId('nav-user').click(); await expect(page.getByTestId('profile-title')).toBeVisible();
  await page.screenshot({ path: '../screenshots/15-profile.png' });
  await page.getByRole('link', { name: 'New bouquet' }).click(); await expect(page).toHaveURL(/\/new/);
  await page.goto('/'); await expect(page.getByTestId('before-after')).toBeVisible();
  await page.goto('/definitely-not-here'); await expect(page.getByTestId('not-found')).toBeVisible();
  await page.screenshot({ path: '../screenshots/16-not-found.png' });
  // no dead links on public pages
  for (const p of ['/', '/login', '/signup', '/dashboard', '/new', '/profile']) {
    await page.goto(p); await page.waitForLoadState('networkidle');
    for (const href of await page.locator('a[href^="/"]').evaluateAll(as => as.map(a => (a as HTMLAnchorElement).getAttribute('href')!))) {
      const r = await page.request.get(href.split('#')[0] || '/'); expect(r.status(), href).toBeLessThan(400);
    }
  }
});
