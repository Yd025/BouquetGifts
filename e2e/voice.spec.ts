import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
// 🎙 Voice chip-in with a conditional amount: "thirty dollars, or forty if it gets us the <top tier>".
// The browser's Web Speech API is replaced by a scripted fake so the test is deterministic (no microphone in CI).
const BASE = process.env.BASE_URL ?? 'http://localhost:3000'; const uniq = Date.now();
const HUMAN = { 'x-turnstile-token': 'XXXX.DUMMY.TOKEN.XXXX' };
async function user(name: string) { const r = await pwRequest.newContext({ baseURL: BASE });
  const s = await r.post('/api/auth/signup', { data: { email: `${name.toLowerCase()}${uniq}@voice.io`, password: 'password123', name } }); expect(s.status()).toBe(201); return r; }
const ok = async (p: Promise<any>) => { const r = await p; expect(r.status(), await r.text()).toBeLessThan(300); return r.json(); };

test('say it out loud: mic → transcript → conditional read-back → hold only the unconditional part', async ({ browser }) => {
  const org = await user('Olive'); const f0 = await user('Jon');
  const b = (await ok(org.post('/api/bouquets', { data: { recipientName: 'Maya', occasion: 'Birthday', neededBy: new Date(Date.now() + 10 * 864e5).toISOString(), shipBufferDays: 3 } }))).bouquet;
  for (const f of [f0, org] as APIRequestContext[]) {
    if (f === f0) await ok(f.post(`/api/join/${b.inviteToken}`, { headers: HUMAN, data: { displayName: 'Jon', phone: '+12065550111', budgetMaxCents: 50000 } }));
    const qs = (await ok(f.get(`/api/bouquets/${b.id}/questions`))).questions;
    await ok(f.post(`/api/bouquets/${b.id}/cards`, { data: { answers: Object.fromEntries(qs.map((q: any) => [q.id, 0])) } }));
  }
  await ok(org.post(`/api/bouquets/${b.id}/fuse`)); const ch = await ok(org.post(`/api/bouquets/${b.id}/choose`));
  const top = ch.tiers[ch.tiers.length - 1]; const word = top.title.replace(/^\+ /, '').split(/\s+/).find((w: string) => w.length >= 4);
  const base = Math.ceil(ch.tiers[0].thresholdCents / 100); const said = `I can do $${base}, or $${base + 15} if it gets us the ${word}`;

  const ctx = await browser.newContext({ storageState: await f0.storageState() });
  // Plain-JS string (not a TS class) so nothing compiled by the test runner leaks into the page.
  await ctx.addInitScript(`(() => { const transcript = ${JSON.stringify(said)};
    function FakeSR() {}
    FakeSR.prototype.start = function () { const self = this; const words = transcript.split(' '); const half = words.slice(0, Math.ceil(words.length / 2)).join(' ');
      setTimeout(() => self.onresult && self.onresult({ results: [Object.assign([{ transcript: half }], { isFinal: false })] }), 150);
      setTimeout(() => { self.onresult && self.onresult({ results: [Object.assign([{ transcript }], { isFinal: true })] }); self.onend && self.onend(); }, 400); };
    FakeSR.prototype.stop = function () { this.onend && this.onend(); };
    window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR; })();`);
  const jon = await ctx.newPage(); await jon.goto(`/b/${b.id}`);
  await expect(jon.getByTestId('chipin-mic')).toBeVisible(); await jon.getByTestId('chipin-mic').click();
  await expect(jon.getByTestId('chipin-text')).toHaveValue(said);
  await expect(jon.getByTestId('chipin-plan')).toBeVisible(); // understood automatically when speech ends
  if (await jon.getByTestId('chipin-choices').isVisible()) { // "the Record" fits two tiers: one tap says which, nothing is guessed
    await jon.waitForTimeout(400); await jon.getByTestId('chipin-ai').screenshot({ path: '../screenshots/16g-ai-voice-which.png' });
    await jon.getByTestId('chipin-choice').filter({ hasText: top.title.replace(/^\+ /, '') }).click(); await expect(jon.getByTestId('chipin-choices')).toHaveCount(0); }
  await expect(jon.getByTestId('chipin-cap')).toHaveText(`$${base + 15}`); await expect(jon.getByTestId('chipin-cap-cond')).toContainText(`$${base + 15}`);
  await expect(jon.getByTestId('chipin-condition')).toContainText(`now, up to $${base + 15} for the`); await expect(jon.getByTestId('chipin-condition')).toContainText(`+$15 is offered`);
  await expect(jon.getByTestId('chipin-summary')).toContainText(`Hold $${base} now`);
  await jon.waitForTimeout(500); await jon.getByTestId('chipin-ai').screenshot({ path: '../screenshots/16f-ai-voice-conditional.png' });
  await jon.getByTestId('chipin-confirm').click(); await expect(jon.getByTestId('pay-confirm')).toHaveText(`Hold $${base}`, { timeout: 15000 });
});
