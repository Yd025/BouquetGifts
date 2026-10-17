import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Storage } from './storage.js';
/** Curated catalog of real products (fetched by scripts/build-catalog.mjs from each store's public product JSON). */
export type Product = { tierTitle: string; name: string; store: string; url: string; priceCents: number; image: string; imageSource: string };
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../catalog');
let data: { fetchedAt: string; currency?: string; recipes: Record<string, Product[]>; traits?: Record<string, Product[]> } = { fetchedAt: '', recipes: {} };
try { data = JSON.parse(fs.readFileSync(path.join(DIR, 'catalog.json'), 'utf8')); } catch { /* catalog optional */ }
export const CATALOG = data;
export const traitProducts = (trait: string): Product[] => data.traits?.[trait] ?? [];
const asTier = (p: Product, level: number): Product => { const label = p.tierTitle.replace(/^\+\s*/, ''); return { ...p, tierTitle: level === 1 ? label : `+ ${label}` }; };
/** Real products behind a gift. A named recipe uses its own curated list. Any other gift (Treasure Box, Duo Box) is built from its
 *  traits' real product lists: one trait = that trait's three products; two traits = hero of each, then the first trait's add-on.
 *  Returns [] only when no trait has catalog coverage (the UI then shows the trait-flower art tile, never an invented product). */
export function productsFor(title: string, traits: string[] = []): Product[] {
  const recipe = data.recipes[title]; if (recipe?.length) return recipe;
  const lists = traits.map(traitProducts).filter(l => l.length);
  if (!lists.length) return [];
  const picks = lists.length === 1 ? lists[0].slice(0, 3) : [lists[0][0], lists[1][0], lists[0][1] ?? lists[1][1]];
  const seen = new Set<string>(); const uniq = picks.filter(p => p && !seen.has(p.url) && seen.add(p.url));
  return uniq.map((p, i) => asTier(p, i + 1));
}
/** Which of a gift's own products is its cover photo on the gift table: the first one whose photo isn't already another gift's cover.
 *  null = the default (tier 1). Only ever picks a product that is really in the box, so nothing is invented. */
export function coverLevel(title: string, traits: string[], taken: Set<string>): number | null {
  const i = productsFor(title, traits).findIndex(p => !taken.has(p.url)); return i > 0 ? i + 1 : null;
}
export const productAt = (title: string, level: number, traits: string[] = []): Product | null => productsFor(title, traits)[level - 1] ?? null;
export const imageKey = (p: Product) => `catalog/${p.image}`;
/** `label` is our plain-English line for the item ("Fellow Drops whole-bean coffee"); `name` is the store's own title ("Cherry Pick"). */
export const publicProduct = (p: Product | null) => p && ({ name: p.name, label: p.tierTitle.replace(/^\+\s*/, ''), store: p.store, url: p.url, priceCents: p.priceCents, photoUrl: `/api/media/${imageKey(p)}` });
/** Cumulative tier thresholds = what the products actually cost, rounded up to the dollar. */
export function catalogTiers(title: string, traits: string[] = []) {
  const ps = productsFor(title, traits); if (!ps.length) return null; let sum = 0;
  return ps.map(p => { sum += p.priceCents; return { title: p.tierTitle, threshold_cents: Math.ceil(sum / 100) * 100 }; });
}
/** Copy cached product photos into storage (R2 or local) once, so they are served from /api/media/catalog/... */
export async function syncCatalog(storage: Storage) {
  let n = 0;
  for (const ps of [...Object.values(data.recipes), ...Object.values(data.traits ?? {})]) for (const p of ps) {
    const key = imageKey(p); if (await storage.get(key)) continue;
    const file = path.join(DIR, 'images', p.image); if (!fs.existsSync(file)) continue;
    await storage.put(key, fs.readFileSync(file), p.image.endsWith('.png') ? 'image/png' : p.image.endsWith('.webp') ? 'image/webp' : 'image/jpeg'); n++;
  }
  return n;
}
