/**
 * 3 PM key drop-in check: `npm run check:keys` (or `docker compose exec api npm run check:keys`).
 * Read-only probes; never prints secrets. Each service falls back to its mock when its key is missing.
 */
import fs from 'node:fs'; import https from 'node:https';
const mask = (v?: string) => (v ? `set (${v.length} chars)` : 'not set → mock');
const out: [string, string][] = [];

async function gemini() {
  const k = process.env.GEMINI_API_KEY; if (!k) return out.push(['Gemini', mask(k)]);
  const want = { text: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash', image: process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image', tts: process.env.GEMINI_TTS_MODEL ?? 'gemini-2.5-flash-preview-tts' };
  // Key goes in the header, never the URL, so it cannot leak into logs.
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': k }, signal: AbortSignal.timeout(8000) }).catch(e => ({ ok: false, status: e.message } as any));
  if (!r.ok) return out.push(['Gemini', [400, 401, 403].includes(r.status) ? `KEY REJECTED (${r.status})` : `FAILED (${r.status})`]);
  const names = new Set(((await r.json()).models ?? []).map((m: any) => String(m.name).replace(/^models\//, '')));
  const missing = Object.entries(want).filter(([, m]) => !names.has(m)).map(([k2, m]) => `${k2}=${m}`);
  out.push(['Gemini', missing.length ? `KEY OK, but model(s) not available: ${missing.join(', ')}` : `OK · text ${want.text}, image ${want.image}, tts ${want.tts}`]);
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
await Promise.all([gemini(), visa(), nac()]);
for (const [k, v] of out) console.log(`${k.padEnd(24)} ${v}`);
