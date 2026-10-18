import { test, expect, request as pwRequest } from '@playwright/test';
// A dropped WebSocket falls back to SSE for a moment, then reconnects (it used to stay on SSE forever).
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
test('live room reconnects its WebSocket after a drop', async ({ browser }) => {
  const api = await pwRequest.newContext({ baseURL: BASE });
  expect((await api.post('/api/auth/signup', { data: { email: `rt${Date.now()}@rt.io`, password: 'password123', name: 'Rhea' } })).status()).toBe(201);
  const b = (await (await api.post('/api/bouquets', { data: { recipientName: 'Maya', occasion: 'Birthday', neededBy: new Date(Date.now() + 10 * 864e5).toISOString(), shipBufferDays: 3 } })).json()).bouquet;
  const ctx = await browser.newContext({ storageState: await api.storageState() });
  await ctx.addInitScript(`(() => { const W = window.WebSocket; window.__sockets = [];
    window.WebSocket = function (u, p) { const s = new W(u, p); window.__sockets.push(s); return s; }; window.WebSocket.prototype = W.prototype; window.WebSocket.OPEN = W.OPEN; })();`);
  const page = await ctx.newPage(); await page.goto(`/b/${b.id}`);
  const live = page.getByTestId('live');
  test.skip((await page.evaluate(() => fetch('/api/health').then(r => r.json()))).realtime !== 'durable-object', 'no realtime worker configured');
  await expect(live).toHaveAttribute('data-mode', 'websocket', { timeout: 10000 });
  await page.evaluate(() => (window as any).__sockets.at(-1).close());
  await expect(live).toHaveAttribute('data-mode', 'sse', { timeout: 3000 });
  await expect(live).toHaveAttribute('data-mode', 'websocket', { timeout: 8000 });
  expect(await page.evaluate(() => (window as any).__sockets.length)).toBeGreaterThanOrEqual(2);
});
