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
export type ChipInPlan = ChipInDraft & { holdNowCents: number; warnings: string[]; summary: string };

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
  else if (d.payday) warnings.push(`A hold isn’t a charge. Nothing is captured until the organizer checks out, and you’re paid ${d.paydayPhrase ?? d.payday}, before the ${byDay} buy-by date.`);
  if (ctx.pledgedCents > 0 && room < softCents) warnings.push(room === 0 ? `You already hold ${money(ctx.pledgedCents)}, which is your whole ${money(capCents)} cap.` : `You already hold ${money(ctx.pledgedCents)}, so only ${money(room)} more fits under your ${money(capCents)} cap.`);
  if (ctx.nextTierGapCents && holdNowCents >= ctx.nextTierGapCents && ctx.nextTierTitle) warnings.push(`Nice: ${money(holdNowCents)} alone unlocks ${ctx.nextTierTitle}.`);
  const summary = capCents > softCents
    ? `Hold ${money(holdNowCents)} now. Your private cap is ${money(capCents)}, so you can top up later if the group is close${d.payday ? ` (you’re paid ${d.paydayPhrase ?? d.payday})` : ''}.`
    : `Hold ${money(holdNowCents)}, and that’s your limit${d.payday ? ` (you’re paid ${d.paydayPhrase ?? d.payday})` : ''}.`;
  return { softCents, capCents, payday: d.payday, paydayPhrase: d.paydayPhrase, holdNowCents, warnings, summary };
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
export type ConciergeIn = { candidates: { id: string; title: string; rare: boolean; traits: string[]; votes: number; citedFriends: string[]; tiers: { level: number; title: string; thresholdCents: number }[] }[];
  traitKeeps: Record<string, number>; groupBudgetCents: number; members: number };
export type ConciergePick = { candidateId: string; title: string; score: number; reachableTier: { level: number; title: string; thresholdCents: number } | null;
  nextTier: { level: number; title: string; thresholdCents: number } | null; why: string };
/** Rank gifts by what the group actually kept and voted for, then check them against everyone's combined budget caps.
 * Only the reachable tier is shown, never the sum, so no one can back out a friend's private budget. */
export function conciergeRules(x: ConciergeIn): ConciergePick[] {
  return x.candidates.map(c => {
    const keeps = c.traits.reduce((a, t) => a + (x.traitKeeps[t] ?? 0), 0);
    const tiers = [...c.tiers].sort((a, b) => a.thresholdCents - b.thresholdCents);
    const reach = [...tiers].reverse().find(t => t.thresholdCents <= x.groupBudgetCents) ?? null;
    const nxt = tiers.find(t => t.thresholdCents > x.groupBudgetCents) ?? null;
    const fits = reach ? reach.level : 0;
    const score = keeps * 2 + c.votes * 3 + (c.rare ? 2 : 0) + c.citedFriends.length + fits;
    const kept = c.traits.filter(t => x.traitKeeps[t]).map(t => `${t} (kept ×${x.traitKeeps[t]})`);
    const why = `${kept.length ? `Built on ${kept.join(' and ')}` : `Built on ${c.traits.join(' and ')}`}${c.citedFriends.length ? `, from ${names(c.citedFriends)}’s cards` : ''}. ${reach ? `Your group’s combined budget reaches tier ${reach.level} (${money(reach.thresholdCents)}).` : `Even tier 1 (${money(tiers[0]?.thresholdCents ?? 0)}) is above the group’s combined budget so far.`}`;
    return { candidateId: c.id, title: c.title, score, reachableTier: reach, nextTier: nxt ? { level: nxt.level, title: nxt.title.replace(/^\+ /, ''), thresholdCents: nxt.thresholdCents } : null, why };
  }).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}
