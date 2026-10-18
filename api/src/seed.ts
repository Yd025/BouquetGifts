import bcrypt from 'bcryptjs';
import { Db } from './db.js';
import { QUESTIONS } from './domain.js';
export const DEMO_USERS = [
  { id: 'usr_demo', email: 'demo@bouquet.gift', name: 'Adelin', password: 'bouquet123' },
  { id: 'usr_maya', email: 'maya@bouquet.gift', name: 'Maya', password: 'bouquet123' },
  { id: 'usr_jon', email: 'jon@bouquet.gift', name: 'Jon', password: 'bouquet123' },
  { id: 'usr_priya', email: 'priya@bouquet.gift', name: 'Priya', password: 'bouquet123' },
  { id: 'usr_sam', email: 'sam@bouquet.gift', name: 'Sam', password: 'bouquet123' },
];
export async function seed(db: Db) {
  for (const q of QUESTIONS) await db.query('INSERT INTO questions (id,kind,prompt,options) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING', [q.id, q.kind, q.prompt, JSON.stringify(q.options)]);
  for (const u of DEMO_USERS) await db.query('INSERT INTO users (id,email,password_hash,name) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING', [u.id, u.email, await bcrypt.hash(u.password, 10), u.name]);
}

/** Distinct, first-person memories, one per seeded friend. */
export const DEMO_MEMORIES: Record<string, string> = {
  jon: 'I still think about the morning we hiked Mt. Si in the dark and you pulled a tiny pour-over kit out of your backpack at the summit.',
  priya: 'You lent me your old film camera for my trip to Lisbon and made me promise to shoot one roll of only strangers smiling. I did.',
  sam: 'Every road trip, I drive and you DJ. You have never once let me pick a song, and honestly you were right every time.',
};
/** Builds a ready-to-play demo bouquet through the public API so all business rules apply. Idempotent. */
export async function seedDemoBouquet(base: string, internalToken = '') {
  const login = async (email: string) => { const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'bouquet123' }) });
    return (r.headers.get('set-cookie') ?? '').split(';')[0]; };
  const call = async (cookie: string, path: string, body?: any) => { const r = await fetch(base + '/api' + path, { method: body ? 'POST' : 'GET', headers: { cookie, 'content-type': 'application/json', 'x-internal-seed': internalToken }, body: body ? JSON.stringify(body) : undefined });
    const j: any = await r.json(); if (!r.ok) throw new Error(path + ': ' + j.error); return j; };
  const org = await login('demo@bouquet.gift');
  const existing = (await call(org, '/bouquets')).bouquets.find((b: any) => b.recipientName === 'Maya');
  if (existing && existing.members >= 4) return;
  // Reuse (repair) a partially seeded demo bouquet instead of creating a duplicate.
  const b = existing ? (await call(org, `/bouquets/${existing.id}`)).bouquet : (await call(org, '/bouquets', { recipientName: 'Maya', occasion: 'Birthday', note: 'Maya turns 25! Demo bouquet: add your own card, then fuse.', neededBy: new Date(Date.now() + 14 * 864e5).toISOString(), shipBufferDays: 3, budgetMaxCents: 8000 })).bouquet;
  const picks: Record<string, string[]> = { jon: ['Sunrise Hiker', 'Coffee Snob'], priya: ['Film Shooter', 'Sunrise Hiker'], sam: ['Music Head', 'Film Shooter'] };
  // Jon uses Nokia's "no SIM swap" simulator number, so his large holds pass a live Network as Code check.
  for (const [i, who] of ['jon', 'priya', 'sam'].entries()) {
    const c = await login(`${who}@bouquet.gift`);
    await call(c, `/join/${b.inviteToken}`, { displayName: who[0].toUpperCase() + who.slice(1), phone: i === 0 ? '+99999991001' : `+1206555020${i}`, budgetMaxCents: 6000 });
    const st = await call(c, `/bouquets/${b.id}`); if (st.me.hasCard) continue;
    const qs = (await call(c, `/bouquets/${b.id}/questions`)).questions;
    const answers = Object.fromEntries(qs.map((q: any) => { const full = QUESTIONS.find(x => x.id === q.id)!; const k = full.options.findIndex(o => o.trait && picks[who].includes(o.trait));
      return [q.id, q.id === 's4' ? 3 : Math.max(0, k)]; }));
    await call(c, `/bouquets/${b.id}/cards`, { answers, story: DEMO_MEMORIES[who] });
  }
  console.log('Seeded demo bouquet for Maya:', b.id);
}
