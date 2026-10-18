/**
 * "AI between people and payments": the deterministic half.
 * Gemini may *understand* free text and *reword* explanations, but every number that touches money is computed here,
 * and every Gemini answer is checked against these rules before it is shown. When Gemini is off, these functions are the feature.
 */
export const money = (c: number) => '$' + (c / 100).toFixed(c % 100 ? 2 : 0);
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WORDS: Record<string, number> = { five: 5, ten: 10, fifteen: 15, twenty: 20, 'twenty-five': 25, 'twenty five': 25, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, 'a hundred': 100, 'one hundred': 100 };
const CAP_BEFORE = /(max(imum)?|at most|up to|upto|cap(ped)?( at)?|no more than|stretch( to)?|ceiling|limit|hard stop|top out at)\s*(of\s*)?(is\s*)?$/i;
const CAP_AFTER = /^\s*(max(imum)?|tops|at most|absolute max|hard cap|is my (max|limit|cap)|cap|ceiling|limit)\b/i;

export type ChipInDraft = { softCents: number; capCents: number; payday: string | null; paydayPhrase: string | null };
export type ChipInPlan = ChipInDraft & { holdNowCents: number; warnings: string[]; summary: string;
  /** Payday-aware: the rest of the cap Bouquet will offer as a one-tap top-up on payday, if the group still needs it. */
  scheduledTopUp: { cents: number; on: string; phrase: string } | null };

type Amt = { cents: number; at: number; end: number; cap: boolean };
/** Every dollar amount a person wrote (digits or common words), with whether it was phrased as a ceiling. Dates like "the 15th" are skipped. */
export function amountsIn(text: string): Amt[] {
  const out: Amt[] = [];
  const re = /(\$\s*)?(\d{1,5}(?:[.,]\d{1,2})?)(\s*k\b)?(?!\s*(st|nd|rd|th)\b)(\s*(dollars|bucks|usd))?/gi;
  for (let m; (m = re.exec(text));) {
    const before = text.slice(Math.max(0, m.index - 4), m.index).toLowerCase();
    const hasMoney = !!m[1] || !!m[5];
    if (!hasMoney && /(the|on|by)\s*$/.test(text.slice(Math.max(0, m.index - 4), m.index))) continue; // "on the 15", "by 5"
    if (!hasMoney && /\b(am|pm)\b/i.test(text.slice(m.index + m[0].length, m.index + m[0].length + 4))) continue;
    if (/[:/]$/.test(before)) continue;
    let v = Number(m[2].replace(',', '.')); if (m[3]) v *= 1000;
    out.push({ cents: Math.round(v * 100), at: m.index, end: m.index + m[0].length, cap: false });
  }
  for (const [w, v] of Object.entries(WORDS)) {
    const r = new RegExp(`\\b${w}\\b(\\s*(dollars|bucks))?`, 'gi');
    for (let m; (m = r.exec(text));) if (!out.some(o => m!.index >= o.at && m!.index < o.end)) out.push({ cents: v * 100, at: m.index, end: m.index + m[0].length, cap: false });
  }
  out.sort((a, b) => a.at - b.at);
  // drop word matches swallowed by a longer word match ("twenty five" vs "twenty")
  const kept = out.filter((o, i) => !out.some((p, j) => j !== i && p.at <= o.at && p.end >= o.end && (p.end - p.at) > (o.end - o.at)));
  for (const a of kept) a.cap = CAP_BEFORE.test(text.slice(Math.max(0, a.at - 24), a.at)) || CAP_AFTER.test(text.slice(a.end, a.end + 20));
  return kept;
}

