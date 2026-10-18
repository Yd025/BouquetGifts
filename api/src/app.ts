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
import { seedDemoBouquet } from './seed.js';
import { coverLevel, productAt, publicProduct, productsFor, syncCatalog } from './catalog.js';
import * as D from './domain.js';
import * as B from './bridge.js';
const money = B.money;

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
  app.get('/api/health', (_q, r) => r.json({ ok: true, demo: !!(deps.demo ?? process.env.DEMO_MODE === '1'), turnstileSiteKey: turnstile.siteKey, storage: storage.provider, ai: ai.provider, network: network.provider, networkChecks: (network as any).status ? { simSwap: (network as any).status.simSwap, numberVerify: (network as any).status.numberVerify, lastSimSwapOk: (network as any).status.lastSimSwap?.ok ?? null } : { simSwap: 'mock', numberVerify: 'mock', lastSimSwapOk: null }, realtime: rt ? 'durable-object' : 'sse', now: clock.now() }));
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
  const getBouquet = async (bid: string) => (await db.query('SELECT * FROM bouquets WHERE id=$1', [bid]))[0] ?? fail(404, 'Gift not found');
  const memberOf = async (bid: string, uid: string) => (await db.query('SELECT * FROM members WHERE bouquet_id=$1 AND user_id=$2', [bid, uid]))[0];
  const requireMember = async (bid: string, uid: string) => (await memberOf(bid, uid)) ?? fail(403, 'You’re not part of this gift');
  const requireOrganizer = async (bid: string, uid: string) => { const b = await getBouquet(bid); if (b.organizer_id !== uid) fail(403, 'Only the organizer can do that'); return b; };
  const deadlinePassed = (b: any) => clock.now().getTime() > new Date(b.buy_by_at).getTime();

  /** One source for "your share": held = every hold you placed, charged = what was captured (or is being captured), back = the rest. */
  const myReceipt = (rows: any[]) => { const heldCents = rows.reduce((a, c) => a + c.amount_cents, 0);
    const chargedCents = rows.filter(c => c.status === 'captured' || c.status === 'capture_pending').reduce((a, c) => a + (c.captured_cents ?? 0), 0);
    return { heldCents, chargedCents, backCents: heldCents - chargedCents }; };
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
    // Two holders: an exact group total would let each work out the other's private amount. Show tier progress instead.
    const holderIds = b.status === 'funding' ? new Set((await db.query(`SELECT DISTINCT member_id FROM contributions WHERE bouquet_id=$1 AND status='held'`, [bid])).map((r: any) => r.member_id)) : new Set();
    // With one or two people holding, any total would reveal someone's amount, so everyone (organizer included) sees only funded items.
    const blurred = b.status === 'funding' && holderIds.size > 0 && holderIds.size <= 2;
    const shownTotal = blurred ? (D.highestFundedTier(tiers, total)?.threshold_cents ?? 0) : total;
    return {
      now: clock.now().toISOString(),
      bouquet: { id: b.id, recipientName: b.recipient_name, occasion: b.occasion, note: b.note, status: b.status, cancelled: !!b.cancelled_at, buyByAt: b.buy_by_at, shipBufferDays: b.ship_buffer_days,
        inviteToken: b.organizer_id === uid ? b.invite_token : null, inviteUrl: b.organizer_id === uid && PUBLIC_ORIGIN ? `${PUBLIC_ORIGIN}/join/${b.invite_token}` : null, vcards: ['purchased', 'revealed'].includes(b.status) && b.vcards ? (typeof b.vcards === 'string' ? JSON.parse(b.vcards) : b.vcards).map(({ cardId: _c, ...c }: any) => c) : null, revealToken: me.role === 'organizer' && ['purchased', 'revealed'].includes(b.status) ? b.reveal_token : null, revealUrl: me.role === 'organizer' && ['purchased', 'revealed'].includes(b.status) && PUBLIC_ORIGIN ? `${PUBLIC_ORIGIN}/reveal/${b.reveal_token}` : null,
        chosenCandidateId: b.chosen_candidate_id, capturedTierId: b.captured_tier_id, capturedCents: b.captured_cents, isOrganizer: b.organizer_id === uid,
        deadlinePassed: deadlinePassed(b) },
      me: { id: me.id, isGuest: !!meUser?.is_guest, role: me.role, displayName: me.display_name, budgetMinCents: me.budget_min_cents, budgetMaxCents: me.budget_max_cents, payday: me.payday ? new Date(me.payday).toISOString().slice(0, 10) : null, networkVerified: me.network_verified,
        hasCard: cards.some((c: any) => c.member_id === me.id), vote: myVote, contributions: myContribs, receipt: myReceipt(myContribs) },
      members: members.map((m: any) => ({ id: m.id, displayName: m.display_name, role: m.role, networkVerified: m.network_verified, flowerBack: m.flower_back,
        hasCard: cards.some((c: any) => c.member_id === m.id), holding: Number(m.pledged) > 0 })), // never another friend's amount or cap
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
      totals: { fundedCents: shownTotal, heldCents: blurred ? shownTotal : f.held, capturedCents: f.captured, blurred,
        currentTier: D.highestFundedTier(tiers, total)?.id ?? null, nextTier: D.nextTier(tiers, total)?.id ?? null,
        checkout: previewTier ? { tierId: previewTier.id, tierLevel: previewTier.level, chargeCents: previewTier.threshold_cents, releaseCents: blurred ? null : f.held - previewTier.threshold_cents,
          holders: new Set(liveHolds.map((h: any) => h.member_id)).size,
          myHeldCents: myHolds.reduce((a: number, h: any) => a + h.amount_cents, 0), atMost: blurred,
          myChargeCents: blurred ? null : myHolds.reduce((a: number, h: any) => a + (previewAlloc.get(h.id) ?? 0), 0) } : null },
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
    const rows = await db.query(`SELECT b.id,b.recipient_name,b.occasion,b.status,b.buy_by_at,b.cancelled_at,m.role,(SELECT COUNT(*)::int FROM members x WHERE x.bouquet_id=b.id) AS members,
      c.title AS gift, c.trait_labels AS gift_traits, (SELECT level FROM gift_tiers t WHERE t.id=b.captured_tier_id) AS level
      FROM bouquets b JOIN members m ON m.bouquet_id=b.id AND m.user_id=$1 LEFT JOIN candidates c ON c.id=b.chosen_candidate_id ORDER BY b.created_at DESC`, [uid]);
    return { bouquets: rows.map((r: any) => { const p = r.gift ? publicProduct(productAt(r.gift, r.level ?? 1, r.gift_traits ?? [])) : null;
      return { id: r.id, recipientName: r.recipient_name, occasion: r.occasion, status: r.status, cancelled: !!r.cancelled_at, buyByAt: r.buy_by_at, role: r.role, members: r.members, gift: r.gift, photoUrl: p?.photoUrl ?? null, product: p }; }) };
  }));
  app.get('/api/bouquets/:id', h(async req => state(String(req.params.id), auth(req))));

  /* ---------- invite / join ---------- */
  app.get('/api/invite/:token', h(async req => {
    const [b] = await db.query('SELECT b.*, u.name AS organizer FROM bouquets b JOIN users u ON u.id=b.organizer_id WHERE invite_token=$1', [String(req.params.token)]);
    if (!b) fail(404, 'This invite link is not valid');
    const uid = userOf(req); const m = uid ? await memberOf(b.id, uid) : null;
    const [{ n }] = await db.query('SELECT COUNT(*)::int AS n FROM members WHERE bouquet_id=$1', [b.id]);
    // Funding already open: the invite leads with the money ask (gift, price, how many are in), so a friend can chip in from one screen.
    let gift = null;
    if (b.status === 'funding' && b.chosen_candidate_id) {
      const [c] = await db.query('SELECT * FROM candidates WHERE id=$1', [b.chosen_candidate_id]);
      const tiers = await db.query('SELECT level,title,threshold_cents FROM gift_tiers WHERE bouquet_id=$1 ORDER BY level', [b.id]);
      const [{ h: holders }] = await db.query(`SELECT COUNT(DISTINCT member_id)::int AS h FROM contributions WHERE bouquet_id=$1 AND status='held'`, [b.id]);
      const p = c ? publicProduct(productAt(c.title, 1, c.trait_labels)) : null;
      gift = { title: c?.title ?? 'the gift', photoUrl: p?.photoUrl ?? null, startCents: tiers[0]?.threshold_cents ?? 0, topCents: tiers[tiers.length - 1]?.threshold_cents ?? 0,
        tiers: tiers.map((t: any) => ({ level: t.level, title: t.title.replace(/^\+ /, ''), thresholdCents: t.threshold_cents })), holders: Number(holders) };
    }
    return { bouquetId: b.id, recipientName: b.recipient_name, occasion: b.occasion, organizer: b.organizer, buyByAt: b.buy_by_at, shipBufferDays: b.ship_buffer_days, status: b.status, members: n, alreadyMember: !!m, gift };
  }));
  app.post('/api/join/:token', h(async (req, res) => {
    await human(req);
    const b = z.object({ displayName: z.string().min(1), phone: z.string().min(7), budgetMinCents: z.number().int().min(0).default(0), budgetMaxCents: z.number().int().min(100).default(5000),
      // optional one-screen chip-in: join and place the hold in one step (one human check), as a guest; an account is optional afterwards
      hold: z.object({ amountCents: z.number().int().min(100), cardNumber: z.string(), idempotencyKey: z.string().min(8) }).optional() }).parse(req.body);
    let uid = userOf(req);
    if (b.budgetMinCents > b.budgetMaxCents) fail(400, 'Minimum budget cannot exceed maximum');
    const [bq] = await db.query('SELECT * FROM bouquets WHERE invite_token=$1', [String(req.params.token)]); if (!bq) fail(404, 'This invite link is not valid');
    if (!['collecting', 'fusing', 'funding'].includes(bq.status) || deadlinePassed(bq)) fail(409, 'This gift isn’t taking new friends anymore');
    const holdFor = async (memberId: string) => { if (!b.hold) return;
      if (bq.status !== 'funding') fail(409, 'Chipping in opens once the group picks the gift');
      const [m] = await db.query('SELECT * FROM members WHERE id=$1', [memberId]);
      const dup = (await db.query('SELECT member_id FROM contributions WHERE idempotency_key=$1', [b.hold.idempotencyKey]))[0];
      if (dup) { if (dup.member_id !== memberId) fail(409, 'Idempotency key reuse'); return; }
      if (b.budgetMaxCents > m.budget_max_cents) await db.query('UPDATE members SET budget_max_cents=$2 WHERE id=$1', [memberId, b.budgetMaxCents]), m.budget_max_cents = b.budgetMaxCents;
      await placeHold(bq, m, b.hold.amountCents, { cardNumber: b.hold.cardNumber }, b.hold.idempotencyKey); };
    if (uid) { const existing = await memberOf(bq.id, uid); if (existing) { await holdFor(existing.id); return state(bq.id, uid); } }
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
    notify(bq.id, 'member_joined');
    await holdFor(mid);
    return state(bq.id, uid!);
  }));
  app.patch('/api/bouquets/:id/budget', h(async req => {
    const uid = auth(req); const m = await requireMember(String(req.params.id), uid);
    const b = z.object({ budgetMinCents: z.number().int().min(0), budgetMaxCents: z.number().int().min(100), payday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      condition: z.object({ tierId: z.string(), baseCents: z.number().int().min(0) }).nullable().optional() }).parse(req.body);
    if (b.budgetMinCents > b.budgetMaxCents) fail(400, 'Minimum budget cannot exceed maximum');
    await db.query('UPDATE members SET budget_min_cents=$2, budget_max_cents=$3 WHERE id=$1', [m.id, b.budgetMinCents, b.budgetMaxCents]);
    if (b.payday !== undefined) await db.query('UPDATE members SET payday=$2 WHERE id=$1', [m.id, b.payday]); // optional, private: lets Bouquet schedule a top-up after payday
    if (b.condition !== undefined) { // "or $40 if it gets us the Polaroid": the part above baseCents is only for that tier (or higher)
      if (b.condition && !(await db.query('SELECT 1 FROM gift_tiers WHERE id=$1 AND bouquet_id=$2', [b.condition.tierId, m.bouquet_id])).length) fail(400, 'That item isn’t part of this gift');
      if (b.condition && b.condition.baseCents > b.budgetMaxCents) fail(400, 'The unconditional part cannot exceed your maximum');
      await db.query('UPDATE members SET condition_tier_id=$2, condition_base_cents=$3 WHERE id=$1', [m.id, b.condition?.tierId ?? null, b.condition?.baseCents ?? null]); }
    notify(String(req.params.id), 'budget'); return state(String(req.params.id), uid);
  }));

  /* ---------- questionnaire cards ---------- */
  app.get('/api/bouquets/:id/questions', h(async req => {
    const m = await requireMember(String(req.params.id), auth(req));
    return { questions: D.drawQuestions(m.id).map(q => ({ id: q.id, kind: q.kind, prompt: q.prompt, options: q.options.map(o => o.label) })) };
  }));
  app.post('/api/bouquets/:id/cards', h(async (req, res) => {
    const uid = auth(req); const bq = await getBouquet(String(req.params.id)); const m = await requireMember(bq.id, uid);
    // Late joiners (after the money ask) can still add a card: it won't change the chosen gift, but it goes in the reveal.
    if (!['collecting', 'fusing', 'funding'].includes(bq.status)) fail(409, 'Cards are closed — the gift was already bought');
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
    // The SVG card art is written now so minting stays instant; Gemini art (if configured) replaces it in the background.
    let artKey: string | null = `cards/${cardId}.svg`;
    try { await storage.put(artKey, Buffer.from(cardSvg(fb, title, traits)), 'image/svg+xml'); } catch (e) { console.warn('card art failed', e); artKey = null; }
    await db.query('INSERT INTO cards (id,bouquet_id,member_id,answers,story,traits,title,stats,avoids,art_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [cardId, bq.id, m.id, JSON.stringify(b.answers), story, JSON.stringify(traits), title, JSON.stringify(D.traitStats(b.answers)), JSON.stringify(D.avoidsFromAnswers(b.answers)), artKey]);
    notify(bq.id, 'card');
    artJobs.set(cardId, generateCardArt(bq.id, cardId, traits, fb).finally(() => artJobs.delete(cardId)));
    res.status(201); return state(bq.id, uid);
  }));

  /** Gemini card art, cached in storage (R2 or local) under cards/<id>.<ext>; the SVG stays if generation fails. */
  const artJobs = new Map<string, Promise<void>>();
  async function generateCardArt(bid: string, cardId: string, traits: string[], fb: any) {
    try {
      const palette = [fb?.petalColor, fb?.bgColor, fb?.centerColor].filter(Boolean).join(', ');
      const img = await ai.cardArt(`Whimsical watercolor trading-card illustration in a soft floral style${palette ? ` using the colours ${palette}` : ''}, portrait composition, for a friend who is ${traits.join(', ')}. Show symbols of those traits woven into flowers. No text, no letters, no borders.`);
      if (!img) return;
      const ext = img.type === 'image/jpeg' ? 'jpg' : img.type === 'image/webp' ? 'webp' : 'png';
      const key = `cards/${cardId}.${ext}`;
      await storage.put(key, img.body, img.type);
      await db.query('UPDATE cards SET art_key=$1 WHERE id=$2', [key, cardId]);
      notify(bid, 'card-art');
    } catch (e) { console.warn('card art generation failed', (e as Error).message); }
  }

  /* ---------- fusion + vote ---------- */
  app.post('/api/bouquets/:id/fuse', h(async req => {
    const uid = auth(req); const bq = await requireOrganizer(String(req.params.id), uid);
    if (bq.status !== 'collecting') fail(409, 'The cards are already turned over');
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
    // The organizer can break a tie, but can't pick a gift the group voted against.
    const tally = await db.query(`SELECT c.id, COUNT(v.member_id)::int AS n FROM candidates c LEFT JOIN votes v ON v.candidate_id=c.id WHERE c.bouquet_id=$1 GROUP BY c.id`, [bq.id]);
    const top = Math.max(0, ...tally.map((t: any) => Number(t.n))); const mine = Number(tally.find((t: any) => t.id === cid)?.n ?? 0);
    if (mine < top) fail(409, `That gift has ${mine} vote${mine === 1 ? '' : 's'}; the top pick has ${top}. Pick a top-voted gift, or ask friends to change their votes.`);
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
  /** One code path for every hold: budget cap, SIM-swap check, mock Visa authorization (card or saved token), ledger. */
  async function placeHold(bq: any, m: any, amountCents: number, pay: { cardNumber?: string; token?: string }, idempotencyKey: string) {
    if (bq.status !== 'funding') fail(409, 'Funding is not open');
    if (deadlinePassed(bq)) fail(409, 'The buy-by deadline has passed');
    const [{ s }] = await db.query(`SELECT COALESCE(SUM(amount_cents),0)::int AS s FROM contributions WHERE member_id=$1 AND status='held'`, [m.id]);
    if (Number(s) + amountCents > m.budget_max_cents) fail(400, `That would exceed your budget of $${(m.budget_max_cents / 100).toFixed(2)}`);
    if (amountCents >= D.SIM_SWAP_HOLD_THRESHOLD_CENTS && m.phone && await network.simSwappedRecently(m.phone)) fail(423, 'Your SIM was changed recently — large holds are paused for your safety');
    let hold; try { hold = await payments.hold({ amountCents, ...pay, idempotencyKey }); }
    catch (e) { if (e instanceof PaymentError) fail(402, e.message); throw e; }
    const created = await db.tx(async q => {
      const [cur] = await q('SELECT status FROM bouquets WHERE id=$1 FOR UPDATE', [bq.id]);
      // A double tap sends the same key twice. The request that loses the race sees the winner's row here and returns it as-is.
      const [prior] = await q('SELECT member_id, hold_id FROM contributions WHERE idempotency_key=$1', [idempotencyKey]);
      if (prior) { if (prior.hold_id !== hold!.holdId) await payments.release(hold!.holdId); if (prior.member_id !== m.id) fail(409, 'Idempotency key reuse'); return false; }
      if (cur.status !== 'funding') { await payments.release(hold!.holdId); fail(409, 'Funding just closed'); }
      // Re-check the cap under a row lock: parallel holds from one friend can't jointly exceed their budget.
      const [mm] = await q('SELECT budget_max_cents FROM members WHERE id=$1 FOR UPDATE', [m.id]);
      const [{ s: heldNow }] = await q(`SELECT COALESCE(SUM(amount_cents),0)::int AS s FROM contributions WHERE member_id=$1 AND status='held'`, [m.id]);
      if (Number(heldNow) + amountCents > mm.budget_max_cents) { await payments.release(hold!.holdId); fail(400, `That would exceed your budget of $${(mm.budget_max_cents / 100).toFixed(2)}`); }
      const cid = id('ctb');
      const ins = await q(`INSERT INTO contributions (id,bouquet_id,member_id,amount_cents,hold_id,status,card_last4,idempotency_key) VALUES ($1,$2,$3,$4,$5,'held',$6,$7) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`, [cid, bq.id, m.id, amountCents, hold!.holdId, hold!.last4, idempotencyKey]);
      if (!ins.length) return false; // belt and braces: never a 500 on a duplicate key
      await q(`INSERT INTO ledger_events (bouquet_id,contribution_id,type,amount_cents) VALUES ($1,$2,'hold',$3)`, [bq.id, cid, amountCents]);
      await q('UPDATE members SET card_token=$2, card_last4=$3 WHERE id=$1', [m.id, hold!.token, hold!.last4]); // token only, never the card number
      return true;
    });
    if (created) notify(bq.id, 'contribution');
    return created;
  }
  app.post('/api/bouquets/:id/contributions', h(async (req, res) => {
    const uid = auth(req); const bq = await getBouquet(String(req.params.id)); const m = await requireMember(bq.id, uid);
    const b = z.object({ amountCents: z.number().int().min(100), cardNumber: z.string(), idempotencyKey: z.string().min(8) }).parse(req.body);
    const dup = (await db.query('SELECT * FROM contributions WHERE idempotency_key=$1', [b.idempotencyKey]))[0];
    if (dup) { if (dup.member_id !== m.id) fail(409, 'Idempotency key reuse'); return state(bq.id, uid); }
    if (bq.status !== 'funding') fail(409, 'Funding is not open');
    if (deadlinePassed(bq)) fail(409, 'The buy-by deadline has passed');
    // cheap checks first (budget, SIM swap) so a bot-check round trip isn't wasted on a hold that can't happen
    const [{ s }] = await db.query(`SELECT COALESCE(SUM(amount_cents),0)::int AS s FROM contributions WHERE member_id=$1 AND status='held'`, [m.id]);
    if (Number(s) + b.amountCents > m.budget_max_cents) fail(400, `That would exceed your budget of $${(m.budget_max_cents / 100).toFixed(2)}`);
    if (b.amountCents >= D.SIM_SWAP_HOLD_THRESHOLD_CENTS && m.phone && await network.simSwappedRecently(m.phone)) fail(423, 'Your SIM was changed recently — large holds are paused for your safety');
    await human(req);
    const created = await placeHold(bq, m, b.amountCents, { cardNumber: b.cardNumber }, b.idempotencyKey);
    res.status(created ? 201 : 200); return state(bq.id, uid);
  }));

  /* ---------- AI between people and payments ---------- */
  // 1) Natural-language chip-in: "about $30, $40 max, paid Friday" → soft amount, private cap, payday → a plan the person confirms.
  //    Gemini only reads the sentence; amounts are checked against what they wrote, and nothing is held until they press the Visa button.
  app.post('/api/bouquets/:id/chip-in/understand', h(async req => {
    const uid = auth(req); const bq = await getBouquet(String(req.params.id)); const m = await requireMember(bq.id, uid);
    if (bq.status !== 'funding') fail(409, 'Funding is not open');
    const { text, conditionTierId } = z.object({ text: z.string().trim().min(1, 'Tell us what you can chip in').max(500), conditionTierId: z.string().optional() }).parse(req.body);
    const now = clock.now(); const fromAi = await ai.understandChipIn(text, now); const ruled = B.parseChipInRules(text, now);
    // A conditional extra ("or $40 if it gets us the Polaroid") is read by the rules so the money is exact; Gemini may still supply the payday.
    const draft = ruled?.conditional ? { ...ruled, payday: ruled.payday ?? fromAi?.payday ?? null, paydayPhrase: ruled.paydayPhrase ?? fromAi?.paydayPhrase ?? null } : fromAi ?? ruled;
    if (!draft) fail(422, 'I couldn’t find an amount. Try something like “about $30, $40 max”.');
    const [{ s }] = await db.query(`SELECT COALESCE(SUM(amount_cents),0)::int AS s FROM contributions WHERE member_id=$1 AND status='held'`, [m.id]);
    const tiers = await db.query('SELECT * FROM gift_tiers WHERE bouquet_id=$1', [bq.id]); const { held } = await fundedCents(bq.id); const nt = D.nextTier(tiers, held);
    // "the Record" can mean two tiers: never guess, offer a one-tap choice (the person's pick comes back as conditionTierId)
    const matches = draft!.conditional ? (conditionTierId ? tiers.filter((t: any) => t.id === conditionTierId) : B.matchTiers(draft!.conditional.phrase, tiers, nt)) : [];
    const ct = matches.length === 1 ? matches[0] : null;
    const choices = matches.length > 1 ? matches.map((t: any) => ({ tierId: t.id, title: t.title.replace(/^\+ /, ''), priceCents: t.threshold_cents })) : null;
    const conditionTier = ct ? { id: ct.id, title: ct.title.replace(/^\+ /, ''), isNext: ct.id === nt?.id, gapCents: Math.max(0, ct.threshold_cents - held) } : null;
    const plan = B.planChipIn(draft!, { pledgedCents: Number(s), buyByAt: new Date(bq.buy_by_at).toISOString(), nextTierGapCents: nt ? nt.threshold_cents - held : null, nextTierTitle: nt?.title.replace(/^\+ /, '') ?? null, conditionTier, ambiguous: !!choices });
    return { heard: text, plan, choices, source: fromAi && !ruled?.conditional ? 'gemini' : 'rules' };
  }));
  // 2) Plain-language payment explainer: the rules compute every figure for *this* person; Gemini may only reword it (every $ kept, none added).
  app.get('/api/bouquets/:id/explain', h(async req => {
    const uid = auth(req); const st: any = await state(String(req.params.id), uid); const b = st.bouquet;
    if (!['funding', 'purchased', 'revealed', 'expired'].includes(b.status)) fail(409, 'There is nothing to pay yet');
    const cand = st.candidates.find((c: any) => c.id === b.chosenCandidateId); const org = st.members.find((m: any) => m.role === 'organizer');
    const mine = st.me.contributions; const done = ['purchased', 'revealed'].includes(b.status); const co = st.totals.checkout;
    const tierRow = done ? st.tiers.find((t: any) => t.id === b.capturedTierId) : co ? st.tiers.find((t: any) => t.id === co.tierId) : null;
    const nt = st.tiers.find((t: any) => t.id === st.totals.nextTier);
    const holders = done ? (await db.query(`SELECT COUNT(DISTINCT member_id)::int AS n FROM contributions WHERE bouquet_id=$1 AND status='captured'`, [b.id]))[0].n : co?.holders ?? 0;
    const facts: B.ExplainFacts = { status: b.status, recipient: b.recipientName, gift: cand?.title ?? 'the gift', organizer: org?.displayName ?? 'the organizer', buyBy: new Date(b.buyByAt).toISOString(), holders: Number(holders),
      heldCents: st.totals.heldCents, myHeldCents: done ? st.me.receipt.heldCents : b.status === 'expired' ? mine.reduce((a: number, c: any) => a + c.amount_cents, 0) : co?.myHeldCents ?? mine.filter((c: any) => c.status === 'held').reduce((a: number, c: any) => a + c.amount_cents, 0),
      myChargeCents: done ? st.me.receipt.chargedCents : co?.myChargeCents ?? 0,
      tierLevel: tierRow?.level ?? null, tierTitle: tierRow?.title.replace(/^\+ /, '') ?? null, chargeCents: done ? b.capturedCents : co?.chargeCents ?? null, tiersCount: st.tiers.length,
      nextTierTitle: nt?.title.replace(/^\+ /, '') ?? null, nextTierGapCents: nt ? nt.thresholdCents - st.totals.fundedCents : null,
      firstTierGapCents: st.tiers.length ? Math.max(0, st.tiers[0].thresholdCents - st.totals.heldCents) : null, isOrganizer: b.isOrganizer, groupHidden: !!st.totals.blurred };
    const rules = B.explainRules(facts); const w = await ai.reword('explain', rules); const friendly = w && B.keepsRecipient(w, facts.recipient) ? w : null;
    return { text: friendly ?? rules, rules, source: friendly ? 'gemini' : 'rules', figures: B.figures(rules), receipt: B.receipt(facts) };
  }));
  // 3) Gift concierge: ranks the gifts on the table from the group's kept cards + votes, checks them against everyone's combined budget caps,
  //    and says which tier the group can reach and what the next upgrade costs. Gemini rewords the top pick's "why" (figures checked).
  app.get('/api/bouquets/:id/concierge', h(async req => {
    const uid = auth(req); const st: any = await state(String(req.params.id), uid);
    if (st.bouquet.status !== 'fusing') fail(409, 'The concierge helps while the group is picking a gift');
    const tiers = await db.query('SELECT candidate_id, level, title, threshold_cents FROM gift_tiers WHERE bouquet_id=$1 ORDER BY level', [st.bouquet.id]);
    const [{ total }] = await db.query('SELECT COALESCE(SUM(budget_max_cents),0)::int AS total FROM members WHERE bouquet_id=$1', [st.bouquet.id]);
    const traitKeeps = Object.fromEntries(st.traits.map((t: any) => [t.label, t.keptCount]));
    const cardholders = [...new Set(st.cards.map((k: any) => k.memberName as string))] as string[];
    const picks = B.conciergeRules({ traitKeeps, groupBudgetCents: Number(total), cardholders,
      candidates: st.candidates.map((c: any) => ({ id: c.id, title: c.title, rare: c.rare, traits: c.traits, votes: c.votes, cover: c.product?.url ?? null,
        // every friend whose card named one of this gift's traits, not only the ones the fusion recorded
        contributors: [...new Set(st.cards.filter((k: any) => (k.traits as string[]).some(t => c.traits.includes(t))).map((k: any) => k.memberName as string))] as string[],
        tiers: tiers.filter((t: any) => t.candidate_id === c.id).map((t: any) => ({ level: t.level, title: t.title, thresholdCents: t.threshold_cents })) })) });
    let source = 'rules';
    if (picks[0]) { // Gemini may warm up the wording, but must still name every friend whose card the pick uses (else the rule text stays)
      const who = (st.cards as any[]).filter(k => (k.traits as string[]).some(t => (st.candidates.find((c: any) => c.id === picks[0].candidateId)?.traits ?? []).includes(t))).map(k => k.memberName as string);
      const w = await ai.reword('concierge', `${picks[0].title}: ${picks[0].why}`);
      if (w && who.every(n => w.includes(n))) { picks[0].why = w; source = 'gemini'; } }
    return { picks, source, members: st.members.length };
  }));
  // 4) Top-up plan: close the gap to the next tier across private caps. Rules split it; each friend sees only their own ask;
  //    one tap re-uses their saved Visa token (no card re-entry). Gemini may word the nudge (figures checked).
  async function topUpFor(bid: string, me: any) {
    const bq = await getBouquet(bid); if (bq.status !== 'funding' || deadlinePassed(bq)) return { ask: null, reason: 'Funding is closed' };
    const tiers = await db.query('SELECT * FROM gift_tiers WHERE bouquet_id=$1', [bid]); const { held } = await fundedCents(bid); const nt = D.nextTier(tiers, held);
    if (!nt) return { ask: null, reason: 'Every tier is already funded' };
    const people = await db.query(`SELECT m.id, m.budget_max_cents, m.payday, m.card_token, m.topped_tier_id, m.topup_done, m.condition_base_cents, (SELECT level FROM gift_tiers g WHERE g.id=m.condition_tier_id) AS cond_level, (SELECT COALESCE(SUM(amount_cents),0)::int FROM contributions c WHERE c.member_id=m.id AND c.status='held') AS held
      FROM members m WHERE m.bouquet_id=$1 AND m.card_token IS NOT NULL`, [bid]);
    const plan = B.planTopUps(nt.threshold_cents - held, people.map((p: any) => ({ id: p.id, headroomCents: p.topup_done ? 0 : Math.max(0, (p.cond_level != null && Number(p.cond_level) > nt.level ? Number(p.condition_base_cents) : p.budget_max_cents) - Number(p.held)), payday: p.payday ? new Date(p.payday).toISOString().slice(0, 10) : null, alreadyAsked: p.topped_tier_id === nt.id })), clock.now());
    if (!plan) return { ask: null, reason: 'Not reachable within everyone’s caps yet' };
    const mine = plan.get(me.id); if (!mine) return { ask: null, reason: 'No top-up needed from you' };
    const tierTitle = nt.title.replace(/^\+ /, '');
    return { tierId: nt.id, ask: { cents: mine.cents, availableAt: mine.availableAt, tierTitle, tierPriceCents: nt.threshold_cents, last4: me.card_last4, friends: plan.size } };
  }
  app.get('/api/bouquets/:id/topup', h(async req => {
    const uid = auth(req); const bid = String(req.params.id); const m = await requireMember(bid, uid);
    const r: any = await topUpFor(bid, m); if (!r.ask) return { ask: null, reason: r.reason, source: 'rules' };
    const a = r.ask; const recipient = (await getBouquet(bid)).recipient_name;
    const rules = a.availableAt
      ? `On your payday, ${money(a.cents)} more gets ${recipient}’s gift to ${a.tierTitle} (${money(a.tierPriceCents)} total).`
      : `${money(a.cents)} more unlocks ${a.tierTitle} for ${recipient} (${money(a.tierPriceCents)} total).${a.friends > 1 ? ' The rest is split fairly, each friend within their own limit.' : ''}`;
    const w = await ai.reword('explain', rules);
    return { ask: { ...a, message: w ?? rules }, source: w ? 'gemini' : 'rules' };
  }));
  // "I'm done": no more top-up asks for me in this bouquet; the plan re-splits the gap across everyone else.
  app.post('/api/bouquets/:id/topup/done', h(async req => {
    const uid = auth(req); const bq = await getBouquet(String(req.params.id)); const m = await requireMember(bq.id, uid);
    await db.query('UPDATE members SET topup_done=true WHERE id=$1', [m.id]); notify(bq.id, 'contribution');
    return { ok: true };
  }));
  app.post('/api/bouquets/:id/topup/accept', h(async (req, res) => {
    const uid = auth(req); const bq = await getBouquet(String(req.params.id)); const m = await requireMember(bq.id, uid);
    const { cents, idempotencyKey } = z.object({ cents: z.number().int().min(100), idempotencyKey: z.string().min(8) }).parse(req.body);
    const dup = (await db.query('SELECT member_id FROM contributions WHERE idempotency_key=$1', [idempotencyKey]))[0];
    if (dup) { if (dup.member_id !== m.id) fail(409, 'Idempotency key reuse'); return state(bq.id, uid); }
    const r: any = await topUpFor(bq.id, m);
    if (!r.ask) fail(409, r.reason); if (r.ask.availableAt) fail(409, `This top-up opens on your payday (${r.ask.availableAt})`);
    if (r.ask.cents !== cents) fail(409, 'The group changed, so your top-up was recalculated. Please check the new amount.');
    // One tap re-uses a saved card, so always run the carrier SIM Swap check first, whatever the amount (account-takeover guard).
    if (m.phone && await network.simSwappedRecently(m.phone)) fail(423, 'Your SIM was changed recently, so one-tap top-ups are paused for your safety. Re-verify your phone to continue.');
    await placeHold(bq, m, cents, { token: m.card_token }, idempotencyKey);
    await db.query('UPDATE members SET topped_tier_id=$2 WHERE id=$1', [m.id, r.tierId]);
    res.status(201); return state(bq.id, uid);
  }));
  /* ---------- lock: capture at highest funded tier, release the rest ---------- */
  /** Settle pending holds with the processor, outside any DB transaction (no row locks held across a network call).
   *  Each row moves pending → final with a guarded UPDATE, so a retry (or a second caller) never writes the ledger twice.
   *  A processor error leaves the row pending; the next lock/sweep/withdraw call retries it. */
  const MAX_SETTLE_TRIES = 3;
  async function settlePending(bid: string) {
    const rows = await db.query(`SELECT * FROM contributions WHERE bouquet_id=$1 AND status IN ('capture_pending','release_pending') ORDER BY id`, [bid]);
    let failed = 0;
    for (const hd of rows) {
      try { if (hd.status === 'capture_pending') await payments.capture(hd.hold_id, hd.captured_cents); else await payments.release(hd.hold_id); }
      catch (e) { failed++; console.error('settle failed, will retry', hd.id, (e as Error).message);
        // Not pending forever: after MAX_SETTLE_TRIES failed captures, give up on that hold and release it, so the friend is never left in limbo.
        const [{ n }] = await db.query('UPDATE contributions SET settle_tries=settle_tries+1 WHERE id=$1 RETURNING settle_tries AS n', [hd.id]);
        if (hd.status === 'capture_pending' && Number(n) >= MAX_SETTLE_TRIES) {
          try { await payments.release(hd.hold_id); } catch { /* the authorization lapses on its own */ }
          await db.tx(async q => { const done = await q(`UPDATE contributions SET status='released', captured_cents=0 WHERE id=$1 AND status='capture_pending' RETURNING id`, [hd.id]); if (!done.length) return;
            await q(`INSERT INTO ledger_events (bouquet_id,contribution_id,type,amount_cents) VALUES ($1,$2,'release',$3)`, [bid, hd.id, hd.amount_cents]); });
        }
        continue; }
      await db.tx(async q => {
        const fin = hd.status === 'capture_pending' ? 'captured' : 'released';
        const done = await q(`UPDATE contributions SET status=$3 WHERE id=$1 AND status=$2 RETURNING id`, [hd.id, hd.status, fin]); if (!done.length) return;
        const cap = fin === 'captured' ? hd.captured_cents : 0;
        if (cap > 0) await q(`INSERT INTO ledger_events (bouquet_id,contribution_id,type,amount_cents) VALUES ($1,$2,'capture',$3)`, [bid, hd.id, cap]);
        if (hd.amount_cents - cap > 0) await q(`INSERT INTO ledger_events (bouquet_id,contribution_id,type,amount_cents) VALUES ($1,$2,'release',$3)`, [bid, hd.id, hd.amount_cents - cap]);
      });
    }
    return { failed };
  }
  async function lock(bid: string) {
    const members = await db.query(`SELECT DISTINCT m.phone, m.display_name FROM members m JOIN contributions c ON c.member_id=m.id WHERE m.bouquet_id=$1 AND c.status='held'`, [bid]);
    for (const m of members) if (m.phone && await network.simSwappedRecently(m.phone)) fail(423, `${m.display_name}’s phone number moved to a new SIM recently. Ask them to confirm it’s them before buying.`);
    const r = await db.tx(async q => {
      const [b] = await q('SELECT * FROM bouquets WHERE id=$1 FOR UPDATE', [bid]);
      if (b.status === 'purchased' || b.status === 'revealed') return { already: true };
      if (b.status !== 'funding') fail(409, 'Not in funding stage');
      if (deadlinePassed(b)) fail(409, 'The buy-by deadline has passed');
      const tiers = await q('SELECT * FROM gift_tiers WHERE bouquet_id=$1', [bid]);
      const { held } = await fundedCents(bid, q);
      const tier = D.highestFundedTier(tiers, held); if (!tier) fail(409, 'Not funded yet. The first item still needs more');
      const holds = await q(`SELECT * FROM contributions WHERE bouquet_id=$1 AND status='held' ORDER BY id FOR UPDATE`, [bid]);
      const alloc = D.allocateCapture(holds, tier.threshold_cents);
      for (const hd of holds) { const amt = alloc.get(hd.id) ?? 0;
        await q(`UPDATE contributions SET status=$2, captured_cents=$3 WHERE id=$1`, [hd.id, amt > 0 ? 'capture_pending' : 'release_pending', amt]); }
      await q(`UPDATE bouquets SET status='purchased', captured_tier_id=$2, captured_cents=$3 WHERE id=$1`, [bid, tier.id, tier.threshold_cents]);
      return { already: false };
    });
    await settlePending(bid); // also retries anything left pending by an earlier processor error
    await issueCards(bid);
    return r;
  }
  /** Pay the stores: one single-use virtual card per store, for exactly what that store is owed, adding up to the charged total.
   *  Friends' holds are captured by the processor; the organizer never receives or fronts the money. */
  async function issueCards(bid: string) {
    const [b] = await db.query('SELECT * FROM bouquets WHERE id=$1', [bid]);
    if (!b || !['purchased', 'revealed'].includes(b.status) || b.vcards || !(b.captured_cents > 0)) return;
    const tiers = (await db.query('SELECT t.*, c.title AS ctitle, c.trait_labels FROM gift_tiers t JOIN candidates c ON c.id=t.candidate_id WHERE t.bouquet_id=$1 AND t.candidate_id=(SELECT candidate_id FROM gift_tiers WHERE id=$2) AND t.threshold_cents <= $3 ORDER BY t.level', [bid, b.captured_tier_id, b.captured_cents]));
    const owed = new Map<string, number>(); let prev = 0;
    for (const t of tiers) { const p = productAt(t.ctitle, t.level, t.trait_labels); const store = p?.store ?? 'the store';
      owed.set(store, (owed.get(store) ?? 0) + (t.threshold_cents - prev)); prev = t.threshold_cents; }
    if (!owed.size) owed.set('the store', b.captured_cents);
    const entries = [...owed.entries()]; const diff = b.captured_cents - entries.reduce((a, [, c]) => a + c, 0); entries[entries.length - 1][1] += diff; // exact total
    const issue = payments.issueVirtualCard?.bind(payments) ?? (async ({ idempotencyKey }: any) => ({ cardId: 'vcard_' + idempotencyKey.slice(-12), last4: '0000' }));
    const cards: any[] = []; let n = 0;
    for (const [merchant, amountCents] of entries) { const c = await issue({ amountCents, merchant, idempotencyKey: `${bid}-vc-${n++}` });
      cards.push({ merchant, amountCents, last4: c.last4, cardId: c.cardId, orderRef: 'BQ-' + crypto.createHash('sha256').update(c.cardId).digest('hex').slice(0, 6).toUpperCase() }); }
    await db.tx(async q => {
      const done = await q('UPDATE bouquets SET vcards=$2 WHERE id=$1 AND vcards IS NULL RETURNING id', [bid, JSON.stringify(cards)]); if (!done.length) return;
      for (const c of cards) await q(`INSERT INTO ledger_events (bouquet_id,contribution_id,type,amount_cents) VALUES ($1,$2,'vcard',$3)`, [bid, c.cardId, c.amountCents]); });
  }
  // Change of heart before checkout: a friend can withdraw every hold they placed. Released at the card network, nothing charged.
  app.post('/api/bouquets/:id/contributions/withdraw', h(async req => {
    const uid = auth(req); const bq = await getBouquet(String(req.params.id)); const m = await requireMember(bq.id, uid);
    const n = await db.tx(async q => {
      const [cur] = await q('SELECT status FROM bouquets WHERE id=$1 FOR UPDATE', [bq.id]);
      if (cur.status !== 'funding') fail(409, 'You can only take your money back before the gift is bought');
      const rows = await q(`UPDATE contributions SET status='release_pending', captured_cents=0 WHERE member_id=$1 AND status='held' RETURNING id`, [m.id]);
      if (!rows.length) fail(409, 'You have no hold to withdraw');
      await q('UPDATE members SET condition_tier_id=NULL, condition_base_cents=NULL WHERE id=$1', [m.id]);
      return rows.length; });
    await settlePending(bq.id); notify(bq.id, 'contribution');
    return { ...(await state(bq.id, uid)), withdrawn: n };
  }));
  // Organizer calls it off before checkout: every hold is released, nobody is charged, the room says so.
  app.post('/api/bouquets/:id/cancel', h(async req => {
    const uid = auth(req); const bq = await requireOrganizer(String(req.params.id), uid);
    await db.tx(async q => {
      const [cur] = await q('SELECT status FROM bouquets WHERE id=$1 FOR UPDATE', [bq.id]);
      if (!['collecting', 'fusing', 'funding'].includes(cur.status)) fail(409, 'Only a gift that hasn’t been bought can be cancelled');
      await q(`UPDATE contributions SET status='release_pending', captured_cents=0 WHERE bouquet_id=$1 AND status='held'`, [bq.id]);
      await q(`UPDATE bouquets SET status='expired', cancelled_at=now() WHERE id=$1`, [bq.id]); });
    await settlePending(bq.id); notify(bq.id, 'expired');
    return state(bq.id, uid);
  }));
  app.post('/api/bouquets/:id/lock', h(async req => {
    const uid = auth(req); const bq = await requireOrganizer(String(req.params.id), uid);
    // Before the deadline the organizer can't check out on their own money alone while friends are in the room.
    if (bq.status === 'funding') {
      const holders = (await db.query(`SELECT DISTINCT m.role FROM contributions c JOIN members m ON m.id=c.member_id WHERE c.bouquet_id=$1 AND c.status='held'`, [bq.id])).map((r: any) => r.role);
      const [{ n }] = await db.query('SELECT COUNT(*)::int AS n FROM members WHERE bouquet_id=$1', [bq.id]);
      if (holders.length && holders.every((r: string) => r === 'organizer') && Number(n) > 1) fail(409, 'Only your own hold is in so far. Wait for at least one friend to chip in before checking out.');
    }
    await lock(String(req.params.id)); notify(String(req.params.id), 'purchased'); return state(String(req.params.id), uid);
  }));

  /* ---------- deadline sweep ---------- */
  async function sweep() {
    const due = await db.query(`SELECT id FROM bouquets WHERE status IN ('collecting','fusing','funding') AND buy_by_at < $1`, [clock.now().toISOString()]);
    for (const { id: bid } of due) {
      await db.tx(async q => {
        const [b] = await q('SELECT * FROM bouquets WHERE id=$1 FOR UPDATE', [bid]);
        if (!['collecting', 'fusing', 'funding'].includes(b.status)) return;
        await q(`UPDATE contributions SET status='release_pending', captured_cents=0 WHERE bouquet_id=$1 AND status='held'`, [bid]);
        await q(`UPDATE bouquets SET status='expired' WHERE id=$1`, [bid]);
      });
      await settlePending(bid);
      notify(bid, 'expired');
    }
    // retry anything a processor error left pending (captures and releases)
    for (const { bouquet_id } of await db.query(`SELECT DISTINCT bouquet_id FROM contributions WHERE status IN ('capture_pending','release_pending')`)) await settlePending(bouquet_id);
    return due.length;
  }

  /* ---------- recipient reveal (public by token) ---------- */
  async function revealPayload(token: string) {
    const [b] = await db.query('SELECT * FROM bouquets WHERE reveal_token=$1', [token]); if (!b) fail(404, 'This link isn’t valid');
    if (!['purchased', 'revealed'].includes(b.status)) fail(409, 'This gift isn’t ready to open yet');
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
      flipped: flips.map((f: any) => f.card_index), totalCards: cards.length + 1,
      // What the narrator says for each card, then the gift. The same text drives Gemini TTS and the browser fallback.
      narration: [...cards.map((c: any) => `From ${c.display_name}. ${c.story ?? D.compliment((c.traits as string[])[0]) ?? c.title}`),
        `And your gift: ${cand.title}. From ${names.join(', ')}. Happy ${String(b.occasion).toLowerCase()}!`] };
  }
  app.get('/api/reveal/:token', h(async req => revealPayload(String(req.params.token))));
  /* Reveal narrator: Gemini TTS, cached per (bouquet, card, text, voice) so each line is generated once. 404 → browser speechSynthesis. */
  const voiceJobs = new Map<string, Promise<{ body: Buffer; type: string } | null>>();
  app.get('/api/reveal/:token/voice/:index', h(async (req, res) => {
    const p = await revealPayload(String(req.params.token));
    const index = Number(req.params.index); const text = p.narration[index];
    if (!Number.isInteger(index) || text === undefined) fail(404, 'No such card');
    const key = `voice/${p.bouquetId}/${index}-${crypto.createHash('sha1').update(`${ai.provider}|${process.env.GEMINI_TTS_MODEL ?? ''}|${process.env.GEMINI_TTS_VOICE ?? ''}|${text}`).digest('hex').slice(0, 12)}.wav`;
    let audio = await storage.get(key); const hit = !!audio;
    if (!audio) {
      if (!voiceJobs.has(key)) voiceJobs.set(key, ai.speak(text).then(async a => { if (a) await storage.put(key, a.body, a.type); return a; }).finally(() => voiceJobs.delete(key)));
      audio = await voiceJobs.get(key)!;
    }
    if (!audio) { res.status(404).json({ error: 'Narration voice unavailable', fallback: 'browser' }); return; }
    res.set({ 'content-type': audio.type, 'cache-control': 'public, max-age=86400', 'x-narration': hit ? 'cache-hit' : 'generated' }).send(audio.body);
  }));
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
    // Demo shortcuts never move a server-wide clock: they only touch the caller's own gift (organizer) or the caller's own payday.
    app.post('/api/dev/deadline', h(async req => {
      const uid = auth(req); const b = z.object({ bouquetId: z.string() }).parse(req.body ?? {}); await requireOrganizer(b.bouquetId, uid);
      const moved = await db.query(`UPDATE bouquets SET buy_by_at=$2 WHERE id=$1 AND status IN ('collecting','fusing','funding') RETURNING id`, [b.bouquetId, new Date(clock.now().getTime() - 60000).toISOString()]);
      if (!moved.length) fail(409, 'This gift is already bought or closed');
      return { expired: await sweep() }; }));
    app.post('/api/dev/payday', h(async req => {
      const uid = auth(req); const b = z.object({ bouquetId: z.string() }).parse(req.body ?? {}); const m = await requireMember(b.bouquetId, uid);
      const today = clock.now().toISOString().slice(0, 10); await db.query('UPDATE members SET payday=$2 WHERE id=$1', [m.id, today]); notify(b.bouquetId, 'contribution');
      return { payday: today }; }));
    app.post('/api/dev/simswap', h(async req => {
      const uid = auth(req); const bid = z.object({ bouquetId: z.string(), on: z.boolean().default(true) }).parse(req.body);
      const m = await requireMember(bid.bouquetId, uid); if (!m.phone) fail(400, 'No phone on file');
      if (!(network as any).markSwapped) fail(400, 'Only available with the mock network');
      (network as any).markSwapped(m.phone, bid.on); return { phone: m.phone, swapped: bid.on };
    }));
    app.post('/api/dev/sweep', h(async req => { const uid = auth(req); const b = z.object({ bouquetId: z.string() }).parse(req.body ?? {}); await requireOrganizer(b.bouquetId, uid); return { expired: await sweep() }; }));
    // Fresh demo: only the demo organizer. Releases every hold on the old demo bouquet(s), resets the clock, and seeds a new ready "Maya" bouquet.
    app.post('/api/dev/reset-demo', h(async req => {
      const uid = auth(req); if (uid !== 'usr_demo') fail(403, 'Only the demo organizer can reset the demo');
      // Only the seeded demo gift(s) are reset; anything a person created in the demo account is left alone.
      for (const { id: bid } of await db.query(`SELECT id FROM bouquets WHERE organizer_id=$1 AND is_demo AND status NOT IN ('expired')`, [uid])) {
        await db.tx(async q => { await q('SELECT id FROM bouquets WHERE id=$1 FOR UPDATE', [bid]);
          await q(`UPDATE contributions SET status='release_pending', captured_cents=0 WHERE bouquet_id=$1 AND status='held'`, [bid]);
          await q(`UPDATE bouquets SET status='expired' WHERE id=$1`, [bid]); });
        await settlePending(bid);
        notify(bid, 'expired');
      }
      const id = await seedDemoBouquet(`http://127.0.0.1:${req.socket.localPort}`, deps.internalToken ?? '');
      await db.query('UPDATE bouquets SET is_demo=true WHERE id=$1', [id]);
      return { bouquetId: id };
    }));
  }

  app.use((err: any, _req: Request, res: Response, _n: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') });
    console.error(err); res.status(500).json({ error: 'Something went wrong' });
  });
  return { app, artJobs, sweep, lock, clock, db };
}
