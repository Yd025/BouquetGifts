import { describe, it, expect } from 'vitest';
import { NacNetwork, NAC_SIM_SWAPPED, NAC_SIM_NOT_SWAPPED } from '../src/nac.js';
import { makeAdapters, MockNetwork } from '../src/adapters.js';

function fakeNac(reply: (body: any) => { status?: number; json?: any } | 'throw') {
  const calls: { url: string; headers: any; body: any }[] = [];
  const f = (async (url: string, init: any) => { const body = JSON.parse(init.body); calls.push({ url, headers: init.headers, body });
    const r = reply(body); if (r === 'throw') throw new TypeError('fetch failed');
    return { status: r.status ?? 200, json: async () => r.json } as any; }) as unknown as typeof fetch;
  return { f, calls };
}
// live-shape responses from Nokia's documented simulator: +99999991000 swapped, +99999991001 not swapped
const simulator = (b: any) => ({ json: { swapped: b.phoneNumber === NAC_SIM_SWAPPED } });

describe('Nokia Network as Code SIM Swap (live shape, mocked HTTP)', () => {
  it('calls the CAMARA SIM Swap check through RapidAPI with key + host headers and reads `swapped`', async () => {
    const { f, calls } = fakeNac(simulator);
    const nac = new NacNetwork('test-key', { fetch: f });
    expect(await nac.simSwappedRecently(NAC_SIM_SWAPPED)).toBe(true);
    expect(await nac.simSwappedRecently(NAC_SIM_NOT_SWAPPED, 72)).toBe(false);
    expect(calls[0].url).toBe('https://network-as-code.p-eu.rapidapi.com/passthrough/camara/v1/sim-swap/sim-swap/v0/check');
    expect(calls[0].headers['X-RapidAPI-Key']).toBe('test-key'); expect(calls[0].headers['X-RapidAPI-Host']).toBe('network-as-code.nokia.rapidapi.com');
    expect(calls[0].url).not.toContain('test-key');
    expect(calls[0].body).toEqual({ phoneNumber: NAC_SIM_SWAPPED, maxAge: 240 }); expect(calls[1].body.maxAge).toBe(72);
    expect(nac.status.lastSimSwap?.ok).toBe(true); expect(nac.status).toMatchObject({ simSwap: 'live', numberVerify: 'mock' });
  });
  it('falls back to the mock silently on network errors, HTTP errors and odd bodies', async () => {
    for (const reply of [() => 'throw' as const, () => ({ status: 429, json: { message: 'Too many requests' } }), () => ({ status: 403, json: { message: 'You are not subscribed' } }), () => ({ json: { unexpected: 1 } })]) {
      const nac = new NacNetwork('k', { fetch: fakeNac(reply).f });
      expect(await nac.simSwappedRecently('+12065550101')).toBe(false); // mock: not swapped
      expect(await nac.simSwappedRecently('+12065559999')).toBe(true);  // mock: the 9999 demo number is swapped
      expect(await nac.simSwappedRecently(NAC_SIM_SWAPPED)).toBe(true); // mock mirrors Nokia's simulator number
      expect(nac.status.lastSimSwap?.ok).toBe(false);
    }
  });
  it('keeps the demo drawer toggle working and Number Verify on the mock (needs a device-side OAuth flow)', async () => {
    const { f, calls } = fakeNac(simulator); const nac = new NacNetwork('k', { fetch: f });
    nac.markSwapped(NAC_SIM_NOT_SWAPPED); expect(await nac.simSwappedRecently(NAC_SIM_NOT_SWAPPED)).toBe(true); expect(calls).toHaveLength(0);
    expect(await nac.numberVerify('+12065550101')).toBe(true); expect(await nac.numberVerify('+12065550000')).toBe(false); expect(calls).toHaveLength(0);
  });
  it('uses NaC only when NAC_RAPIDAPI_KEY is set', () => {
    const old = { a: process.env.NAC_RAPIDAPI_KEY, b: process.env.NAC_API_KEY };
    delete process.env.NAC_RAPIDAPI_KEY; delete process.env.NAC_API_KEY; expect(makeAdapters().network).toBeInstanceOf(MockNetwork);
    process.env.NAC_RAPIDAPI_KEY = 'x'; expect(makeAdapters().network.provider).toBe('nokia-nac');
    if (old.a === undefined) delete process.env.NAC_RAPIDAPI_KEY; else process.env.NAC_RAPIDAPI_KEY = old.a; if (old.b !== undefined) process.env.NAC_API_KEY = old.b;
  });
});
