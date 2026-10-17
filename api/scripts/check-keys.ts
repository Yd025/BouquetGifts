/**
 * 3 PM key drop-in check: `npm run check:keys` (or `docker compose exec api npm run check:keys`).
 * Read-only probes; never prints secrets. Each service falls back to its mock when its key is missing.
 */
import fs from 'node:fs'; import https from 'node:https';
const mask = (v?: string) => (v ? `set (${v.length} chars)` : 'not set → mock');
const out: [string, string][] = [];

async function xai() {
  const k = process.env.XAI_API_KEY; if (!k) return out.push(['Grok (xAI)', mask(k)]);
  const r = await fetch('https://api.x.ai/v1/models', { headers: { authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(8000) }).catch(e => ({ ok: false, status: e.message } as any));
  out.push(['Grok (xAI)', r.ok ? `OK · chat model ${process.env.XAI_MODEL ?? 'grok-3-mini'}, image model ${process.env.XAI_IMAGE_MODEL ?? 'grok-2-image'}` : `FAILED (${r.status})`]);
}
async function visa() {
  const { VISA_USER_ID: u, VISA_PASSWORD: p, VISA_CERT_PATH: c, VISA_KEY_PATH: k, VISA_CA_PATH: ca } = process.env;
  if (!u || !p || !c || !k) return out.push(['Visa sandbox', 'not set → MockVisaPayments']);
  const base = new URL(process.env.VISA_BASE_URL ?? 'https://sandbox.api.visa.com');
  const res = await new Promise<string>(resolve => {
    const req = https.request({ host: base.host, path: '/vdp/helloworld', method: 'GET', cert: fs.readFileSync(c), key: fs.readFileSync(k), ca: ca ? fs.readFileSync(ca) : undefined,
      headers: { authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64'), accept: 'application/json' }, timeout: 10000 },
      r => { r.resume(); resolve(r.statusCode === 200 ? 'OK · two-way TLS + basic auth accepted (/vdp/helloworld)' : `FAILED (HTTP ${r.statusCode})`); });
    req.on('error', e => resolve(`FAILED (${e.message})`)); req.end();
  });
  out.push(['Visa sandbox', res]);
}
async function nac() {
  const k = process.env.NAC_API_KEY; if (!k) return out.push(['Nokia Network-as-Code', mask(k)]);
  const base = process.env.NAC_BASE_URL ?? 'https://network-as-code.p-eu.rapidapi.com';
  // Number Verify on Nokia's documented simulator number; any HTTP answer other than 401/403 means the key is accepted.
  const r = await fetch(base + '/passthrough/camara/v1/sim-swap/sim-swap/v0/check', { method: 'POST', headers: { 'content-type': 'application/json', 'x-rapidapi-key': k, 'x-rapidapi-host': new URL(base).host },
    body: JSON.stringify({ phoneNumber: process.env.NAC_TEST_PHONE ?? '+99999991000', maxAge: 240 }), signal: AbortSignal.timeout(8000) }).catch(e => ({ ok: false, status: e.message } as any));
  out.push(['Nokia Network-as-Code', r.ok ? 'OK · SIM Swap check answered' : [401, 403].includes(r.status) ? `KEY REJECTED (${r.status})` : `reachable, HTTP ${r.status} (check NAC_TEST_PHONE / subscription)`]);
}
await Promise.all([xai(), visa(), nac()]);
for (const [k, v] of out) console.log(`${k.padEnd(24)} ${v}`);
