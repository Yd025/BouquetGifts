import crypto from 'node:crypto';
import { GeminiAi } from './gemini.js';
import { MockAi, type Ai } from './ai.js';
export { MockAi, GeminiAi }; export type { Ai };
import { traitsFromAnswers, fuse as mockFuse, cardTitle as mockTitle, TraitAgg } from './domain.js';

/* ---------- Payments (mock Visa sandbox; swap for a real processor) ---------- */
export interface Payments { hold(a: { amountCents: number; cardNumber?: string; token?: string; idempotencyKey: string }): Promise<{ holdId: string; last4: string; token: string }>;
  capture(holdId: string, amountCents: number): Promise<void>; release(holdId: string): Promise<void> }
export class MockVisaPayments implements Payments {
  holds = new Map<string, { amount: number; state: string }>(); byKey = new Map<string, string>();
  /** Mock token vault (stand-in for a Visa network token / Click to Pay stored credential): we keep a token, never the card number. */
  private vault = new Map<string, string>();
  async hold({ amountCents, cardNumber, token, idempotencyKey }: { amountCents: number; cardNumber?: string; token?: string; idempotencyKey: string }) {
    const digits = token ? this.vault.get(token) ?? '' : String(cardNumber ?? '').replace(/\D/g, '');
    if (token && !digits) throw new PaymentError('Saved card is no longer available, please re-enter it');
    if (digits.length < 13 || !luhn(digits)) throw new PaymentError('Card number is invalid');
    if (digits.endsWith('0002')) throw new PaymentError('Card declined (insufficient funds)');
    const tok = 'vtok_' + crypto.createHash('sha256').update('bouquet-vault|' + digits).digest('hex').slice(0, 20); this.vault.set(tok, digits);
    const existing = this.byKey.get(idempotencyKey);
    if (existing) return { holdId: existing, last4: digits.slice(-4), token: tok };
    const holdId = 'hold_' + crypto.randomBytes(8).toString('hex');
    this.holds.set(holdId, { amount: amountCents, state: 'held' }); this.byKey.set(idempotencyKey, holdId);
    return { holdId, last4: digits.slice(-4), token: tok };
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

/* ---------- AI: Google Gemini (api/src/gemini.ts) with the deterministic MockAi (api/src/ai.ts) as fallback ---------- */
export function makeAdapters() {
  return { payments: new MockVisaPayments() as Payments,
    network: process.env.NAC_API_KEY ? new NacNetwork(process.env.NAC_API_KEY) : new MockNetwork() as NetworkVerify,
    ai: process.env.GEMINI_API_KEY ? new GeminiAi(process.env.GEMINI_API_KEY) : new MockAi() as Ai };
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
