'use client';
import { useEffect, useState } from 'react';
import { api, $ } from '../lib/api';
import GiftStrip from './GiftStrip';
// Landing hero: a real recipe's real catalog products (from /api/catalog/featured), shown the way a bouquet grows: first tiers lit, last one still locked.
export default function HeroGift() {
  const [g, setG] = useState<any>(null);
  useEffect(() => { api('/catalog/featured').then(r => setG(r.gift)).catch(() => {}); }, []);
  if (!g?.products?.length) return null;
  const lit = Math.max(1, g.products.length - 1);
  return <div data-testid="hero-gift"><h4>Sample bouquet: {g.title}</h4>
    <GiftStrip layout="col" testId="hero-strip" items={g.products.map((p: any, i: number) => ({ photoUrl: p.photoUrl, label: p.label, href: p.url, title: `${p.name} · ${p.store}`, unlocked: i < lit,
      note: `Tier ${i + 1} · ${$(g.tiers[i])}` }))} />
    <p className="muted">Real products, real prices. Each friend who chips in unlocks the next one.</p></div>;
}
