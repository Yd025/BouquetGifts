// Pure domain logic: questions, traits, fusion, tiers, capture allocation.
import { catalogTiers, productsFor } from './catalog.js';
export type Option = { label: string; trait?: string; avoid?: string };
export type Question = { id: string; kind: 'shared' | 'random'; prompt: string; options: Option[] };

export const QUESTIONS: Question[] = [
  { id: 's1', kind: 'shared', prompt: 'Their perfect Saturday morning is…', options: [
    { label: 'A sunrise hike', trait: 'Sunrise Hiker' }, { label: 'A slow pour-over at home', trait: 'Coffee Snob' },
    { label: 'Sleeping in, then brunch', trait: 'Brunch Royalty' }, { label: 'Making something with their hands', trait: 'Maker' } ] },
  { id: 's2', kind: 'shared', prompt: 'What do they never shut up about lately?', options: [
    { label: 'Film photography', trait: 'Film Shooter' }, { label: 'A new album or concert', trait: 'Music Head' },
    { label: 'Their plants', trait: 'Plant Parent' }, { label: 'A book series', trait: 'Bookworm' } ] },
  { id: 's3', kind: 'shared', prompt: 'Their space is…', options: [
    { label: 'Minimal — they hate clutter', trait: 'Hates Clutter' }, { label: 'Cozy and full of blankets', trait: 'Cozy Nester' },
    { label: 'Always mid-project', trait: 'Maker' }, { label: 'Basically a jungle', trait: 'Plant Parent' } ] },
  { id: 's4', kind: 'shared', prompt: 'Which gift would secretly annoy them?', options: [
    { label: 'Random knick-knacks', avoid: 'clutter' }, { label: 'Anything that needs a manual', avoid: 'complex' },
    { label: 'Tickets to something loud', avoid: 'experience' }, { label: 'Honestly, nothing — they love everything', avoid: 'none' } ] },
  { id: 'r1', kind: 'random', prompt: 'If they had a free plane ticket, they would…', options: [
    { label: 'Go camping in a national park', trait: 'Sunrise Hiker' }, { label: 'Café-hop through Lisbon', trait: 'Coffee Snob' },
    { label: 'Catch a festival', trait: 'Music Head' }, { label: 'Find a cabin and read', trait: 'Bookworm' } ] },
  { id: 'r2', kind: 'random', prompt: 'Their camera roll is mostly…', options: [
    { label: 'Mountains and trails', trait: 'Sunrise Hiker' }, { label: 'Grainy film scans', trait: 'Film Shooter' },
    { label: 'Latte art', trait: 'Coffee Snob' }, { label: 'Their cat on a blanket', trait: 'Cozy Nester' } ] },
  { id: 'r3', kind: 'random', prompt: 'Their go-to comfort is…', options: [
    { label: 'A long walk outside', trait: 'Sunrise Hiker' }, { label: 'A blanket and a series', trait: 'Cozy Nester' },
    { label: 'A perfect latte', trait: 'Coffee Snob' }, { label: 'Headphones on, world off', trait: 'Music Head' } ] },
  { id: 'r4', kind: 'random', prompt: 'On a road trip they control…', options: [
    { label: 'The playlist, obviously', trait: 'Music Head' }, { label: 'The snack budget', trait: 'Brunch Royalty' },
    { label: 'The trail map', trait: 'Sunrise Hiker' }, { label: 'Nothing, they are reading', trait: 'Bookworm' } ] },
  { id: 'r5', kind: 'random', prompt: 'Their weekend side quest is…', options: [
    { label: 'Repotting something', trait: 'Plant Parent' }, { label: 'Developing a roll of film', trait: 'Film Shooter' },
    { label: 'Building or fixing things', trait: 'Maker' }, { label: 'Finding the best croissant', trait: 'Brunch Royalty' } ] },
];

/** Deterministic PRNG (mulberry32) from a string seed. */
export function rng(seed: string) {
  let h = 1779033703;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), h = (h << 13) | (h >>> 19);
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Every member gets all shared questions + 2 random ones, seeded per member so it is stable. */
export function drawQuestions(seed: string, nRandom = 2): Question[] {
  const r = rng(seed);
  const pool = QUESTIONS.filter(q => q.kind === 'random').slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return [...QUESTIONS.filter(q => q.kind === 'shared'), ...pool.slice(0, nRandom)];
}

