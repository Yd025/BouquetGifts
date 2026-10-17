// Integration test against a running `wrangler dev` (local workerd + Durable Object).
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import WebSocket from 'ws';
const BASE = process.env.RT_URL ?? 'http://127.0.0.1:8787'; const SECRET = process.env.RT_SECRET ?? 'dev-realtime-secret';
const ticket = (b, m, n, exp = Date.now() + 60000, secret = SECRET) => { const body = Buffer.from(JSON.stringify({ b, m, n, exp })).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url'); };
const open = (url) => new Promise((res, rej) => { const ws = new WebSocket(url); const msgs = []; ws.on('message', d => msgs.push(JSON.parse(d.toString())));
  ws.on('open', () => res({ ws, msgs })); ws.on('unexpected-response', (_q, r) => rej(new Error('HTTP ' + r.statusCode))); ws.on('error', rej); });
const wsUrl = (id, t) => BASE.replace('http', 'ws') + `/room/${id}/ws?ticket=${encodeURIComponent(t)}`;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
describe('Durable Object live room', () => {
  it('fans out a published event to every socket in the room, and only that room', async () => {
    const id = 'bq_test' + Date.now();
    const a = await open(wsUrl(id, ticket(id, 'm1', 'Jon'))), b = await open(wsUrl(id, ticket(id, 'm2', 'Priya')));
    const other = await open(wsUrl(id + 'x', ticket(id + 'x', 'm3', 'Sam')));
    await wait(200);
    const r = await fetch(`${BASE}/room/${id}/publish`, { method: 'POST', headers: { 'x-realtime-secret': SECRET, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'vote' }) });
    expect((await r.json()).delivered).toBe(2);
    await wait(300);
    for (const c of [a, b]) expect(c.msgs.some(m => m.type === 'vote' && m.via === 'durable-object')).toBe(true);
    expect(other.msgs.some(m => m.type === 'vote')).toBe(false);
    expect(a.msgs.some(m => m.type === 'presence' && m.online.includes('Priya'))).toBe(true);
    [a, b, other].forEach(c => c.ws.close());
  });
  it('rejects bad tickets and unauthenticated publishes', async () => {
    const id = 'bq_bad' + Date.now();
    await expect(open(wsUrl(id, ticket(id, 'm', 'X', Date.now() + 60000, 'wrong-secret')))).rejects.toThrow('401');
    await expect(open(wsUrl(id, ticket('other-room', 'm', 'X')))).rejects.toThrow('401');
    await expect(open(wsUrl(id, ticket(id, 'm', 'X', Date.now() - 1000)))).rejects.toThrow('401');
    expect((await fetch(`${BASE}/room/${id}/publish`, { method: 'POST', body: '{}' })).status).toBe(403);
  });
});
