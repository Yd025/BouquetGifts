import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http from 'node:http'; import crypto from 'node:crypto'; import os from 'node:os'; import path from 'node:path';
import { makeDb } from '../src/db.js';
import { MockAi, MockNetwork, MockVisaPayments } from '../src/adapters.js';
import { createApp, makeClock } from '../src/app.js';
import { seed } from '../src/seed.js';
import { FsStorage } from '../src/storage.js';

// A stand-in for the Durable Object worker: records what the API publishes.
let srv: http.Server, got: { url: string; secret: string; body: any }[] = [], app: any, base = '';
beforeAll(async () => {
  srv = http.createServer((q, s) => { let b = ''; q.on('data', c => (b += c)); q.on('end', () => { got.push({ url: q.url!, secret: String(q.headers['x-realtime-secret']), body: JSON.parse(b || '{}') }); s.end('{"delivered":1}'); }); });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r())); base = `http://127.0.0.1:${(srv.address() as any).port}`;
  const db = await makeDb('memory'); await seed(db);
  app = createApp({ db, payments: new MockVisaPayments(), network: new MockNetwork(), ai: new MockAi(), clock: makeClock(), demo: true, secret: 't',
    storage: new FsStorage(path.join(os.tmpdir(), 'bq-rt-' + Date.now())), realtime: { url: base, publicUrl: 'http://localhost:8787', secret: 'rt-secret' } }).app;
});
afterAll(() => srv.close());
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('Durable Object live room wiring', () => {
  it('issues a signed member ticket and publishes every room event to the worker', async () => {
    const org = request.agent(app);
    expect((await org.post('/api/auth/signup').send({ email: `o${Math.random()}@x.io`, password: 'password1', name: 'Org' })).status).toBe(201);
    const b = (await org.post('/api/bouquets').send({ recipientName: 'Maya', occasion: 'Birthday', neededBy: new Date(Date.now() + 10 * 864e5).toISOString(), shipBufferDays: 3 })).body.bouquet;
    expect((await request(app).get('/api/health')).body.realtime).toBe('durable-object');

    const rt = (await org.get(`/api/bouquets/${b.id}/realtime`)).body;
    expect(rt.mode).toBe('websocket');
    const u = new URL(rt.url); expect(u.protocol).toBe('ws:'); expect(u.pathname).toBe(`/room/${b.id}/ws`);
    const [body, sig] = u.searchParams.get('ticket')!.split('.');
    expect(crypto.createHmac('sha256', 'rt-secret').update(body).digest('base64url')).toBe(sig);
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString()); expect(claims.b).toBe(b.id); expect(claims.exp).toBeGreaterThan(Date.now());

    const f = request.agent(app);
    await f.post('/api/auth/signup').send({ email: `f${Math.random()}@x.io`, password: 'password1', name: 'F' });
    expect((await f.post(`/api/join/${b.inviteToken}`).send({ displayName: 'Jon', phone: '+12065550101', budgetMaxCents: 5000 })).status).toBe(200);
    await wait(100);
    const ev = got.find(g => g.url === `/room/${b.id}/publish` && g.body.type === 'member_joined');
    expect(ev?.secret).toBe('rt-secret');
    // outsiders cannot get a ticket
    const x = request.agent(app); await x.post('/api/auth/signup').send({ email: `x${Math.random()}@x.io`, password: 'password1', name: 'X' });
    expect((await x.get(`/api/bouquets/${b.id}/realtime`)).status).toBe(403);
  });
  it('falls back to SSE when no worker is configured', async () => {
    const db = await makeDb('memory'); await seed(db);
    const a = createApp({ db, payments: new MockVisaPayments(), network: new MockNetwork(), ai: new MockAi(), secret: 't', storage: new FsStorage(path.join(os.tmpdir(), 'bq-rt2')) }).app;
    expect((await request(a).get('/api/health')).body.realtime).toBe('sse');
  });
});