/** Next date for a weekday / "tomorrow" / "next week" / "the 15th" phrase, as YYYY-MM-DD in UTC. */
export function paydayIn(text: string, now: Date): { date: string; phrase: string } | null {
  const t = text.toLowerCase(); const day = (d: Date) => d.toISOString().slice(0, 10);
  const add = (n: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + n));
  const wd = DAYS.findIndex(d => new RegExp(`\\b${d}\\b`).test(t));
  if (wd >= 0) { let n = (wd - now.getUTCDay() + 7) % 7; if (n === 0) n = 7; if (new RegExp(`next ${DAYS[wd]}`).test(t) && n < 7) n += 7; return { date: day(add(n)), phrase: DAYS[wd][0].toUpperCase() + DAYS[wd].slice(1) }; }
  if (/\btomorrow\b/.test(t)) return { date: day(add(1)), phrase: 'tomorrow' };
  if (/\bnext week\b/.test(t)) return { date: day(add(7)), phrase: 'next week' };
  const dom = /\b(?:on |by )?the (\d{1,2})(?:st|nd|rd|th)\b/.exec(t);
  if (dom) { const n = Number(dom[1]); if (n >= 1 && n <= 31) { let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), n)); if (d.getTime() < add(0).getTime()) d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, n)); return { date: day(d), phrase: `the ${dom[0].match(/\d+\w+/)![0]}` }; } }
  if (/\b(end of (the )?month|month end)\b/.test(t)) return { date: day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))), phrase: 'end of the month' };
  return null;
}

/** Rule-based understanding of "I can do about $30, $40 max, and I get paid Friday". Null when no amount was said. */
export function parseChipInRules(text: string, now: Date): ChipInDraft | null {
  const amts = amountsIn(text); if (!amts.length) return null;
  const range = /(\$?\s*\d+)\s*(?:-|–|to)\s*(\$?\s*\d+)/.exec(text);
  let soft: number, cap: number;
  const caps = amts.filter(a => a.cap), softs = amts.filter(a => !a.cap);
  if (range && amts.length >= 2 && !caps.length) { soft = Math.min(amts[0].cents, amts[1].cents); cap = Math.max(amts[0].cents, amts[1].cents); }
  else { cap = caps.length ? Math.max(...caps.map(a => a.cents)) : Math.max(...amts.map(a => a.cents)); soft = softs.length ? softs[0].cents : cap; }
  if (soft > cap) [soft, cap] = [cap, soft];
  const p = paydayIn(text, now);
  return { softCents: soft, capCents: cap, payday: p?.date ?? null, paydayPhrase: p?.phrase ?? null };
}

/** Numbers a Gemini answer may use: only amounts the person actually wrote (guards against invented money). */
export function groundedAmount(cents: number, text: string) { return amountsIn(text).some(a => a.cents === cents); }

/** Turn an understood draft into what we'll do: the hold amount (never above budget room), warnings, and a read-back sentence. */
export function planChipIn(d: ChipInDraft, ctx: { pledgedCents: number; buyByAt: string; nextTierGapCents: number | null; nextTierTitle?: string | null }): ChipInPlan {
  const capCents = Math.max(100, Math.min(d.capCents, 1_000_000)); const softCents = Math.max(100, Math.min(d.softCents, capCents));
  const room = Math.max(0, capCents - ctx.pledgedCents); const holdNowCents = Math.min(softCents, room);
  const warnings: string[] = []; const buyBy = new Date(ctx.buyByAt);
  const byDay = buyBy.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  if (d.payday && new Date(d.payday + 'T23:59:59Z').getTime() > buyBy.getTime())
    warnings.push(`Your payday (${d.paydayPhrase ?? d.payday}) is after the buy-by date (${byDay}). A hold isn’t a charge, but checkout can happen before you’re paid, so only hold what you’re comfortable with today.`);
  if (ctx.pledgedCents > 0 && room < softCents) warnings.push(room === 0 ? `You already hold ${money(ctx.pledgedCents)}, which is your whole ${money(capCents)} cap.` : `You already hold ${money(ctx.pledgedCents)}, so only ${money(room)} more fits under your ${money(capCents)} cap.`);
  if (ctx.nextTierGapCents && holdNowCents >= ctx.nextTierGapCents && ctx.nextTierTitle) warnings.push(`Nice: ${money(holdNowCents)} alone unlocks ${ctx.nextTierTitle}.`);
  const later = Math.max(0, room - holdNowCents);
  const beforeDeadline = !!d.payday && new Date(d.payday + 'T00:00:00Z').getTime() <= buyBy.getTime();
  const scheduledTopUp = d.payday && later >= 100 && beforeDeadline ? { cents: later, on: d.payday, phrase: d.paydayPhrase ?? d.payday } : null;
  const summary = scheduledTopUp
    ? `Hold ${money(holdNowCents)} now, and the other ${money(later)} waits for payday (${scheduledTopUp.phrase}).`
    : capCents > softCents
      ? `Hold ${money(holdNowCents)} now. Your private cap is ${money(capCents)}, so Bouquet can suggest a top-up later if the group is close.`
      : `Hold ${money(holdNowCents)}, and that’s your limit.`;
  return { softCents, capCents, payday: d.payday, paydayPhrase: d.paydayPhrase, holdNowCents, warnings, summary, scheduledTopUp };
}

