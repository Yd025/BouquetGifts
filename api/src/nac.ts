/**
 * T-Mobile / CAMARA checks through Nokia Network as Code (RapidAPI gateway), with MockNetwork as the silent fallback.
 * - SIM Swap check: LIVE when NAC_RAPIDAPI_KEY is set (POST /passthrough/camara/v1/sim-swap/sim-swap/v0/check).
 * - Number Verification: stays on the mock. CAMARA Number Verification needs a device-side 3-legged OAuth flow over mobile data
 *   (or an Android TS.43 token), which a web join form can't do, so we don't pretend.
 * Simulator numbers documented by Nokia: +99999991000 → "SIM swap has occurred", +99999991001 → "no SIM swap".
 * The key is only ever sent as the X-RapidAPI-Key header; it is never logged.
 */
import { MockNetwork } from './adapters.js';
import type { NetworkVerify } from './adapters.js';

export const NAC_DEFAULT_BASE = 'https://network-as-code.p-eu.rapidapi.com';
export const NAC_DEFAULT_HOST = 'network-as-code.nokia.rapidapi.com';
export const NAC_SIM_SWAPPED = '+99999991000';
export const NAC_SIM_NOT_SWAPPED = '+99999991001';
export const SIM_SWAP_PATH = '/passthrough/camara/v1/sim-swap/sim-swap/v0/check';

export type NacStatus = { simSwap: 'live' | 'mock'; numberVerify: 'mock'; lastSimSwap: null | { at: string; ok: boolean; status: number | string } };

export class NacNetwork implements NetworkVerify {
  provider = 'nokia-nac';
  /** Fallback + demo controls (markSwapped) live on the mock. */
  mock = new MockNetwork();
  status: NacStatus = { simSwap: 'live', numberVerify: 'mock', lastSimSwap: null };
  constructor(private key: string, private opts: { base?: string; host?: string; fetch?: typeof fetch; timeoutMs?: number } = {}) {}
  get base() { return (this.opts.base ?? process.env.NAC_BASE_URL ?? NAC_DEFAULT_BASE).replace(/\/$/, ''); }
  get host() { return this.opts.host ?? process.env.NAC_RAPIDAPI_HOST ?? NAC_DEFAULT_HOST; }
  async post(path: string, body: unknown): Promise<{ status: number; json: any }> {
    const f = this.opts.fetch ?? fetch;
    const r = await f(this.base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'X-RapidAPI-Key': this.key, 'X-RapidAPI-Host': this.host },
      body: JSON.stringify(body), signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5000) });
    return { status: r.status, json: await r.json().catch(() => null) };
  }
  /** Number Verify: mock only (see header). */
  async numberVerify(phone: string) { return this.mock.numberVerify(phone); }
  markSwapped(phone: string, on = true) { this.mock.markSwapped(phone, on); }
  async simSwappedRecently(phone: string, maxAgeHours = 240) {
    if (this.mock.swapped.has(phone)) return true; // demo drawer toggle
    const phoneNumber = phone.replace(/[\s()-]/g, '');
    try {
      const r = await this.post(SIM_SWAP_PATH, { phoneNumber, maxAge: Math.min(2400, Math.max(1, Math.round(maxAgeHours))) });
      this.status.lastSimSwap = { at: new Date().toISOString(), ok: r.status === 200 && typeof r.json?.swapped === 'boolean', status: r.status };
      if (r.status === 200 && typeof r.json?.swapped === 'boolean') return r.json.swapped;
      throw new Error(`NaC SIM swap HTTP ${r.status}`);
    } catch (e) {
      if (!this.status.lastSimSwap || this.status.lastSimSwap.ok) this.status.lastSimSwap = { at: new Date().toISOString(), ok: false, status: (e as Error).name === 'TimeoutError' ? 'timeout' : (e as Error).message.slice(0, 60) };
      console.warn('nac sim-swap fell back to mock:', this.status.lastSimSwap.status);
      return this.mock.simSwappedRecently(phone);
    }
  }
}