/** Map answers (questionId -> option index) to the member's top traits. */
export function traitsFromAnswers(answers: Record<string, number>): string[] {
  const counts = new Map<string, number>();
  for (const [qid, idx] of Object.entries(answers)) {
    const q = QUESTIONS.find(x => x.id === qid); const o = q?.options[idx];
    if (o?.trait) counts.set(o.trait, (counts.get(o.trait) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(e => e[0]);
}
/** Trait stats for card chips: how many answers pointed at each kept trait. */
export function traitStats(answers: Record<string, number>) {
  const counts = new Map<string, number>();
  for (const [qid, idx] of Object.entries(answers)) { const o = QUESTIONS.find(x => x.id === qid)?.options[idx]; if (o?.trait) counts.set(o.trait, (counts.get(o.trait) ?? 0) + 1); }
  return traitsFromAnswers(answers).map(label => ({ label, count: counts.get(label) ?? 0 }));
}
export function avoidsFromAnswers(answers: Record<string, number>): string[] {
  return Object.entries(answers).map(([qid, idx]) => QUESTIONS.find(x => x.id === qid)?.options[idx]?.avoid).filter((a): a is string => !!a && a !== 'none');
}
/** The card title always comes from the friend's own top two traits, so it matches the chips. */
const ADJ: Record<string, string> = { 'Sunrise Hiker': 'Trail-Ready', 'Coffee Snob': 'Caffeinated', 'Brunch Royalty': 'Brunch-Loving', Maker: 'Crafty', 'Film Shooter': 'Grainy',
  'Music Head': 'Rhythm-Driven', 'Plant Parent': 'Green-Thumbed', Bookworm: 'Well-Read', 'Hates Clutter': 'Minimalist', 'Cozy Nester': 'Cozy' };
export function cardTitle(traits: string[]) {
  if (!traits.length) return 'The Mystery';
  return traits[1] ? `The ${ADJ[traits[1]] ?? ''} ${traits[0]}`.replace('  ', ' ') : `The ${traits[0]}`;
}
/** Chip order on a card: most answers first. Among equal counts, the traits the card's title names come first
 *  (so "The Caffeinated Sunrise Hiker" lists Coffee Snob ×1 before Bookworm ×1), then A–Z. Counts never change. */
export function orderStatsForTitle<T extends { label: string; count: number }>(stats: T[], title: string | null | undefined): T[] {
  const t = (title ?? '').toLowerCase();
  const named = (l: string) => (t.includes(l.toLowerCase()) || (!!ADJ[l] && t.includes(ADJ[l].toLowerCase())) ? 0 : 1);
  return [...stats].sort((a, b) => b.count - a.count || named(a.label) - named(b.label) || a.label.localeCompare(b.label));
}
/** Every friend's card in a bouquet gets its own title, still built only from that friend's traits (so it matches the chips).
 *  Tries "adjective of one trait + another trait" in priority order, then numbers the first option. */
export function uniqueCardTitle(traits: string[], taken: string[]) {
  const used = new Set(taken.map(t => t.toLowerCase())); const first = cardTitle(traits);
  const nounUsed = (n: string) => taken.some(t => t.toLowerCase().endsWith(n.toLowerCase()));
  if (!used.has(first.toLowerCase()) && !(traits[0] && nounUsed(traits[0]) && traits.slice(1).some(n => !nounUsed(n)))) return first;
  // Prefer a noun no other card ends with, so the table doesn't read "… Sunrise Hiker" three times.
  const nouns = [...traits.filter(n => !nounUsed(n)), ...traits.filter(n => nounUsed(n))];
  for (const noun of nouns) for (const adj of traits) if (adj !== noun && ADJ[adj]) {
    const t = `The ${ADJ[adj]} ${noun}`; if (!used.has(t.toLowerCase())) return t; }
  for (let n = 2; ; n++) { const t = `${first} No. ${n}`; if (!used.has(t.toLowerCase())) return t; }
}
/** Theme words for generic gifts, so titles read like gifts ("Bookshelf & Trailhead Duo Box") rather than repeating trait names. */
export const THEME: Record<string, string> = { 'Sunrise Hiker': 'Trailhead', 'Coffee Snob': 'Café', 'Brunch Royalty': 'Brunch', Maker: 'Workshop', 'Film Shooter': 'Darkroom',
  'Music Head': 'Listening', 'Plant Parent': 'Greenhouse', Bookworm: 'Bookshelf', 'Hates Clutter': 'Minimalist', 'Cozy Nester': 'Cozy Corner' };
export const theme = (t: string) => THEME[t] ?? t;
export const duoTitle = (a: string, b: string) => { const [x, y] = [a, b].sort(); return `${theme(x)} & ${theme(y)} Duo Box`; };
/** Recipient-side: trait names become compliments. */
export const COMPLIMENTS: Record<string, string> = { 'Sunrise Hiker': 'You chase every sunrise', 'Coffee Snob': 'Your taste is impeccable', 'Brunch Royalty': 'You make weekends feel like holidays',
  Maker: 'You build beautiful things', 'Film Shooter': 'You see the world in golden hour', 'Music Head': 'You’re the soundtrack of every road trip', 'Plant Parent': 'You make everything grow',
  Bookworm: 'You live a thousand lives', 'Hates Clutter': 'You keep life beautifully simple', 'Cozy Nester': 'You make every place feel like home' };
export const compliment = (t: string) => COMPLIMENTS[t] ?? `You’re one of a kind`;

export type Recipe = { traits: [string, string]; rare: boolean; title: string; description: string; tags?: string[];
  tiers: { title: string; threshold_cents: number }[] };

export const RECIPES: Recipe[] = [
  { traits: ['Sunrise Hiker', 'Coffee Snob'], rare: true, title: 'Summit Pour-Over Kit', tags: ['complex'], description: 'A packable pour-over set, a hand grinder and single-origin beans for coffee at the trailhead.',
    tiers: [{ title: 'Camp pour-over kit', threshold_cents: 6000 }, { title: '+ hand burr grinder', threshold_cents: 12000 }, { title: '+ 3-month single-origin subscription', threshold_cents: 20000 }] },
  { traits: ['Film Shooter', 'Sunrise Hiker'], rare: true, title: 'Trail Film Camera Set', tags: ['complex'], description: 'A 35mm point-and-shoot, Kodak Gold film, and an instant camera for golden-hour hikes.',
    tiers: [{ title: 'Point-and-shoot film camera', threshold_cents: 8000 }, { title: '+ 5 rolls of Portra', threshold_cents: 14000 }, { title: '+ lab dev & scan credits', threshold_cents: 22000 }] },
  { traits: ['Music Head', 'Cozy Nester'], rare: false, title: 'Vinyl Night In', tags: ['clutter'], description: 'A record they love, a soft throw, and a turntable for long nights in.',
    tiers: [{ title: 'Two records they love', threshold_cents: 5000 }, { title: '+ weighted listening blanket', threshold_cents: 11000 }, { title: '+ concert tickets', threshold_cents: 25000 }] },
  { traits: ['Plant Parent', 'Hates Clutter'], rare: true, title: 'Self-Watering Plant Wall', description: 'Self-watering globes, a trailing plant and a grow light: greenery that looks after itself.',
    tiers: [{ title: 'Self-watering planter set', threshold_cents: 5000 }, { title: '+ rare plant cuttings', threshold_cents: 10000 }, { title: '+ smart grow light', threshold_cents: 18000 }] },
  { traits: ['Bookworm', 'Coffee Snob'], rare: false, title: 'Reading Nook Ritual', tags: ['clutter'], description: 'Good beans, a handmade mug and a throw for the reading chair.',
    tiers: [{ title: 'Book box + artisan beans', threshold_cents: 4500 }, { title: '+ handmade ceramic mug', threshold_cents: 9000 }, { title: '+ e-reader', threshold_cents: 20000 }] },
  { traits: ['Maker', 'Hates Clutter'], rare: false, title: 'Pocket Maker Kit', tags: ['complex'], description: 'A minimal analog planning system and a precision pen for an organized maker.',
    tiers: [{ title: 'Precision tool roll', threshold_cents: 5000 }, { title: '+ workshop class', threshold_cents: 12000 }, { title: '+ desktop project kit', threshold_cents: 20000 }] },
  { traits: ['Brunch Royalty', 'Music Head'], rare: false, title: 'Brunch & Beats Day', tags: ['clutter'], description: 'A Sunday Morning mug, a greatest-hits record and a turntable for slow brunches at home.',
    tiers: [{ title: 'Brunch for two', threshold_cents: 6000 }, { title: '+ show tickets', threshold_cents: 15000 }, { title: '+ hotel night', threshold_cents: 30000 }] },
];

// Real-product tiers from the curated catalog override the placeholder tiers above.
for (const r of RECIPES) { const t = catalogTiers(r.title); if (t) r.tiers = t; }

export type TraitAgg = { label: string; memberIds: string[]; cardIds: string[] };

export function aggregateTraits(cards: { id: string; memberId: string; traits: string[] }[]): TraitAgg[] {
  const m = new Map<string, TraitAgg>();
  for (const c of cards) for (const t of c.traits) {
    const a = m.get(t) ?? { label: t, memberIds: [], cardIds: [] };
    if (!a.memberIds.includes(c.memberId)) a.memberIds.push(c.memberId);
    a.cardIds.push(c.id); m.set(t, a);
  }
  return [...m.values()].sort((a, b) => b.memberIds.length - a.memberIds.length || a.label.localeCompare(b.label));
}

export type Candidate = { title: string; description: string; rare: boolean; kind: 'rare' | 'match' | 'safe' | 'wildcard'; traits: string[]; memberIds: string[]; tiers: Recipe['tiers']; tags: string[] };
const GENERIC_TIERS = [{ title: 'Curated box', threshold_cents: 4000 }, { title: '+ premium upgrade', threshold_cents: 9000 }, { title: '+ experience add-on', threshold_cents: 16000 }];
const DUO_TIERS = [{ title: 'Curated duo box', threshold_cents: 4500 }, { title: '+ premium upgrade', threshold_cents: 9500 }, { title: '+ experience add-on', threshold_cents: 17000 }];
/** Tiers for a non-recipe gift: the real products from its traits (thresholds = cumulative prices), placeholder tiers only if uncovered. */
const giftTiers = (title: string, traits: string[], fallback: Recipe['tiers']) => catalogTiers(title, traits) ?? fallback;
/** "A, B and C" from the gift's real product labels, for blurbs that say what is actually in the box. */
const contents = (title: string, traits: string[]) => { const ps = productsFor(title, traits).map(p => p.tierTitle.replace(/^\+\s*/, ''));
  return ps.length ? ps.slice(0, -1).join(', ') + (ps.length > 1 ? ' and ' : '') + ps[ps.length - 1] : ''; };
/** Fuse traits into 3+ candidates: recipe fusions (rare ones need >=2 friends on both traits), a safe pick, and a wildcard.
 *  `avoid` = anti-gift tags; a candidate is dropped when its tag was named by at least half the cards (min 1). */
export function fuse(traits: TraitAgg[], minConsensus = 2, avoid: { tags: string[]; cards: number } = { tags: [], cards: 0 }) {
  const by = new Map(traits.map(t => [t.label, t]));
  const need = Math.max(1, Math.ceil(avoid.cards / 2));
  const tally = new Map<string, number>(); avoid.tags.forEach(t => tally.set(t, (tally.get(t) ?? 0) + 1));
  const blocked = new Set([...tally].filter(([, n]) => n >= need).map(([t]) => t));
  const ok = (tags: string[]) => !tags.some(t => blocked.has(t));
  const out: Candidate[] = [];
  const add = (c: Candidate) => { if (!out.some(o => o.title === c.title) && ok(c.tags)) out.push(c); };
  for (const r of RECIPES) {
    const a = by.get(r.traits[0]), b = by.get(r.traits[1]);
    if (!a || !b) continue;
    if (r.rare && (a.memberIds.length < minConsensus || b.memberIds.length < minConsensus)) continue;
    add({ title: r.title, description: r.description, rare: r.rare, kind: r.rare ? 'rare' : 'match', traits: [...r.traits], tags: r.tags ?? [],
      memberIds: [...new Set([...a.memberIds, ...b.memberIds])], tiers: r.tiers });
  }
  const sorted = [...traits].sort((x, y) => y.memberIds.length - x.memberIds.length || x.label.localeCompare(y.label));
  if (sorted[0]) { const t = sorted[0];
    add(treasureBox(t, `A safe bet for a true ${t.label}, the trait most friends named`, 'safe')); }
  // Wildcard: the group favourite + the least-noticed trait, skipping pairs a named recipe already covers (no look-alike gifts).
  const hasRecipe = (a: string, b: string) => RECIPES.some(r => r.traits.includes(a) && r.traits.includes(b));
  if (sorted.length >= 2) { const t = sorted[0]; const w = [...sorted].reverse().find(x => x !== t && !hasRecipe(t.label, x.label));
    if (w) { const [x, y] = [t.label, w.label].sort(); const blurb = contents(duoTitle(x, y), [x, y]);
      add({ title: duoTitle(x, y), description: `Wildcard: pairs the group favourite with the trait only ${w.memberIds.length} friend noticed${blurb ? `: ${blurb}` : ''}.`, rare: false, kind: 'wildcard', traits: [x, y],
        memberIds: [...new Set([...t.memberIds, ...w.memberIds])], tiers: giftTiers(duoTitle(x, y), [x, y], DUO_TIERS), tags: [] }); } }
  // Still short of 3? Treasure Boxes for the next most-named traits (real products), before any product-less last resort.
  for (const t of sorted.slice(1)) { if (out.length >= 3) break; add(treasureBox(t, `A curated box for their ${t.label} side`, 'wildcard')); }
  for (const extra of [{ title: 'Memory Lane Photo Book', d: 'A printed book of the group’s favourite moments together.' }, { title: 'Day of Their Favourite Things', d: 'A planned day out built from everyone’s answers.' }]) {
    if (out.length >= 3) break;
    add({ title: extra.title, description: extra.d, rare: false, kind: 'wildcard', traits: sorted.slice(0, 1).map(t => t.label), memberIds: [...new Set(traits.flatMap(t => t.memberIds))], tiers: GENERIC_TIERS, tags: [] });
  }
  function treasureBox(t: TraitAgg, lead: string, kind: Candidate['kind']): Candidate {
    const title = `${t.label} Treasure Box`; const blurb = contents(title, [t.label]);
    return { title, description: blurb ? `${lead}: ${blurb}.` : `${lead}.`, rare: false, kind, traits: [t.label], memberIds: t.memberIds, tiers: giftTiers(title, [t.label], GENERIC_TIERS), tags: [] };
  }
  const rank = { rare: 0, match: 1, safe: 2, wildcard: 3 };
  const sortedOut = out.sort((x, y) => rank[x.kind] - rank[y.kind] || y.memberIds.length - x.memberIds.length);
  const taken = new Set<string>();
  return sortedOut.map(c => { const o = preferFreshHero(c, taken); const h = productsFor(o.title, o.traits)[0]?.url; if (h) taken.add(h); return o; });
}

/** A Duo Box leads with one trait's hero product. If that photo is already on the gift table (e.g. the Treasure Box for the
 *  same trait), lead with the other trait instead, so the table never shows the same photo twice. Recipes are left alone. */
export function preferFreshHero<C extends { title: string; traits: string[]; tiers: Recipe['tiers']; description: string }>(c: C, taken: Set<string>): C {
  if (c.traits.length !== 2 || RECIPES.some(r => r.title === c.title)) return c;
  const hero = productsFor(c.title, c.traits)[0]?.url; if (!hero || !taken.has(hero)) return c;
  const flipped = [c.traits[1], c.traits[0]]; const fresh = productsFor(c.title, flipped)[0]?.url; if (!fresh || taken.has(fresh)) return c;
  const before = contents(c.title, c.traits);
  return { ...c, traits: flipped, tiers: giftTiers(c.title, flipped, DUO_TIERS), description: before ? c.description.replace(before, contents(c.title, flipped)) : c.description };
}

export function highestFundedTier<T extends { threshold_cents: number }>(tiers: T[], totalCents: number): T | null {
  return tiers.filter(t => t.threshold_cents <= totalCents).sort((a, b) => b.threshold_cents - a.threshold_cents)[0] ?? null;
}

export function nextTier<T extends { threshold_cents: number }>(tiers: T[], totalCents: number): T | null {
  return tiers.filter(t => t.threshold_cents > totalCents).sort((a, b) => a.threshold_cents - b.threshold_cents)[0] ?? null;
}

/** Split a capture target pro-rata across holds (integer cents, largest-remainder, never exceeds any hold). */
export function allocateCapture(holds: { id: string; amount_cents: number }[], targetCents: number): Map<string, number> {
  const total = holds.reduce((s, h) => s + h.amount_cents, 0);
  const res = new Map<string, number>();
  if (total <= 0 || targetCents <= 0) { holds.forEach(h => res.set(h.id, 0)); return res; }
  const target = Math.min(targetCents, total);
  const parts = holds.map(h => { const exact = (h.amount_cents * target) / total; return { h, base: Math.floor(exact), frac: exact - Math.floor(exact) }; });
  let rem = target - parts.reduce((s, p) => s + p.base, 0);
  parts.sort((a, b) => b.frac - a.frac || a.h.id.localeCompare(b.h.id));
  for (const p of parts) { let v = p.base; if (rem > 0 && v < p.h.amount_cents) { v++; rem--; } res.set(p.h.id, v); }
  return res;
}

const PALETTES = [['#f7a1c4', '#ffd6e7'], ['#c3a6ff', '#ece2ff'], ['#ffb38a', '#ffe3d1'], ['#8fd3c1', '#d9f5ec'], ['#f5d06f', '#fff3c9'], ['#9ec5ff', '#e0edff'], ['#ff8f8f', '#ffe0e0']];
/** Unique flower design for a card back, derived from a seed. */
export function flowerBack(seed: string) {
  const r = rng(seed); const p = PALETTES[Math.floor(r() * PALETTES.length)];
  return { petals: 5 + Math.floor(r() * 7), petalColor: p[0], bgColor: p[1], centerColor: ['#f6c34a', '#ffffff', '#c9a7e8', '#e8735a'][Math.floor(r() * 4)],
    rotation: Math.floor(r() * 360), layers: 1 + Math.floor(r() * 3), petalShape: r() > 0.5 ? 'round' : 'pointed' };
}

export const SIM_SWAP_HOLD_THRESHOLD_CENTS = 5000;

export type Rarity = 'common' | 'rare' | 'legendary';
export const rarity = (consensus: number): Rarity => consensus >= 3 ? 'legendary' : consensus >= 2 ? 'rare' : 'common';

/** Fuse two hand cards. Support = max(card consensus, friends who kept it). Rare recipes need support >= 2 on both. */
export function fusePair(a: { label: string; support: number; memberIds: string[] }, b: { label: string; support: number; memberIds: string[] }, minConsensus = 2) {
  if (a.label === b.label) return { ok: false as const, reason: 'Pick two different cards' };
  const r = RECIPES.find(x => (x.traits[0] === a.label && x.traits[1] === b.label) || (x.traits[0] === b.label && x.traits[1] === a.label));
  const memberIds = [...new Set([...a.memberIds, ...b.memberIds])];
  if (r) {
    if (r.rare && (a.support < minConsensus || b.support < minConsensus))
      return { ok: false as const, reason: `${r.title} is a rare fusion — it needs 2+ friends behind both ${a.label} and ${b.label}` };
    return { ok: true as const, candidate: { title: r.title, description: r.description, rare: r.rare, traits: [...r.traits], memberIds, tiers: r.tiers } };
  }
  const traits = [a.label, b.label].sort(); const title = duoTitle(a.label, b.label); const blurb = contents(title, traits);
  return { ok: true as const, candidate: { title, description: `A curated mix for someone who is both ${a.label} and ${b.label}${blurb ? `: ${blurb}` : ''}.`, rare: false,
    traits, memberIds, tiers: giftTiers(title, traits, DUO_TIERS) } };
}
