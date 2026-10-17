import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { Db } from './db.js';
import { Payments, NetworkVerify, Ai, PaymentError, Turnstile, makeTurnstile } from './adapters.js';
import { Storage, FsStorage, cardSvg } from './storage.js';
import { coverLevel, productAt, publicProduct, productsFor, syncCatalog } from './catalog.js';
import * as D from './domain.js';

export type Clock = { now(): Date; offsetMs: number };
export const makeClock = (): Clock => { const c: Clock = { offsetMs: 0, now: () => new Date(Date.now() + c.offsetMs) }; return c; };
const id = (p: string) => `${p}_${crypto.randomBytes(6).toString('hex')}`;
const tok = () => crypto.randomBytes(12).toString('base64url');
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const fail = (s: number, m: string): never => { throw new HttpError(s, m); };

export function createApp(deps: { db: Db; payments: Payments; network: NetworkVerify; ai: Ai; clock?: Clock; secret?: string; demo?: boolean; storage?: Storage; turnstile?: Turnstile; publicOrigin?: string; internalToken?: string; realtime?: { url: string; publicUrl: string; secret: string } }) {
  const { db, payments, network, ai } = deps;
  const storage = deps.storage ?? new FsStorage(); const turnstile = deps.turnstile ?? makeTurnstile();
  const PUBLIC_ORIGIN = (deps.publicOrigin ?? process.env.PUBLIC_ORIGIN ?? '').replace(/\/$/, '');
  const catalogReady = syncCatalog(storage).catch(e => console.warn('catalog sync failed', e));
  const human = async (req: Request) => { if (deps.internalToken && req.headers['x-internal-seed'] === deps.internalToken) return; if (!(await turnstile.verify(req.headers['x-turnstile-token'] as string | undefined, req.ip))) fail(403, 'Please complete the human check'); };
  const clock = deps.clock ?? makeClock();
  const SECRET = deps.secret ?? process.env.JWT_SECRET ?? 'dev-secret-change-me';
  const bus = new EventEmitter(); bus.setMaxListeners(1000);
  const rt = deps.realtime ?? (process.env.REALTIME_URL ? { url: process.env.REALTIME_URL, publicUrl: process.env.PUBLIC_REALTIME_URL ?? process.env.REALTIME_URL, secret: process.env.REALTIME_SECRET ?? 'dev-realtime-secret' } : undefined);
  // Fan-out: in-process SSE bus always; the Cloudflare Durable Object room too when configured (fire-and-forget, SSE/polling stay as fallback).
  const notify = (bid: string, type: string) => {
    const ev = { type, at: clock.now().toISOString() }; bus.emit(bid, ev);
    if (rt) fetch(`${rt.url}/room/${bid}/publish`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-realtime-secret': rt.secret }, body: JSON.stringify(ev), signal: AbortSignal.timeout(2000) }).catch(() => {});
  };
  const realtimeTicket = (bid: string, mid: string, name: string) => {
    const body = Buffer.from(JSON.stringify({ b: bid, m: mid, n: name, exp: Date.now() + 120_000 })).toString('base64url');
    return body + '.' + crypto.createHmac('sha256', rt!.secret).update(body).digest('base64url');
  };
  const app = express();
  app.use(express.json()); app.use(cookieParser());
  const h = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).then(r => { if (r !== undefined && !res.headersSent) res.json(r); }).catch(next);

  /* ---------- auth ---------- */
  const userOf = (req: Request): string | null => {
    const t = req.cookies?.bq ?? (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
    if (!t) return null; try { return (jwt.verify(t, SECRET) as any).sub; } catch { return null; }
  };
  const auth = (req: Request) => userOf(req) ?? fail(401, 'Please log in');
  const issue = (res: Response, uid: string) => { const t = jwt.sign({ sub: uid }, SECRET, { expiresIn: '7d' });
    res.cookie('bq', t, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 864e5 }); return t; };
  const pubUser = (u: any) => ({ id: u.id, email: u.is_guest ? null : u.email, name: u.name, phone: u.phone, phoneVerified: !!u.phone_verified_at, isGuest: !!u.is_guest });

  // Public sample gift for the landing page: a real recipe's real catalog products and cumulative tier prices (nothing invented).
  app.get('/api/catalog/featured', (_q, r) => { const rec = D.RECIPES.find(x => productsFor(x.title).length >= 3);
    if (!rec) return r.json({ gift: null });
    r.json({ gift: { title: rec.title, traits: rec.traits, products: productsFor(rec.title).map(p => publicProduct(p)), tiers: rec.tiers.map(t => t.threshold_cents) } }); });
  app.get('/api/health', (_q, r) => r.json({ ok: true, demo: !!(deps.demo ?? process.env.DEMO_MODE === '1'), turnstileSiteKey: turnstile.siteKey, storage: storage.provider, ai: ai.provider, network: network.provider, realtime: rt ? 'durable-object' : 'sse', now: clock.now() }));
  app.post('/api/auth/signup', h(async (req, res) => {
    const b = z.object({ email: z.string().email(), password: z.string().min(8, 'Password must be at least 8 characters'), name: z.string().min(1) }).parse(req.body);
    const email = b.email.toLowerCase();
    if ((await db.query('SELECT 1 FROM users WHERE email=$1', [email])).length) fail(409, 'An account with that email already exists');
    const uid = id('usr');
    await db.query('INSERT INTO users (id,email,password_hash,name) VALUES ($1,$2,$3,$4)', [uid, email, await bcrypt.hash(b.password, 10), b.name]);
    const token = issue(res, uid); const [u] = await db.query('SELECT * FROM users WHERE id=$1', [uid]);
    res.status(201); return { user: pubUser(u), token };
  }));
  app.post('/api/auth/login', h(async (req, res) => {
    const b = z.object({ email: z.string(), password: z.string() }).parse(req.body);
    const [u] = await db.query('SELECT * FROM users WHERE email=$1', [b.email.toLowerCase()]);
    if (!u || !(await bcrypt.compare(b.password, u.password_hash))) fail(401, 'Wrong email or password');
    return { user: pubUser(u), token: issue(res, u.id) };
  }));
  app.post('/api/auth/claim', h(async req => {
    const uid = auth(req); const b = z.object({ email: z.string().email(), password: z.string().min(8, 'Password must be at least 8 characters') }).parse(req.body);
    const [u] = await db.query('SELECT * FROM users WHERE id=$1', [uid]); if (!u) fail(401, 'Please log in');
    if (!u.is_guest) return { user: pubUser(u) };
    const email = b.email.toLowerCase();
    if ((await db.query('SELECT 1 FROM users WHERE email=$1 AND id<>$2', [email, uid])).length) fail(409, 'An account with that email already exists — log in instead');
    await db.query('UPDATE users SET email=$2, password_hash=$3, is_guest=false WHERE id=$1', [uid, email, await bcrypt.hash(b.password, 10)]);
    const [n] = await db.query('SELECT * FROM users WHERE id=$1', [uid]); return { user: pubUser(n) };
  }));
  app.post('/api/auth/logout', (_q, r) => { r.clearCookie('bq'); r.json({ ok: true }); });
  app.get('/api/auth/me', h(async req => { const [u] = await db.query('SELECT * FROM users WHERE id=$1', [auth(req)]); if (!u) fail(401, 'Please log in'); return { user: pubUser(u) }; }));

  /* ---------- helpers ---------- */
  const fundedCents = async (bid: string, q = db.query) => {
    const [r] = await q(`SELECT COALESCE(SUM(CASE type WHEN 'hold' THEN amount_cents WHEN 'release' THEN -amount_cents ELSE 0 END),0)::int AS held,
      COALESCE(SUM(CASE type WHEN 'capture' THEN amount_cents ELSE 0 END),0)::int AS captured FROM ledger_events WHERE bouquet_id=$1`, [bid]);
    return { held: Number(r.held), captured: Number(r.captured) };
  };
  const getBouquet = async (bid: string) => (await db.query('SELECT * FROM bouquets WHERE id=$1', [bid]))[0] ?? fail(404, 'Bouquet not found');
  const memberOf = async (bid: string, uid: string) => (await db.query('SELECT * FROM members WHERE bouquet_id=$1 AND user_id=$2', [bid, uid]))[0];
  const requireMember = async (bid: string, uid: string) => (await memberOf(bid, uid)) ?? fail(403, 'You are not part of this bouquet');
  const requireOrganizer = async (bid: string, uid: string) => { const b = await getBouquet(bid); if (b.organizer_id !== uid) fail(403, 'Only the organizer can do that'); return b; };
  const deadlinePassed = (b: any) => clock.now().getTime() > new Date(b.buy_by_at).getTime();

  async function state(bid: string, uid: string) {
    const b = await getBouquet(bid); const me = await requireMember(bid, uid);
    const members = await db.query('SELECT m.*, (SELECT COALESCE(SUM(amount_cents),0)::int FROM contributions c WHERE c.member_id=m.id AND c.status<>$2) AS pledged FROM members m WHERE bouquet_id=$1 ORDER BY joined_at', [bid, 'released']);
    const cards = await db.query('SELECT * FROM cards WHERE bouquet_id=$1 ORDER BY created_at', [bid]);
    const traits = await db.query(`SELECT t.*, (SELECT COUNT(*)::int FROM trait_picks p WHERE p.trait_id=t.id AND p.kept) AS kept,
      (SELECT COUNT(*)::int FROM trait_picks p WHERE p.trait_id=t.id AND NOT p.kept) AS discarded,
      (SELECT p.kept FROM trait_picks p WHERE p.trait_id=t.id AND p.member_id=$2) AS my_pick FROM traits t WHERE bouquet_id=$1 ORDER BY consensus DESC, label`, [bid, me.id]);
    const cardOwner = new Map(cards.map((c: any) => [c.id, c.member_id]));
    const candidates = await db.query(`SELECT c.*, (SELECT COUNT(*)::int FROM votes v WHERE v.candidate_id=c.id) AS votes FROM candidates c WHERE bouquet_id=$1 ORDER BY rare DESC, title`, [bid]);
    const myVote = (await db.query('SELECT candidate_id FROM votes WHERE bouquet_id=$1 AND member_id=$2', [bid, me.id]))[0]?.candidate_id ?? null;
    const tiers = await db.query('SELECT * FROM gift_tiers WHERE bouquet_id=$1 ORDER BY level', [bid]);
    const myContribs = await db.query('SELECT id,amount_cents,status,captured_cents,card_last4,created_at FROM contributions WHERE member_id=$1 ORDER BY created_at', [me.id]);
    const [meUser] = await db.query('SELECT is_guest FROM users WHERE id=$1', [uid]);
    const f = await fundedCents(bid);
    const total = b.status === 'purchased' || b.status === 'revealed' ? f.captured : f.held;
    const name = new Map(members.map((m: any) => [m.id, m.display_name]));
    // Checkout preview: exactly what lock() would do right now (same tier pick, same pro-rata allocation), so the UI can say who pays what.
    const previewTier = b.status === 'funding' ? D.highestFundedTier(tiers, f.held) : null;
    const liveHolds = previewTier ? await db.query(`SELECT id,member_id,amount_cents FROM contributions WHERE bouquet_id=$1 AND status='held' ORDER BY id`, [bid]) : [];
    const previewAlloc = previewTier ? D.allocateCapture(liveHolds, previewTier.threshold_cents) : new Map<string, number>();
    const myHolds = liveHolds.filter((h: any) => h.member_id === me.id);
    return {
      now: clock.now().toISOString(),
      bouquet: { id: b.id, recipientName: b.recipient_name, occasion: b.occasion, note: b.note, status: b.status, buyByAt: b.buy_by_at, shipBufferDays: b.ship_buffer_days,
        inviteToken: b.organizer_id === uid ? b.invite_token : null, inviteUrl: b.organizer_id === uid && PUBLIC_ORIGIN ? `${PUBLIC_ORIGIN}/join/${b.invite_token}` : null, revealToken: me.role === 'organizer' && ['purchased', 'revealed'].includes(b.status) ? b.reveal_token : null,
        chosenCandidateId: b.chosen_candidate_id, capturedTierId: b.captured_tier_id, capturedCents: b.captured_cents, isOrganizer: b.organizer_id === uid,
        deadlinePassed: deadlinePassed(b) },
      me: { id: me.id, isGuest: !!meUser?.is_guest, role: me.role, displayName: me.display_name, budgetMinCents: me.budget_min_cents, budgetMaxCents: me.budget_max_cents, networkVerified: me.network_verified,
        hasCard: cards.some((c: any) => c.member_id === me.id), vote: myVote, contributions: myContribs },
      members: members.map((m: any) => ({ id: m.id, displayName: m.display_name, role: m.role, networkVerified: m.network_verified, flowerBack: m.flower_back,
        hasCard: cards.some((c: any) => c.member_id === m.id), pledgedCents: Number(m.pledged), budgetMaxCents: m.budget_max_cents })),
      cards: cards.map((c: any) => ({ id: c.id, memberId: c.member_id, memberName: name.get(c.member_id), title: c.title, traits: c.traits, story: c.story,
        stats: D.orderStatsForTitle(c.stats ?? (c.traits as string[]).map(l => ({ label: l, count: 1 })), c.title), artUrl: c.art_key ? `/api/media/${c.art_key}` : null,
        flowerBack: members.find((m: any) => m.id === c.member_id)?.flower_back })),
      traits: traits.map((t: any) => { const friends = [...new Set((t.source_card_ids as string[]).map(c => name.get(cardOwner.get(c))).filter(Boolean))];
        return { id: t.id, label: t.label, consensus: t.consensus, level: t.consensus, sourceCardIds: t.source_card_ids, friends, rarity: D.rarity(t.consensus),
          keptCount: Number(t.kept), discardCount: Number(t.discarded), myPick: t.my_pick === null || t.my_pick === undefined ? null : (t.my_pick ? 'keep' : 'discard') }; }),
      candidates: candidates.map((c: any) => ({ id: c.id, product: publicProduct(productAt(c.title, c.cover_level ?? 1, c.trait_labels)), products: productsFor(c.title, c.trait_labels).map(p => publicProduct(p)), title: c.title, description: c.description, rare: c.rare, kind: c.kind, traits: c.trait_labels, votes: c.votes,
        citedCardIds: cards.filter((k: any) => (c.member_ids as string[]).includes(k.member_id) && (k.traits as string[]).some(t => (c.trait_labels as string[]).includes(t))).map((k: any) => k.id),
        citedFriends: (c.member_ids as string[]).map(x => name.get(x)).filter(Boolean) })),
      tiers: tiers.map((t: any) => ({ id: t.id, level: t.level, title: t.title, thresholdCents: t.threshold_cents, unlocked: t.threshold_cents <= total,
        product: (() => { const c = candidates.find((x: any) => x.id === t.candidate_id); return publicProduct(c ? productAt(c.title, t.level, c.trait_labels) : null); })() })),
      totals: { fundedCents: total, heldCents: f.held, capturedCents: f.captured,
        currentTier: D.highestFundedTier(tiers, total)?.id ?? null, nextTier: D.nextTier(tiers, total)?.id ?? null,
        checkout: previewTier ? { tierId: previewTier.id, tierLevel: previewTier.level, chargeCents: previewTier.threshold_cents, releaseCents: f.held - previewTier.threshold_cents,
          holders: new Set(liveHolds.map((h: any) => h.member_id)).size,
          myHeldCents: myHolds.reduce((a: number, h: any) => a + h.amount_cents, 0), myChargeCents: myHolds.reduce((a: number, h: any) => a + (previewAlloc.get(h.id) ?? 0), 0) } : null },
    };
  }

  /* ---------- bouquets ---------- */
  app.post('/api/bouquets', h(async (req, res) => {
    const uid = auth(req);
    const b = z.object({ recipientName: z.string().min(1), occasion: z.string().min(1), note: z.string().optional(), neededBy: z.string(),
      shipBufferDays: z.number().int().min(0).max(30).default(3), displayName: z.string().optional(), budgetMaxCents: z.number().int().min(100).default(5000) }).parse(req.body);
    const needed = new Date(b.neededBy); if (isNaN(+needed)) fail(400, 'Invalid date');
    const buyBy = new Date(needed.getTime() - b.shipBufferDays * 864e5);
    if (buyBy.getTime() <= clock.now().getTime()) fail(400, `With ${b.shipBufferDays} shipping days the buy-by date is already in the past`);
    const [u] = await db.query('SELECT * FROM users WHERE id=$1', [uid]);
    const bid = id('bq');
    await db.tx(async q => {
      await q('INSERT INTO bouquets (id,organizer_id,recipient_name,occasion,note,buy_by_at,ship_buffer_days,invite_token,reveal_token) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [bid, uid, b.recipientName, b.occasion, b.note ?? null, buyBy.toISOString(), b.shipBufferDays, tok(), tok()]);
      const mid = id('mem');
      await q('INSERT INTO members (id,bouquet_id,user_id,display_name,role,phone,network_verified,budget_max_cents,flower_back) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [mid, bid, uid, b.displayName ?? u.name, 'organizer', u.phone, !!u.phone_verified_at, b.budgetMaxCents, JSON.stringify(D.flowerBack(mid))]);
    });
    res.status(201); return state(bid, uid);
  }));
  app.get('/api/bouquets', h(async req => {
    const uid = auth(req);
    const rows = await db.query(`SELECT b.id,b.recipient_name,b.occasion,b.status,b.buy_by_at,m.role,(SELECT COUNT(*)::int FROM members x WHERE x.bouquet_id=b.id) AS members,
      c.title AS gift, c.trait_labels AS gift_traits, (SELECT level FROM gift_tiers t WHERE t.id=b.captured_tier_id) AS level
      FROM bouquets b JOIN members m ON m.bouquet_id=b.id AND m.user_id=$1 LEFT JOIN candidates c ON c.id=b.chosen_candidate_id ORDER BY b.created_at DESC`, [uid]);
    return { bouquets: rows.map((r: any) => { const p = r.gift ? publicProduct(productAt(r.gift, r.level ?? 1, r.gift_traits ?? [])) : null;
      return { id: r.id, recipientName: r.recipient_name, occasion: r.occasion, status: r.status, buyByAt: r.buy_by_at, role: r.role, members: r.members, gift: r.gift, photoUrl: p?.photoUrl ?? null, product: p }; }) };
  }));
  app.get('/api/bouquets/:id', h(async req => state(String(req.params.id), auth(req))));

  /* ---------- invite / join ---------- */
  app.get('/api/invite/:token', h(async req => {
    const [b] = await db.query('SELECT b.*, u.name AS organizer FROM bouquets b JOIN users u ON u.id=b.organizer_id WHERE invite_token=$1', [String(req.params.token)]);
    if (!b) fail(404, 'This invite link is not valid');
    const uid = userOf(req); const m = uid ? await memberOf(b.id, uid) : null;
    const [{ n }] = await db.query('SELECT COUNT(*)::int AS n FROM members WHERE bouquet_id=$1', [b.id]);
    return { bouquetId: b.id, recipientName: b.recipient_name, occasion: b.occasion, organizer: b.organizer, buyByAt: b.buy_by_at, status: b.status, members: n, alreadyMember: !!m };
  }));
  app.post('/api/join/:token', h(async (req, res) => {
    await human(req);
    const b = z.object({ displayName: z.string().min(1), phone: z.string().min(7), budgetMinCents: z.number().int().min(0).default(0), budgetMaxCents: z.number().int().min(100).default(5000) }).parse(req.body);
    let uid = userOf(req);
    if (b.budgetMinCents > b.budgetMaxCents) fail(400, 'Minimum budget cannot exceed maximum');
    const [bq] = await db.query('SELECT * FROM bouquets WHERE invite_token=$1', [String(req.params.token)]); if (!bq) fail(404, 'This invite link is not valid');
    if (!['collecting', 'fusing', 'funding'].includes(bq.status) || deadlinePassed(bq)) fail(409, 'This bouquet is closed to new friends');
    if (uid) { const existing = await memberOf(bq.id, uid); if (existing) return state(bq.id, uid); }
    const verified = await network.numberVerify(b.phone);
    if (!verified) fail(422, 'We could not verify that phone number with the network');
    if (!uid) { // guest join: name + phone only; the account is completed lazily at the hold step
      uid = id('usr');
      await db.query('INSERT INTO users (id,email,password_hash,name,is_guest) VALUES ($1,$2,$3,$4,true)', [uid, `guest_${uid}@guest.bouquet.gift`, await bcrypt.hash(tok(), 4), b.displayName]);
      issue(res, uid);
    }
    const mid = id('mem');
    await db.query('UPDATE users SET phone=$2, phone_verified_at=$3 WHERE id=$1', [uid, b.phone, clock.now().toISOString()]);
    await db.query('INSERT INTO members (id,bouquet_id,user_id,display_name,role,phone,network_verified,budget_min_cents,budget_max_cents,flower_back) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [mid, bq.id, uid, b.displayName, 'friend', b.phone, true, b.budgetMinCents, b.budgetMaxCents, JSON.stringify(D.flowerBack(mid))]);
    notify(bq.id, 'member_joined'); return state(bq.id, uid!);
  }));
  app.patch('/api/bouquets/:id/budget', h(async req => {
    const uid = auth(req); const m = await requireMember(String(req.params.id), uid);
    const b = z.object({ budgetMinCents: z.number().int().min(0), budgetMaxCents: z.number().int().min(100) }).parse(req.body);
    if (b.budgetMinCents > b.budgetMaxCents) fail(400, 'Minimum budget cannot exceed maximum');
    await db.query('UPDATE members SET budget_min_cents=$2, budget_max_cents=$3 WHERE id=$1', [m.id, b.budgetMinCents, b.budgetMaxCents]);
    notify(String(req.params.id), 'budget'); return state(String(req.params.id), uid);
  }));

  /* ---------- questionnaire cards ---------- */
  app.get('/api/bouquets/:id/questions', h(async req => {
    const m = await requireMember(String(req.params.id), auth(req));
    return { questions: D.drawQuestions(m.id).map(q => ({ id: q.id, kind: q.kind, prompt: q.prompt, options: q.options.map(o => o.label) })) };
  }));
  app.post('/api/bouquets/:id/cards', h(async (req, res) => {
    const uid = auth(req); const bq = await getBouquet(String(req.params.id)); const m = await requireMember(bq.id, uid);
    if (bq.status !== 'collecting') fail(409, 'Cards are closed — the group already fused');
    const b = z.object({ answers: z.record(z.string(), z.number().int().min(0).max(3)), story: z.string().max(400).optional() }).parse(req.body);
    const drawn = D.drawQuestions(m.id);
    for (const q of drawn) if (b.answers[q.id] === undefined) fail(400, `Please answer: ${q.prompt}`);
    for (const k of Object.keys(b.answers)) if (!drawn.some(q => q.id === k)) fail(400, 'Unexpected question');
    if ((await db.query('SELECT 1 FROM cards WHERE member_id=$1', [m.id])).length) fail(409, 'You already made your card');
    const traits = D.traitsFromAnswers(b.answers);
    const taken = (await db.query('SELECT title FROM cards WHERE bouquet_id=$1', [bq.id])).map((r: any) => r.title as string);
    let title = await ai.cardTitle(traits, b.story); if (taken.some(t => t.toLowerCase() === title.toLowerCase())) title = D.uniqueCardTitle(traits, taken);
    const story = b.story?.trim() ? await ai.polish(b.story.trim(), m.display_name) : null;
    const cardId = id('card'); const fb = m.flower_back;
    let artKey: string | null = null;
    try {
      const img = await ai.cardArt(`Whimsical watercolor trading-card illustration, soft floral palette, for a friend who is ${traits.join(', ')}. No text.`);
      if (img) { artKey = `cards/${cardId}.png`; await storage.put(artKey, img, 'image/png'); }
      else { artKey = `cards/${cardId}.svg`; await storage.put(artKey, Buffer.from(cardSvg(fb, title, traits)), 'image/svg+xml'); }
    } catch (e) { console.warn('card art failed', e); artKey = null; }
    await db.query('INSERT INTO cards (id,bouquet_id,member_id,answers,story,traits,title,stats,avoids,art_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [cardId, bq.id, m.id, JSON.stringify(b.answers), story, JSON.stringify(traits), title, JSON.stringify(D.traitStats(b.answers)), JSON.stringify(D.avoidsFromAnswers(b.answers)), artKey]);
    notify(bq.id, 'card'); res.status(201); return state(bq.id, uid);
  }));

  /* ---------- fusion + vote ---------- */
  app.post('/api/bouquets/:id/fuse', h(async req => {
    const uid = auth(req); const bq = await requireOrganizer(String(req.params.id), uid);
    if (bq.status !== 'collecting') fail(409, 'Already fused');
    const cards = await db.query('SELECT * FROM cards WHERE bouquet_id=$1', [bq.id]);
    if (cards.length < 2) fail(409, 'Fusion needs at least 2 friend cards');
    const agg = D.aggregateTraits(cards.map((c: any) => ({ id: c.id, memberId: c.member_id, traits: c.traits })));
    const cands = await ai.enrichCandidates(agg, { tags: cards.flatMap((c: any) => c.avoids ?? []), cards: cards.length });
    await db.tx(async q => {
      for (const t of agg) await q('INSERT INTO traits (id,bouquet_id,label,source_card_ids,consensus) VALUES ($1,$2,$3,$4,$5)', [id('trt'), bq.id, t.label, JSON.stringify(t.cardIds), t.memberIds.length]);
      const covers = new Set<string>(); // one photo per gift on the table (fuse() already prefers fresh heroes; this is the backstop)
      for (const c of cands) {
        const cid = id('cand'); const cover = coverLevel(c.title, c.traits, covers); const u = productAt(c.title, cover ?? 1, c.traits)?.url; if (u) covers.add(u);
        await q('INSERT INTO candidates (id,bouquet_id,title,description,rare,trait_labels,member_ids,kind,cover_level) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [cid, bq.id, c.title, c.description, c.rare, JSON.stringify(c.traits), JSON.stringify(c.memberIds), c.kind, cover]);
        for (const [i, t] of c.tiers.entries()) await q('INSERT INTO gift_tiers (id,bouquet_id,candidate_id,level,title,threshold_cents) VALUES ($1,$2,$3,$4,$5,$6)', [id('tier'), bq.id, cid, i + 1, t.title, t.threshold_cents]);
      }
      await q(`UPDATE bouquets SET status='fusing' WHERE id=$1`, [bq.id]);
    });
    notify(bq.id, 'fused'); return state(bq.id, uid);
  }));
  app.post('/api/bouquets/:id/vote', h(async req => {
    const uid = auth(req); const bq = await getBouquet(String(req.params.id)); const m = await requireMember(bq.id, uid);
    if (bq.status !== 'fusing') fail(409, 'Voting is closed');
    const { candidateId } = z.object({ candidateId: z.string() }).parse(req.body);
    if (!(await db.query('SELECT 1 FROM candidates WHERE id=$1 AND bouquet_id=$2', [candidateId, bq.id])).length) fail(404, 'Unknown gift');
    await db.query('INSERT INTO votes (bouquet_id,member_id,candidate_id) VALUES ($1,$2,$3) ON CONFLICT (bouquet_id,member_id) DO UPDATE SET candidate_id=EXCLUDED.candidate_id', [bq.id, m.id, candidateId]);
    notify(bq.id, 'vote'); return state(bq.id, uid);
  }));
  app.post('/api/bouquets/:id/choose', h(async req => {
    const uid = auth(req); const bq = await requireOrganizer(String(req.params.id), uid);
    if (bq.status !== 'fusing') fail(409, 'Not in voting stage');
    let cid = req.body?.candidateId as string | undefined;
    if (!cid) cid = (await db.query(`SELECT c.id FROM candidates c LEFT JOIN votes v ON v.candidate_id=c.id WHERE c.bouquet_id=$1 GROUP BY c.id, c.rare, c.title ORDER BY COUNT(v.member_id) DESC, c.rare DESC, c.title LIMIT 1`, [bq.id]))[0]?.id;
    if (!cid || !(await db.query('SELECT 1 FROM candidates WHERE id=$1 AND bouquet_id=$2', [cid, bq.id])).length) fail(404, 'Unknown gift');
    await db.tx(async q => {
      await q('DELETE FROM gift_tiers WHERE bouquet_id=$1 AND candidate_id<>$2', [bq.id, cid]);
      await q(`UPDATE bouquets SET status='funding', chosen_candidate_id=$2 WHERE id=$1`, [bq.id, cid]);
    });
    notify(bq.id, 'chosen'); return state(bq.id, uid);
  }));


  /* ---------- deck: keep / discard / undo / fuse hand ---------- */
  const traitIn = async (bid: string, tid: string) => (await db.query('SELECT * FROM traits WHERE id=$1 AND bouquet_id=$2', [tid, bid]))[0] ?? fail(404, 'Unknown card');
  app.post('/api/bouquets/:id/picks', h(async req => {
    const uid = auth(req); const bq = await getBouquet(String(req.params.id)); const m = await requireMember(bq.id, uid);
    if (bq.status !== 'fusing') fail(409, 'The deck is closed');
    const b = z.object({ traitId: z.string(), keep: z.boolean() }).parse(req.body); await traitIn(bq.id, b.traitId);
    await db.query('INSERT INTO trait_picks (bouquet_id,member_id,trait_id,kept) VALUES ($1,$2,$3,$4) ON CONFLICT (member_id,trait_id) DO UPDATE SET kept=EXCLUDED.kept, at=now()', [bq.id, m.id, b.traitId, b.keep]);
    notify(bq.id, 'pick'); return state(bq.id, uid);
  }));
  app.delete('/api/bouquets/:id/picks/:traitId', h(async req => {
    const uid = auth(req); const bq = await getBouquet(String(req.params.id)); const m = await requireMember(bq.id, uid);
    if (bq.status !== 'fusing') fail(409, 'The deck is closed');
    await db.query('DELETE FROM trait_picks WHERE member_id=$1 AND trait_id=$2', [m.id, String(req.params.traitId)]);
    notify(bq.id, 'pick'); return state(bq.id, uid);
  }));
  app.post('/api/bouquets/:id/fuse-hand', h(async (req, res) => {
    const uid = auth(req); const bq = await getBouquet(String(req.params.id)); const m = await requireMember(bq.id, uid);
    if (bq.status !== 'fusing') fail(409, 'The deck is closed');
    const { traitIds } = z.object({ traitIds: z.array(z.string()).length(2) }).parse(req.body);
    const ts = [];
    for (const tid of traitIds) {
      const t = await traitIn(bq.id, tid);
      const [p] = await db.query('SELECT kept FROM trait_picks WHERE member_id=$1 AND trait_id=$2', [m.id, tid]);
      if (!p?.kept) fail(409, `Keep ${t.label} in your hand before fusing it`);
      const [{ k }] = await db.query('SELECT COUNT(*)::int AS k FROM trait_picks WHERE trait_id=$1 AND kept', [tid]);
      const owners = await db.query('SELECT DISTINCT member_id FROM cards WHERE id = ANY($1::text[])', [t.source_card_ids]);
      ts.push({ label: t.label, support: Math.max(t.consensus, Number(k)), memberIds: owners.map((o: any) => o.member_id) });
    }
    const r = D.fusePair(ts[0], ts[1]); if (!r.ok) fail(409, r.reason);
    const onTable = await db.query('SELECT title, trait_labels, cover_level FROM candidates WHERE bouquet_id=$1', [bq.id]);
    const covers = new Set(onTable.map((x: any) => productAt(x.title, x.cover_level ?? 1, x.trait_labels)?.url).filter(Boolean) as string[]);
    const c = D.preferFreshHero((r as any).candidate, covers);
    const cover = coverLevel(c.title, c.traits, covers); // both traits' heroes already on the table? lead with another product from this box
    const cid = await db.tx(async q => {
      const [ex] = await q('SELECT id FROM candidates WHERE bouquet_id=$1 AND title=$2', [bq.id, c.title]);
      let id_ = ex?.id;
      if (!id_) { id_ = id('cand');
        await q('INSERT INTO candidates (id,bouquet_id,title,description,rare,trait_labels,member_ids,kind,cover_level) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id_, bq.id, c.title, c.description, c.rare, JSON.stringify(c.traits), JSON.stringify(c.memberIds), c.rare ? 'rare' : 'match', cover]);
        for (const [i, t] of c.tiers.entries()) await q('INSERT INTO gift_tiers (id,bouquet_id,candidate_id,level,title,threshold_cents) VALUES ($1,$2,$3,$4,$5,$6)', [id('tier'), bq.id, id_, i + 1, t.title, t.threshold_cents]); }
      await q('INSERT INTO votes (bouquet_id,member_id,candidate_id) VALUES ($1,$2,$3) ON CONFLICT (bouquet_id,member_id) DO UPDATE SET candidate_id=EXCLUDED.candidate_id', [bq.id, m.id, id_]);
      return id_;
    });
    notify(bq.id, 'fused-hand'); res.status(201); return { ...(await state(bq.id, uid)), fusedCandidateId: cid };
  }));

  /* ---------- contributions (card holds) ---------- */
  app.post('/api/bouquets/:id/contributions', h(async (req, res) => {
    const uid = auth(req); const bq = await getBouquet(String(req.params.id)); const m = await requireMember(bq.id, uid);
    const b = z.object({ amountCents: z.number().int().min(100), cardNumber: z.string(), idempotencyKey: z.string().min(8) }).parse(req.body);
    if ((await db.query('SELECT is_guest FROM users WHERE id=$1', [uid]))[0]?.is_guest) fail(403, 'Save your account (email + password) before placing a hold');
    const dup = (await db.query('SELECT * FROM contributions WHERE idempotency_key=$1', [b.idempotencyKey]))[0];
    if (dup) { if (dup.member_id !== m.id) fail(409, 'Idempotency key reuse'); return state(bq.id, uid); }
    if (bq.status !== 'funding') fail(409, 'Funding is not open');
    if (deadlinePassed(bq)) fail(409, 'The buy-by deadline has passed');
    const [{ s }] = await db.query(`SELECT COALESCE(SUM(amount_cents),0)::int AS s FROM contributions WHERE member_id=$1 AND status='held'`, [m.id]);
    if (Number(s) + b.amountCents > m.budget_max_cents) fail(400, `That would exceed your budget of $${(m.budget_max_cents / 100).toFixed(2)}`);
    if (b.amountCents >= D.SIM_SWAP_HOLD_THRESHOLD_CENTS && m.phone && await network.simSwappedRecently(m.phone)) fail(423, 'Your SIM was changed recently — large holds are paused for your safety');
    await human(req);
    let hold; try { hold = await payments.hold({ amountCents: b.amountCents, cardNumber: b.cardNumber, idempotencyKey: b.idempotencyKey }); }
    catch (e) { if (e instanceof PaymentError) fail(402, e.message); throw e; }
    await db.tx(async q => {
      const [cur] = await q('SELECT status FROM bouquets WHERE id=$1 FOR UPDATE', [bq.id]);
      if (cur.status !== 'funding') { await payments.release(hold!.holdId); fail(409, 'Funding just closed'); }
      const cid = id('ctb');
      await q(`INSERT INTO contributions (id,bouquet_id,member_id,amount_cents,hold_id,status,card_last4,idempotency_key) VALUES ($1,$2,$3,$4,$5,'held',$6,$7)`, [cid, bq.id, m.id, b.amountCents, hold!.holdId, hold!.last4, b.idempotencyKey]);
      await q(`INSERT INTO ledger_events (bouquet_id,contribution_id,type,amount_cents) VALUES ($1,$2,'hold',$3)`, [bq.id, cid, b.amountCents]);
    });
    notify(bq.id, 'contribution'); res.status(201); return state(bq.id, uid);
  }));

  /* ---------- lock: capture at highest funded tier, release the rest ---------- */
  async function lock(bid: string) {
    const members = await db.query(`SELECT DISTINCT m.phone, m.display_name FROM members m JOIN contributions c ON c.member_id=m.id WHERE m.bouquet_id=$1 AND c.status='held'`, [bid]);
    for (const m of members) if (m.phone && await network.simSwappedRecently(m.phone)) fail(423, `${m.display_name}'s SIM changed recently; ask them to re-verify before checkout`);
    return db.tx(async q => {
      const [b] = await q('SELECT * FROM bouquets WHERE id=$1 FOR UPDATE', [bid]);
      if (b.status === 'purchased' || b.status === 'revealed') return { already: true };
      if (b.status !== 'funding') fail(409, 'Not in funding stage');
      if (deadlinePassed(b)) fail(409, 'The buy-by deadline has passed');
      const tiers = await q('SELECT * FROM gift_tiers WHERE bouquet_id=$1', [bid]);
      const { held } = await fundedCents(bid, q);
      const tier = D.highestFundedTier(tiers, held); if (!tier) fail(409, 'Not funded yet — the first tier is not reached');
      const holds = await q(`SELECT * FROM contributions WHERE bouquet_id=$1 AND status='held' ORDER BY id FOR UPDATE`, [bid]);
      const alloc = D.allocateCapture(holds, tier.threshold_cents);
      for (const hd of holds) {
        const amt = alloc.get(hd.id) ?? 0;
        if (amt > 0) { await payments.capture(hd.hold_id, amt);
          await q(`UPDATE contributions SET status='captured', captured_cents=$2 WHERE id=$1`, [hd.id, amt]);
          await q(`INSERT INTO ledger_events (bouquet_id,contribution_id,type,amount_cents) VALUES ($1,$2,'capture',$3)`, [bid, hd.id, amt]); }
        else { await payments.release(hd.hold_id); await q(`UPDATE contributions SET status='released' WHERE id=$1`, [hd.id]); }
        if (hd.amount_cents - amt > 0) await q(`INSERT INTO ledger_events (bouquet_id,contribution_id,type,amount_cents) VALUES ($1,$2,'release',$3)`, [bid, hd.id, hd.amount_cents - amt]);
      }
      await q(`UPDATE bouquets SET status='purchased', captured_tier_id=$2, captured_cents=$3 WHERE id=$1`, [bid, tier.id, tier.threshold_cents]);
      return { already: false };
    });
  }
  app.post('/api/bouquets/:id/lock', h(async req => {
    const uid = auth(req); await requireOrganizer(String(req.params.id), uid);
    await lock(String(req.params.id)); notify(String(req.params.id), 'purchased'); return state(String(req.params.id), uid);
  }));

  /* ---------- deadline sweep ---------- */
  async function sweep() {
    const due = await db.query(`SELECT id FROM bouquets WHERE status IN ('collecting','fusing','funding') AND buy_by_at < $1`, [clock.now().toISOString()]);
    for (const { id: bid } of due) {
      await db.tx(async q => {
        const [b] = await q('SELECT * FROM bouquets WHERE id=$1 FOR UPDATE', [bid]);
        if (!['collecting', 'fusing', 'funding'].includes(b.status)) return;
        for (const hd of await q(`SELECT * FROM contributions WHERE bouquet_id=$1 AND status='held' FOR UPDATE`, [bid])) {
          await payments.release(hd.hold_id); await q(`UPDATE contributions SET status='released' WHERE id=$1`, [hd.id]);
          await q(`INSERT INTO ledger_events (bouquet_id,contribution_id,type,amount_cents) VALUES ($1,$2,'release',$3)`, [bid, hd.id, hd.amount_cents]);
        }
        await q(`UPDATE bouquets SET status='expired' WHERE id=$1`, [bid]);
      });
      notify(bid, 'expired');
    }
    return due.length;
  }

  /* ---------- recipient reveal (public by token) ---------- */
  async function revealPayload(token: string) {
    const [b] = await db.query('SELECT * FROM bouquets WHERE reveal_token=$1', [token]); if (!b) fail(404, 'This bouquet link is not valid');
    if (!['purchased', 'revealed'].includes(b.status)) fail(409, 'This bouquet is still being arranged');
    const cards = await db.query('SELECT c.*, m.display_name, m.flower_back FROM cards c JOIN members m ON m.id=c.member_id WHERE c.bouquet_id=$1 ORDER BY c.created_at', [b.id]);
    const [cand] = await db.query('SELECT * FROM candidates WHERE id=$1', [b.chosen_candidate_id]);
    const [tier] = await db.query('SELECT * FROM gift_tiers WHERE id=$1', [b.captured_tier_id]);
    const tiers = await db.query('SELECT * FROM gift_tiers WHERE candidate_id=$1 AND level<=$2 ORDER BY level', [cand.id, tier.level]);
    const flips = await db.query('SELECT DISTINCT card_index FROM reveal_events WHERE bouquet_id=$1', [b.id]);
    const names = cards.map((c: any) => c.display_name);
    return { bouquetId: b.id, recipientName: b.recipient_name, occasion: b.occasion, note: b.note, status: b.status, from: names,
      cards: cards.map((c: any) => ({ friend: c.display_name, title: c.title, traits: c.traits, compliments: (c.traits as string[]).map(D.compliment), story: c.story, flowerBack: c.flower_back,
        stats: c.stats ? D.orderStatsForTitle(c.stats, c.title) : c.stats, artUrl: c.art_key ? `/api/media/${c.art_key}` : null })),
      gift: { title: cand.title, description: cand.description, rare: cand.rare, traits: cand.trait_labels, compliments: (cand.trait_labels as string[]).map(D.compliment), includes: tiers.map((t: any) => t.title), tierLevel: tier.level,
        products: tiers.map((t: any) => publicProduct(productAt(cand.title, t.level, cand.trait_labels))).filter(Boolean), product: publicProduct(productAt(cand.title, tier.level, cand.trait_labels)),
        tracking: 'BQ' + b.id.slice(-8).toUpperCase() },
      flipped: flips.map((f: any) => f.card_index), totalCards: cards.length + 1 };
  }
  app.get('/api/reveal/:token', h(async req => revealPayload(String(req.params.token))));
  app.post('/api/reveal/:token/flip', h(async req => {
    const p = await revealPayload(String(req.params.token));
    const { index } = z.object({ index: z.number().int().min(0) }).parse(req.body);
    if (index === 0) await human(req);
    if (index >= p.totalCards) fail(400, 'No such card');
    await db.query('INSERT INTO reveal_events (bouquet_id,card_index) VALUES ($1,$2)', [p.bouquetId, index]);
    if (index === p.totalCards - 1) await db.query(`UPDATE bouquets SET status='revealed' WHERE id=$1 AND status='purchased'`, [p.bouquetId]);
    notify(p.bouquetId, 'flip'); return revealPayload(String(req.params.token));
  }));

  app.get(/^\/api\/media\/(.+)$/, h(async (req, res) => {
    await catalogReady;
    const key = (req.params as any)[0] as string; if (key.includes('..')) fail(400, 'bad key');
    const o = await storage.get(key); if (!o) fail(404, 'Not found');
    res.set({ 'content-type': o!.type, 'cache-control': 'public, max-age=86400' }).send(o!.body);
  }));

  /* ---------- live updates ---------- */
  app.get('/api/bouquets/:id/realtime', h(async req => {
    const m: any = await requireMember(String(req.params.id), auth(req));
    if (!rt) return { mode: 'sse', url: null };
    return { mode: 'websocket', url: `${rt.publicUrl.replace(/^http/, 'ws')}/room/${m.bouquet_id}/ws?ticket=${encodeURIComponent(realtimeTicket(m.bouquet_id, m.id, m.display_name))}` };
  }));
  app.get('/api/bouquets/:id/stream', async (req, res, next) => {
    try { await requireMember(String(req.params.id), auth(req)); } catch (e) { return next(e); }
    res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }); res.flushHeaders();
    const send = (e: any) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    send({ type: 'hello' }); bus.on(String(req.params.id), send);
    const ka = setInterval(() => res.write(': ka\n\n'), 15000);
    req.on('close', () => { clearInterval(ka); bus.off(String(req.params.id), send); });
  });

  /* ---------- demo fake clock ---------- */
  if (deps.demo ?? process.env.DEMO_MODE === '1') {
    app.post('/api/dev/clock', h(async req => { clock.offsetMs = Number(req.body?.offsetMs ?? 0); const n = await sweep(); return { now: clock.now(), offsetMs: clock.offsetMs, expired: n }; }));
    app.post('/api/dev/simswap', h(async req => {
      const uid = auth(req); const bid = z.object({ bouquetId: z.string(), on: z.boolean().default(true) }).parse(req.body);
      const m = await requireMember(bid.bouquetId, uid); if (!m.phone) fail(400, 'No phone on file');
      if (!(network as any).markSwapped) fail(400, 'Only available with the mock network');
      (network as any).markSwapped(m.phone, bid.on); return { phone: m.phone, swapped: bid.on };
    }));
    app.post('/api/dev/sweep', h(async () => ({ expired: await sweep() })));
  }

  app.use((err: any, _req: Request, res: Response, _n: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') });
    console.error(err); res.status(500).json({ error: 'Something went wrong' });
  });
  return { app, sweep, lock, clock };
}