/** Every "$12" / "$12.50" figure in a text. An AI rewording must keep exactly these, and add none. */
export const figures = (t: string) => (t.match(/\$\d[\d,]*(?:\.\d{2})?/g) ?? []).map(s => s.replace(/,/g, ''));
export function keepsFigures(original: string, rewrite: string) {
  const a = new Set(figures(original)), b = new Set(figures(rewrite));
  return [...a].every(x => b.has(x)) && [...b].every(x => a.has(x));
}

/* ---------- payment explainer facts ---------- */
export type ExplainFacts = {
  status: string; recipient: string; gift: string; organizer: string; buyBy: string; holders: number;
  heldCents: number; myHeldCents: number; myChargeCents: number; tierLevel: number | null; tierTitle: string | null; chargeCents: number | null; tiersCount: number;
  nextTierTitle: string | null; nextTierGapCents: number | null; firstTierGapCents: number | null; isOrganizer: boolean;
};
export function explainRules(f: ExplainFacts): string {
  const by = new Date(f.buyBy).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const who = f.isOrganizer ? 'you check out' : `${f.organizer} checks out`;
  if (f.status === 'purchased' || f.status === 'revealed') {
    if (!f.myHeldCents) return `The group bought ${f.gift} for ${f.recipient} (tier ${f.tierLevel} of ${f.tiersCount}, ${money(f.chargeCents ?? 0)}). You didn’t place a hold, so you paid nothing.`;
    const back = f.myHeldCents - f.myChargeCents;
    return `You paid ${money(f.myChargeCents)} of your ${money(f.myHeldCents)} hold.${back > 0 ? ` The other ${money(back)} went back to your card and was never charged.` : ''} Why: tier ${f.tierLevel} (${f.tierTitle}) cost ${money(f.chargeCents ?? 0)} in total and the group’s holds covered it, so Visa captured exactly ${money(f.chargeCents ?? 0)}, split in proportion to what each of the ${f.holders} friends held.`;
  }
  if (f.status === 'expired') return `The buy-by date passed before checkout, so every hold was released. Nobody was charged${f.myHeldCents ? `, including your ${money(f.myHeldCents)} hold` : ''}.`;
  if (f.tierLevel === null) {
    const gap = f.firstTierGapCents ?? 0;
    return `Nothing is charged yet. The first tier of ${f.gift} needs ${money(gap)} more in holds before anyone can check out.${f.myHeldCents ? ` Your ${money(f.myHeldCents)} is only a hold.` : ''} If it isn’t funded by ${by}, every hold is released and nobody pays.`;
  }
  const back = f.myHeldCents - f.myChargeCents;
  const mine = f.myHeldCents ? `If ${who} now, you pay ${money(f.myChargeCents)} of your ${money(f.myHeldCents)} hold${back > 0 ? ` and ${money(back)} goes back to your card` : ''}.` : `You haven’t placed a hold, so you won’t pay anything.`;
  // Wording matters as much as maths here: always "costs X, group holds Y (Y ≥ X)", then what is captured and what is released.
  const charge = f.chargeCents ?? 0, spare = f.heldCents - charge;
  const why = `Why: tier ${f.tierLevel} (${f.tierTitle}) costs ${money(charge)} in total and the group holds ${money(f.heldCents)}, so it is fully funded. Visa would capture exactly ${money(charge)}, split in proportion to each hold${spare > 0 ? `, and release the other ${money(spare)}` : ', using every hold in full'}.${f.nextTierGapCents ? ` ${f.nextTierTitle} would need ${money(f.nextTierGapCents)} more in holds.` : ' That is the top tier.'}`;
  return `${mine} ${why} If nobody checks out by ${by}, every hold is released and nobody pays.`;
}

