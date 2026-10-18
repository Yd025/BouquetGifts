import crypto from 'node:crypto';
import { GeminiAi } from './gemini.js';
import { NacNetwork } from './nac.js';
import { MockAi, type Ai } from './ai.js';
export { MockAi, GeminiAi }; export type { Ai };
import { traitsFromAnswers, fuse as mockFuse, cardTitle as mockTitle, TraitAgg } from './domain.js';

/* ---------- Payments (mock Visa sandbox; swap for a real processor) ---------- */
/** The browser tokenizes the card (tok_… + last4); a card number never reaches this server. */
export const CARD_TOKEN = /^v?tok_[A-Za-z0-9_]{12,}$/; // vtok_ = saved before browser tokenization
export interface Payments { hold(a: { amountCents: number; token: string; last4: string; idempotencyKey: string }): Promise<{ holdId: string; last4: string; token: string }>;
  capture(holdId: string, amountCents: number): Promise<void>; release(holdId: string): Promise<void>;
  /** Single-use virtual card locked to one merchant for an exact amount (Visa virtual card / Intelligent Commerce in production). */
  /** Refresh an authorization before it lapses (~7 days). */
  reauthorize?(holdId: string, amountCents: number): Promise<{ holdId: string } | void>;
  issueVirtualCard?(a: { amountCents: number; merchant: string; idempotencyKey: string }): Promise<{ cardId: string; last4: string }> }
export class MockVisaPayments implements Payments {
  holds = new Map<string, { amount: number; state: string }>(); byKey = new Map<string, string>();
  /** Sandbox: accepts only a browser-made token plus last4 (like a network token). The 0002 test card declines. */
  async hold({ amountCents, token, last4, idempotencyKey }: { amountCents: number; token: string; last4: string; idempotencyKey: string }) {
    if (!CARD_TOKEN.test(String(token)) || !/^\d{4}$/.test(String(last4))) throw new PaymentError('Card could not be read, please re-enter it');
    if (last4 === '0002') throw new PaymentError('Card declined (insufficient funds)');
    const existing = this.byKey.get(idempotencyKey);
    if (existing) return { holdId: existing, last4, token };
    const holdId = 'hold_' + crypto.randomBytes(8).toString('hex');
    this.holds.set(holdId, { amount: amountCents, state: 'held' }); this.byKey.set(idempotencyKey, holdId);
    return { holdId, last4, token };
  }
  async capture(holdId: string, amountCents: number) { const h = this.holds.get(holdId); if (h) { if (amountCents > h.amount) throw new PaymentError('over-capture'); h.state = 'captured'; } }
  async release(holdId: string) { const h = this.holds.get(holdId); if (h) h.state = 'released'; }
  /** A fresh authorization for the same amount (new hold id); the old one is let go. declineReauth simulates a card that can't renew. */
  declineReauth = false;
  async reauthorize(holdId: string, amountCents: number) { const h = this.holds.get(holdId); if (this.declineReauth) throw new PaymentError('Card declined the renewed hold');
    if (h) h.state = 'released'; const nid = 'hold_' + crypto.randomBytes(8).toString('hex'); this.holds.set(nid, { amount: amountCents, state: 'held' }); return { holdId: nid }; }
  cards = new Map<string, { amount: number; merchant: string }>();
  async issueVirtualCard({ amountCents, merchant, idempotencyKey }: { amountCents: number; merchant: string; idempotencyKey: string }) {
    const h = crypto.createHash('sha256').update('vcard|' + idempotencyKey).digest('hex');
    const cardId = 'vcard_' + h.slice(0, 16); this.cards.set(cardId, { amount: amountCents, merchant });
    return { cardId, last4: String(parseInt(h.slice(16, 24), 16) % 10000).padStart(4, '0') };
  }
}
export class PaymentError extends Error {}

/* ---------- T-Mobile network APIs (CAMARA via Nokia Network-as-Code style) ---------- */
export interface NetworkVerify { numberVerify(phone: string): Promise<boolean>; simSwappedRecently(phone: string, maxAgeHours?: number): Promise<boolean>; provider: string }
export class MockNetwork implements NetworkVerify {
  provider = 'mock-camara'; swapped = new Set<string>();
  async numberVerify(phone: string) { return /^\+?\d{10,15}$/.test(phone.replace(/[\s()-]/g, '')) && !phone.endsWith('0000'); }
  async simSwappedRecently(phone: string) { return phone.endsWith('9999') || phone.replace(/[\s()-]/g, '') === '+99999991000' || this.swapped.has(phone); } // mirrors Nokia's simulator number
  /** Demo only: simulate a SIM swap on this number. */
  markSwapped(phone: string, on = true) { on ? this.swapped.add(phone) : this.swapped.delete(phone); }
}
/* ---------- AI: Google Gemini (api/src/gemini.ts) with the deterministic MockAi (api/src/ai.ts) as fallback ---------- */
/** NAC_RAPIDAPI_KEY (NAC_API_KEY still accepted). Read from the environment only. */
export const nacKey = () => process.env.NAC_RAPIDAPI_KEY || process.env.NAC_API_KEY || null;
export function makeAdapters() {
  return { payments: new MockVisaPayments() as Payments,
    network: nacKey() ? new NacNetwork(nacKey()!) as NetworkVerify : new MockNetwork() as NetworkVerify,
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
