import crypto from 'node:crypto';
import { traitsFromAnswers, fuse as mockFuse, cardTitle as mockTitle, TraitAgg } from './domain.js';

/* ---------- Payments (mock Visa sandbox; swap for a real processor) ---------- */
export interface Payments { hold(a: { amountCents: number; cardNumber: string; idempotencyKey: string }): Promise<{ holdId: string; last4: string }>;
  capture(holdId: string, amountCents: number): Promise<void>; release(holdId: string): Promise<void> }
export class MockVisaPayments implements Payments {
  holds = new Map<string, { amount: number; state: string }>(); byKey = new Map<string, string>();
  async hold({ amountCents, cardNumber, idempotencyKey }: any) {
    const digits = String(cardNumber).replace(/\D/g, '');
    if (digits.length < 13 || !luhn(digits)) throw new PaymentError('Card number is invalid');
    if (digits.endsWith('0002')) throw new PaymentError('Card declined (insufficient funds)');
    const existing = this.byKey.get(idempotencyKey);
    if (existing) return { holdId: existing, last4: digits.slice(-4) };
    const holdId = 'hold_' + crypto.randomBytes(8).toString('hex');
    this.holds.set(holdId, { amount: amountCents, state: 'held' }); this.byKey.set(idempotencyKey, holdId);
    return { holdId, last4: digits.slice(-4) };
  }
  async capture(holdId: string, amountCents: number) { const h = this.holds.get(holdId); if (h) { if (amountCents > h.amount) throw new PaymentError('over-capture'); h.state = 'captured'; } }
  async release(holdId: string) { const h = this.holds.get(holdId); if (h) h.state = 'released'; }
}
export class PaymentError extends Error {}
function luhn(d: string) { let s = 0; for (let i = 0; i < d.length; i++) { let n = +d[d.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9; } s += n; } return s % 10 === 0; }

/* ---------- T-Mobile network APIs (CAMARA via Nokia Network-as-Code style) ---------- */
export interface NetworkVerify { numberVerify(phone: string): Promise<boolean>; simSwappedRecently(phone: string, maxAgeHours?: number): Promise<boolean>; provider: string }
export class MockNetwork implements NetworkVerify {
  provider = 'mock-camara'; swapped = new Set<string>();
  async numberVerify(phone: string) { return /^\+?\d{10,15}$/.test(phone.replace(/[\s()-]/g, '')) && !phone.endsWith('0000'); }
  async simSwappedRecently(phone: string) { return phone.endsWith('9999') || this.swapped.has(phone); }
  /** Demo only: simulate a SIM swap on this number. */
  markSwapped(phone: string, on = true) { on ? this.swapped.add(phone) : this.swapped.delete(phone); }
}
export class NacNetwork implements NetworkVerify {
  provider = 'nokia-nac';
  constructor(private key: string, private base = process.env.NAC_BASE_URL ?? 'https://network-as-code.p-eu.rapidapi.com') {}
  private async post(path: string, body: any) {
    const r = await fetch(this.base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-rapidapi-key': this.key,
      'x-rapidapi-host': new URL(this.base).host }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('NaC ' + r.status); return r.json() as any;
  }
  async numberVerify(phone: string) { try { return !!(await this.post('/passthrough/camara/v1/number-verification/number-verification/v0/verify', { phoneNumber: phone })).devicePhoneNumberVerified; } catch { return new MockNetwork().numberVerify(phone); } }
  async simSwappedRecently(phone: string, maxAgeHours = 240) { try { return !!(await this.post('/passthrough/camara/v1/sim-swap/sim-swap/v0/check', { phoneNumber: phone, maxAge: maxAgeHours })).swapped; } catch { return false; } }
}

/* ---------- Grok (xAI) for trait titles + fusion blurbs, deterministic mock fallback ---------- */
export interface Ai { cardTitle(traits: string[], story?: string): Promise<string>; cardArt(prompt: string): Promise<Buffer | null>; polish(story: string, friend: string): Promise<string>; enrichCandidates(traits: TraitAgg[], avoid?: { tags: string[]; cards: number }): Promise<ReturnType<typeof mockFuse>>; provider: string }
export class MockAi implements Ai {
  provider = 'mock';
  async cardTitle(traits: string[]) { return mockTitle(traits); }
  async enrichCandidates(traits: TraitAgg[], avoid?: { tags: string[]; cards: number }) { return mockFuse(traits, 2, avoid); }
  async cardArt(_prompt: string): Promise<Buffer | null> { return null; }
  async polish(story: string, _friend?: string) { return story; }
}
export class GrokAi extends MockAi {
  provider = 'grok';
  constructor(private key: string) { super(); }
  private async chat(prompt: string) {
    const r = await fetch('https://api.x.ai/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.XAI_MODEL ?? 'grok-3-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.7 }), signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('xai ' + r.status); return ((await r.json()) as any).choices[0].message.content as string;
  }
  async cardTitle(traits: string[], story?: string) {
    // Title must name the friend's own top trait so the card matches the answers.
    try { const t = (await this.chat(`Write a 2-4 word playful trading-card title that MUST contain the words "${traits[0]}" for a person who is ${traits.join(', ')}${story ? ` (memory: "${story}")` : ''}. Title only.`)).trim().replace(/^"|"$/g, '').slice(0, 40);
      return t.includes(traits[0]) ? t : mockTitle(traits); } catch { return mockTitle(traits); }
  }
  async cardArt(prompt: string) {
    try { const r = await fetch('https://api.x.ai/v1/images/generations', { method: 'POST', headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: process.env.XAI_IMAGE_MODEL ?? 'grok-2-image', prompt, n: 1, response_format: 'b64_json' }), signal: AbortSignal.timeout(20000) });
      if (!r.ok) return null; const j: any = await r.json(); return j.data?.[0]?.b64_json ? Buffer.from(j.data[0].b64_json, 'base64') : null; } catch { return null; }
  }
  async polish(story: string, friend: string) {
    try { return (await this.chat(`Lightly polish this birthday-card memory written by ${friend}. Keep it first person, keep every fact, max 30 words, no quotes: ${story}`)).trim().slice(0, 300); } catch { return story; }
  }
  async enrichCandidates(traits: TraitAgg[], avoid?: { tags: string[]; cards: number }) {
    const base = mockFuse(traits, 2, avoid); // recipes + consensus rules stay authoritative; Grok only rewrites the blurb
    try { for (const c of base) c.description = (await this.chat(`One warm sentence (<25 words) pitching the gift "${c.title}" for someone who is ${c.traits.join(' and ')}.`)).trim(); } catch {}
    return base;
  }
}

export function makeAdapters() {
  return { payments: new MockVisaPayments() as Payments,
    network: process.env.NAC_API_KEY ? new NacNetwork(process.env.NAC_API_KEY) : new MockNetwork() as NetworkVerify,
    ai: process.env.XAI_API_KEY ? new GrokAi(process.env.XAI_API_KEY) : new MockAi() as Ai };
}
export { traitsFromAnswers };

/* ---------- Cloudflare Turnstile (bot check on join / hold / reveal) ---------- */
export type Turnstile = { siteKey: string | null; verify(token: string | undefined, ip?: string): Promise<boolean> };
export function makeTurnstile(secret = process.env.TURNSTILE_SECRET_KEY, siteKey = process.env.TURNSTILE_SITE_KEY ?? null): Turnstile {
  if (!secret) return { siteKey: null, verify: async () => true };
  return { siteKey, async verify(token, ip) {
    if (!token) return false;
    try { const body = new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) });
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(6000) });
      return !!((await r.json()) as any).success; } catch { return false; } } };
}
