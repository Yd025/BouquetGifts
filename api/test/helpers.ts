import { expect } from 'vitest';
import request from 'supertest';
import os from 'node:os'; import path from 'node:path';
import { makeDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { createApp, makeClock } from '../src/app.js';
import { FsStorage } from '../src/storage.js';
import { MockNetwork, MockVisaPayments } from '../src/adapters.js';

/** A whole bouquet at the funding stage (2 friends with cards, a gift chosen), using any AI adapter. */
export async function fundingBouquet(ai: any) {
  const db = await makeDb('memory'); await seed(db);
  const ctx = createApp({ db, payments: new MockVisaPayments(), network: new MockNetwork(), ai, clock: makeClock(), demo: true, secret: 't', storage: new FsStorage(path.join(os.tmpdir(), 'bq-br-' + Math.random())) });
  const ag = async (name: string) => { const a = request.agent(ctx.app); await a.post('/api/auth/signup').send({ email: `${name}${Math.random()}@x.io`, password: 'password1', name }); return a; };
  const org = await ag('Org');
  const b = (await org.post('/api/bouquets').send({ recipientName: 'Maya', occasion: 'Birthday', neededBy: new Date(Date.now() + 10 * 864e5).toISOString(), shipBufferDays: 3 })).body.bouquet;
  const friends = [];
  for (let i = 0; i < 2; i++) { const f = await ag('F' + i); await f.post(`/api/join/${b.inviteToken}`).send({ displayName: 'Friend' + i, phone: '+1206555010' + i, budgetMaxCents: 20000 });
    const qs = (await f.get(`/api/bouquets/${b.id}/questions`)).body.questions;
    expect((await f.post(`/api/bouquets/${b.id}/cards`).send({ answers: Object.fromEntries(qs.map((q: any) => [q.id, 0])) })).status).toBe(201); friends.push(f); }
  const fused = (await org.post(`/api/bouquets/${b.id}/fuse`)).body;
  return { ctx, org, friends, b, fused, choose: async () => (await org.post(`/api/bouquets/${b.id}/choose`).send({ candidateId: fused.candidates[0].id })).body };
}