/* ---------- gift concierge ---------- */
const names = (n: string[]) => n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
type Tier = { level: number; title: string; thresholdCents: number };
export type ConciergeIn = { candidates: { id: string; title: string; rare: boolean; traits: string[]; votes: number; contributors: string[]; cover?: string | null; tiers: Tier[] }[];
  traitKeeps: Record<string, number>; groupBudgetCents: number; cardholders: string[] };
export type ConciergePick = { candidateId: string; title: string; score: number; standout: string; why: string;
  budget: { coversCents: number; items: number; totalCents: number; items_total: number; full: boolean };
  nextUpgrade: { title: string; priceCents: number } | null;
  /** kept for older clients */ reachableTier: Tier | null; nextTier: { level: number; title: string; thresholdCents: number } | null };
const clean = (t: string) => t.replace(/^\+ /, '');
/**
 * Rank gifts by what the group kept and voted for, drop near-duplicates, and give each pick one line on what sets it apart.
 * Budget lines are in dollars for *this* gift (tier numbers mean different things per gift). Only the covered amount is shown,
 * never the summed budget caps, so no one can back out a friend's private number.
 */
export function conciergeRules(x: ConciergeIn, limit = 3): ConciergePick[] {
  const scored = x.candidates.map(c => {
    const keeps = c.traits.reduce((a, t) => a + (x.traitKeeps[t] ?? 0), 0);
    const tiers = [...c.tiers].sort((a, b) => a.thresholdCents - b.thresholdCents);
    const reach = [...tiers].reverse().find(t => t.thresholdCents <= x.groupBudgetCents) ?? null;
    const nxt = tiers.find(t => t.thresholdCents > x.groupBudgetCents) ?? null;
    const score = keeps * 2 + c.votes * 3 + (c.rare ? 2 : 0) + c.contributors.length * 2 + (reach ? reach.level : 0);
    return { c, keeps, tiers, reach, nxt, score, top: tiers[tiers.length - 1]?.thresholdCents ?? 0, start: tiers[0]?.thresholdCents ?? 0 };
  }).sort((a, b) => b.score - a.score || a.c.title.localeCompare(b.c.title));
  // near-duplicates: same title, same lead product, or a trait set already covered by a higher-ranked pick
  const shown: typeof scored = [];
  for (const s of scored) {
    if (shown.some(p => p.c.title === s.c.title || (s.c.cover && p.c.cover === s.c.cover) || s.c.traits.every(t => p.c.traits.includes(t)))) continue;
    shown.push(s); if (shown.length >= limit) break;
  }
  const holders = x.cardholders.length;
  const unique = (s: typeof shown[0], val: (q: typeof shown[0]) => number) => shown.length > 1 && shown.every(q => q === s || val(q) < val(s));
  const used = new Set<string>();
  const criteria: [string, (q: typeof shown[0]) => number, (s: typeof shown[0]) => string][] = [
    ['all', q => q.c.contributors.length, s => s.c.contributors.length === holders && holders > 1 ? `The only pick that draws on all ${holders} friends’ cards.` : `Draws on the most friends’ cards (${s.c.contributors.length} of ${holders}).`],
    ['full', q => (q.reach && q.reach.thresholdCents === q.top ? 1 : 0), s => `The only one your budget covers in full today (${money(s.top)}).`],
    ['rare', q => (q.c.rare ? 1 : 0), () => `The only rare fusion: 2+ friends named both of its traits on their own.`],
    ['kept', q => q.keeps, s => `Its traits were kept most in the deck (×${s.keeps}).`],
    ['cheap', q => -q.start, s => `Lowest starting price (${money(s.start)}), so it’s funded soonest.`],
    ['votes', q => q.c.votes, s => `Most votes so far (${s.c.votes}).`],
  ];
  return shown.map(s => {
    let standout = '';
    for (const [k, val, text] of criteria) if (!used.has(k) && unique(s, val)) { standout = text(s); used.add(k); break; }
    if (!standout) standout = shown.length === 1 ? 'The clear match for what your group kept.' : `A different direction: ${s.c.traits.join(' + ')}.`;
    const missing = x.cardholders.filter(n => !s.c.contributors.includes(n));
    const kept = s.c.traits.filter(t => x.traitKeeps[t]).map(t => `${t} (kept ×${x.traitKeeps[t]})`);
    const why = `Built on ${kept.length ? kept.join(' and ') : s.c.traits.join(' and ')}. Uses ${s.c.contributors.length ? `${names(s.c.contributors)}’s card${s.c.contributors.length > 1 ? 's' : ''}` : 'nobody’s card directly'}${missing.length && s.c.contributors.length ? ` (not ${names(missing)}’s)` : ''}.`;
    const items = s.reach ? s.tiers.filter(t => t.thresholdCents <= s.reach!.thresholdCents).length : 0;
    return { candidateId: s.c.id, title: s.c.title, score: s.score, standout, why,
      budget: { coversCents: s.reach?.thresholdCents ?? 0, items, totalCents: s.top, items_total: s.tiers.length, full: !!s.reach && s.reach.thresholdCents === s.top },
      nextUpgrade: s.nxt ? { title: clean(s.nxt.title), priceCents: s.nxt.thresholdCents } : null,
      reachableTier: s.reach, nextTier: s.nxt ? { level: s.nxt.level, title: clean(s.nxt.title), thresholdCents: s.nxt.thresholdCents } : null };
  });
}

