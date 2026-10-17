import { describe, it, expect } from 'vitest';
import * as D from '../src/domain.js';
import { coverLevel, productAt, traitProducts } from '../src/catalog.js';
describe('questions', () => {
  it('always includes shared questions and 2 seeded random ones', () => {
    const a = D.drawQuestions('mem_a'), a2 = D.drawQuestions('mem_a');
    expect(a.map(q => q.id)).toEqual(a2.map(q => q.id));
    expect(a.filter(q => q.kind === 'shared')).toHaveLength(4); expect(a.filter(q => q.kind === 'random')).toHaveLength(2);
  });
  it('different members get different random questions (sometimes)', () => {
    const sets = new Set(Array.from({ length: 20 }, (_, i) => D.drawQuestions('m' + i).slice(4).map(q => q.id).sort().join()));
    expect(sets.size).toBeGreaterThan(2);
  });
  it('maps answers to top traits', () => expect(D.traitsFromAnswers({ s1: 0, s2: 0, r1: 0 })[0]).toBe('Sunrise Hiker'));
});
describe('fusion consensus', () => {
  const cards = (spec: string[][]) => spec.map((t, i) => ({ id: 'c' + i, memberId: 'm' + i, traits: t }));
  it('rare fusion requires 2+ friends on both traits', () => {
    const one = D.fuse(D.aggregateTraits(cards([['Sunrise Hiker', 'Coffee Snob'], ['Bookworm']])));
    expect(one.find(c => c.title === 'Summit Pour-Over Kit')).toBeUndefined();
    const two = D.fuse(D.aggregateTraits(cards([['Sunrise Hiker', 'Coffee Snob'], ['Sunrise Hiker', 'Coffee Snob'], ['Bookworm']])));
    const k = two.find(c => c.title === 'Summit Pour-Over Kit')!;
    expect(k.rare).toBe(true); expect(k.memberIds.sort()).toEqual(['m0', 'm1']); expect(two[0].rare).toBe(true);
  });
  it('common fusions work with one friend each and cite them', () => {
    const r = D.fuse(D.aggregateTraits(cards([['Bookworm'], ['Coffee Snob']])));
    expect(r[0].title).toBe('Reading Nook Ritual'); expect(r[0].memberIds).toEqual(['m0', 'm1']);
  });
  it('falls back to a single-trait gift', () => expect(D.fuse(D.aggregateTraits(cards([['Maker']])))[0].title).toContain('Maker'));
  it('always yields 3+ candidates with safe and wildcard kinds, no duplicates', () => {
    for (const spec of [[['Maker']], [['Bookworm'], ['Coffee Snob']], [['Sunrise Hiker', 'Coffee Snob'], ['Sunrise Hiker', 'Coffee Snob'], ['Bookworm']]]) {
      const r = D.fuse(D.aggregateTraits(cards(spec))); expect(r.length).toBeGreaterThanOrEqual(3);
      expect(new Set(r.map(c => c.title)).size).toBe(r.length); expect(r.some(c => c.kind === 'safe')).toBe(true);
    }
  });
  it('anti-gift answers filter candidates when half the cards name them', () => {
    const agg = D.aggregateTraits(cards([['Bookworm', 'Coffee Snob'], ['Bookworm', 'Coffee Snob']]));
    expect(D.fuse(agg).some(c => c.title === 'Reading Nook Ritual')).toBe(true);
    expect(D.fuse(agg, 2, { tags: ['clutter'], cards: 2 }).some(c => c.title === 'Reading Nook Ritual')).toBe(false);
    expect(D.fuse(agg, 2, { tags: ['clutter'], cards: 4 }).some(c => c.title === 'Reading Nook Ritual')).toBe(true);
    expect(D.fuse(agg, 2, { tags: ['clutter'], cards: 2 }).length).toBeGreaterThanOrEqual(3);
  });
});
describe('tiers and capture', () => {
  const tiers = [{ id: 'a', threshold_cents: 6000 }, { id: 'b', threshold_cents: 12000 }, { id: 'c', threshold_cents: 20000 }];
  it('picks highest fully funded tier', () => {
    expect(D.highestFundedTier(tiers, 5999)).toBeNull(); expect(D.highestFundedTier(tiers, 6000)!.id).toBe('a');
    expect(D.highestFundedTier(tiers, 19999)!.id).toBe('b'); expect(D.highestFundedTier(tiers, 99999)!.id).toBe('c');
    expect(D.nextTier(tiers, 12000)!.id).toBe('c'); expect(D.nextTier(tiers, 20000)).toBeNull();
  });
  it('allocates capture pro-rata in integer cents, exact sum, never above a hold', () => {
    const holds = [{ id: 'x', amount_cents: 3333 }, { id: 'y', amount_cents: 5000 }, { id: 'z', amount_cents: 7001 }];
    const a = D.allocateCapture(holds, 12000);
    expect([...a.values()].reduce((s, v) => s + v, 0)).toBe(12000);
    for (const h of holds) expect(a.get(h.id)!).toBeLessThanOrEqual(h.amount_cents);
    for (let i = 0; i < 200; i++) { const hs = Array.from({ length: 1 + (i % 7) }, (_, j) => ({ id: 'h' + j, amount_cents: 100 + ((i * 37 + j * 911) % 9000) }));
      const tot = hs.reduce((s, h) => s + h.amount_cents, 0), t = Math.floor(tot * ((i % 10) / 10)); const al = D.allocateCapture(hs, t);
      expect([...al.values()].reduce((s, v) => s + v, 0)).toBe(t); hs.forEach(h => expect(al.get(h.id)!).toBeLessThanOrEqual(h.amount_cents)); }
  });
  it('flower backs are deterministic and varied', () => {
    expect(D.flowerBack('a')).toEqual(D.flowerBack('a'));
    expect(new Set(Array.from({ length: 30 }, (_, i) => JSON.stringify(D.flowerBack('s' + i)))).size).toBe(30);
  });
});
describe('deck fusion (fusePair)', () => {
  const t = (label: string, support: number, m = ['m1']) => ({ label, support, memberIds: m });
  it('matches recipes in either order and merges cited friends', () => {
    const r = D.fusePair(t('Coffee Snob', 1, ['a']), t('Bookworm', 1, ['b'])); expect(r.ok && r.candidate.title).toBe('Reading Nook Ritual');
    expect(r.ok && r.candidate.memberIds.sort()).toEqual(['a', 'b']);
  });
  it('rare recipes need consensus on both cards', () => {
    expect(D.fusePair(t('Sunrise Hiker', 2), t('Coffee Snob', 1)).ok).toBe(false);
    expect(D.fusePair(t('Sunrise Hiker', 2), t('Coffee Snob', 2)).ok).toBe(true);
  });
  it('unknown pairs give a duo box; same card is rejected', () => {
    const r = D.fusePair(t('Maker', 1), t('Bookworm', 1)); expect(r.ok && r.candidate.title).toBe('Bookshelf & Workshop Duo Box');
    expect(D.fusePair(t('Maker', 1), t('Maker', 1)).ok).toBe(false);
  });
  it('rarity tiers', () => { expect(D.rarity(1)).toBe('common'); expect(D.rarity(2)).toBe('rare'); expect(D.rarity(3)).toBe('legendary'); });
});

describe('cards match answers', () => {
  it('title is built from the same top traits as the chips', () => {
    const ans = { s1: 1, s2: 0, s3: 0, s4: 0, r1: 1 }; const t = D.traitsFromAnswers(ans);
    expect(t[0]).toBe('Coffee Snob'); expect(D.cardTitle(t)).toContain('Coffee Snob'); expect(D.cardTitle(t)).toContain('Grainy');
    expect(D.traitStats(ans)[0]).toEqual({ label: 'Coffee Snob', count: 2 }); expect(D.avoidsFromAnswers(ans)).toEqual(['clutter']);
    expect(D.avoidsFromAnswers({ s4: 3 })).toEqual([]);
  });
  it('friends with the same traits still get distinct titles, built only from their own traits', () => {
    const tr = ['Sunrise Hiker', 'Bookworm', 'Coffee Snob']; const titles: string[] = [];
    for (let i = 0; i < 5; i++) titles.push(D.uniqueCardTitle(tr, titles));
    expect(titles[0]).toBe('The Well-Read Sunrise Hiker'); expect(new Set(titles).size).toBe(5);
    for (const t of titles) expect(tr.some(x => t.includes(x))).toBe(true);
    expect(D.uniqueCardTitle(tr, ['the well-read sunrise hiker'])).not.toBe('The Well-Read Sunrise Hiker');
  });
  it('generic gift titles read like gifts, not doubled trait names', () => {
    const agg = [{ label: 'Bookworm', memberIds: ['a', 'b'], cardIds: [] }, { label: 'Brunch Royalty', memberIds: ['a'], cardIds: [] }];
    const titles = D.fuse(agg).map(c => c.title);
    expect(titles).toContain('Bookworm Treasure Box'); expect(titles).toContain('Bookshelf & Brunch Duo Box');
    for (const t of titles) { expect(t).not.toContain('×'); expect(t).not.toContain(' + '); }
  });
  it('the wildcard never duplicates a named recipe for the same two traits', () => {
    const agg = [{ label: 'Coffee Snob', memberIds: ['a', 'b', 'c'], cardIds: [] }, { label: 'Bookworm', memberIds: ['a'], cardIds: [] }, { label: 'Brunch Royalty', memberIds: ['b', 'c'], cardIds: [] }];
    const titles = D.fuse(agg).map(c => c.title);
    expect(titles).toContain('Reading Nook Ritual'); expect(titles).not.toContain('Bookshelf & Café Duo Box'); expect(titles).toContain('Brunch & Café Duo Box');
  });
  it('a duo box leads with a photo that is not already on the gift table', () => {
    const agg = [{ label: 'Bookworm', memberIds: ['a', 'b', 'c'], cardIds: [] }, { label: 'Sunrise Hiker', memberIds: ['a'], cardIds: [] }];
    const r = D.fuse(agg); const tb = r.find(c => c.title === 'Bookworm Treasure Box')!; const duo = r.find(c => c.title === 'Bookshelf & Trailhead Duo Box')!;
    expect(duo.traits[0]).toBe('Sunrise Hiker'); expect(duo.tiers[0].title).toBe('Topo Designs wool knit beanie'); expect(tb.tiers[0].title).toBe('Out of Print Library Card tote');
    expect(duo.description).toContain('Topo Designs wool knit beanie, Out of Print Library Card tote');
  });
  it('when both traits\' heroes are already on the table, a hand-fused duo leads with another product from its own box', () => {
    const title = 'Bookshelf & Trailhead Duo Box', traits = ['Bookworm', 'Sunrise Hiker'];
    const taken = new Set([traitProducts('Bookworm')[0].url, traitProducts('Sunrise Hiker')[0].url]); // both Treasure Boxes are on the table
    const lvl = coverLevel(title, traits, taken); expect(lvl).toBe(3);
    const cover = productAt(title, lvl!, traits)!; expect(taken.has(cover.url)).toBe(false); expect(cover.tierTitle).toBe('+ East Fork handmade mug');
    expect(coverLevel(title, traits, new Set())).toBeNull(); // nothing taken: default cover (tier 1)
  });
  it('generic gifts say what is really in the box', () => {
    const tb = D.fuse([{ label: 'Bookworm', memberIds: ['a'], cardIds: [] }]).find(c => c.title === 'Bookworm Treasure Box')!;
    expect(tb.description).toContain('Library Card tote'); expect(tb.tiers[0].title).toBe('Out of Print Library Card tote');
    const r = D.fusePair({ label: 'Maker', support: 1, memberIds: ['a'] }, { label: 'Bookworm', support: 1, memberIds: ['b'] });
    expect(r.ok && r.candidate.tiers.map(t => t.title)).toEqual(['Out of Print Library Card tote', '+ Craighill Spectra scissors', '+ East Fork handmade mug']);
  });
  it('compliments', () => expect(D.compliment('Sunrise Hiker')).toBe('You chase every sunrise'));
  it('orders card chips by count, then the traits the title names, then A–Z', () => {
    const stats = [{ label: 'Sunrise Hiker', count: 2 }, { label: 'Bookworm', count: 1 }, { label: 'Coffee Snob', count: 1 }];
    expect(D.orderStatsForTitle(stats, 'The Caffeinated Sunrise Hiker').map(s => s.label)).toEqual(['Sunrise Hiker', 'Coffee Snob', 'Bookworm']);
    expect(D.orderStatsForTitle(stats, 'The Well-Read Sunrise Hiker').map(s => s.label)).toEqual(['Sunrise Hiker', 'Bookworm', 'Coffee Snob']);
    expect(D.orderStatsForTitle(stats, 'A poem by Grok').map(s => s.label)).toEqual(['Sunrise Hiker', 'Bookworm', 'Coffee Snob']); // unknown title: A–Z ties
    expect(D.orderStatsForTitle([{ label: 'Bookworm', count: 1 }, { label: 'Sunrise Hiker', count: 3 }], 'The Well-Read Sunrise Hiker').map(s => s.count)).toEqual([3, 1]); // count still wins
    expect(stats.map(s => s.label)).toEqual(['Sunrise Hiker', 'Bookworm', 'Coffee Snob']); // input untouched
  });
});