/* ---------- payday-aware top-up plan ---------- */
export type TopUpPerson = { id: string; headroomCents: number; payday: string | null; /** already topped up toward this tier: asked again only if needed */ alreadyAsked?: boolean };
export type TopUpAsk = { cents: number; availableAt: string | null };
/**
 * Close the gap to the next tier across friends' *private* caps. Each person only ever sees their own ask.
 * Friends who can top up now are asked first; friends waiting on payday are scheduled only if the others can't close it.
 * Asks are proportional to headroom, rounded up to whole dollars where the cap allows, never above anyone's cap, and sum to ≥ the gap.
 * Null when even everyone's remaining headroom can't reach the next tier (then nobody is nagged).
 */
export function planTopUps(gapCents: number, people: TopUpPerson[], now: Date): Map<string, TopUpAsk> | null {
  if (gapCents <= 0) return new Map();
  const ready = (p: TopUpPerson) => !p.payday || new Date(p.payday + 'T00:00:00Z').getTime() <= now.getTime();
  const elig = people.filter(p => p.headroomCents >= 100);
  // widen the pool step by step: fresh friends who can pay now → plus friends who already topped up → plus payday friends
  const steps = [elig.filter(p => ready(p) && !p.alreadyAsked), elig.filter(ready), elig];
  const pool = steps.find(g => g.reduce((a, p) => a + p.headroomCents, 0) >= gapCents) ?? elig;
  const total = pool.reduce((a, p) => a + p.headroomCents, 0);
  if (total < gapCents) return null;
  // largest-remainder split of the gap, proportional to headroom (integer cents)
  const parts = pool.map(p => { const exact = (p.headroomCents * gapCents) / total; return { p, v: Math.floor(exact), frac: exact - Math.floor(exact) }; });
  let rem = gapCents - parts.reduce((a, x) => a + x.v, 0);
  [...parts].sort((a, b) => b.frac - a.frac || a.p.id.localeCompare(b.p.id)).forEach(x => { if (rem > 0 && x.v < x.p.headroomCents) { x.v++; rem--; } });
  const out = new Map<string, TopUpAsk>();
  for (const x of parts) {
    if (x.v <= 0) continue;
    const v = Math.min(Math.max(100, Math.ceil(x.v / 100) * 100), x.p.headroomCents); // whole dollars where the cap allows; never above the cap
    out.set(x.p.id, { cents: v, availableAt: ready(x.p) ? null : x.p.payday });
  }
  return out;
}
