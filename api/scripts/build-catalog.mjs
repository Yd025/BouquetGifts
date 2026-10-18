// Fetches the curated real-product catalog from each store's public Shopify product JSON and caches photos locally.
// Run: node scripts/build-catalog.mjs              (writes catalog/catalog.json + catalog/images/*)
//      node scripts/build-catalog.mjs --only=traits (refreshes only the per-trait lists, keeps recipe prices as they are)
// Every store must report USD in its public /meta.json, and every URL is the canonical https://<store>/products/<handle>.
import fs from 'node:fs/promises';
const STORES = { 'gsioutdoors.com': 'GSI Outdoors', 'timemore.com': 'TIMEMORE', 'fellowproducts.com': 'Fellow', 'retrospekt.com': 'Retrospekt', 'turntablelab.com': 'Turntable Lab',
  'parachutehome.com': 'Parachute', 'thesill.com': 'The Sill', 'soltech.com': 'Soltech', 'eastfork.com': 'East Fork', 'ugmonk.com': 'Ugmonk',
  'topodesigns.com': 'Topo Designs', 'outofprintclothing.com': 'Out of Print', 'craighill.co': 'Craighill', 'leatherman.com': 'Leatherman', 'orbitkey.com': 'Orbitkey', 'brooklinen.com': 'Brooklinen' };
export const PLAN = {
  'Summit Pour-Over Kit': [['gsioutdoors.com', 'gourmet-pour-over-java-set', 'GSI Gourmet Pour Over Java Set'], ['timemore.com', 'timemore-chestnut-c3-jet-black', '+ TIMEMORE Chestnut C3 hand grinder'], ['fellowproducts.com', 'ethiopia-agaro', '+ Fellow single-origin beans (Ethiopia Agaro)']],
  'Trail Film Camera Set': [['retrospekt.com', 'peanuts-beagle-scouts-fc-11-35mm-film-camera', '35mm point-and-shoot film camera'], ['retrospekt.com', 'kodak-gold-200-color-35mm-film-36-exposures-3-pack', '+ Kodak Gold 200 film (3 rolls)'], ['retrospekt.com', 'refurbished-polaroid-600-camera-silver-lms', '+ refurbished Polaroid 600 instant camera']],
  'Vinyl Night In': [['turntablelab.com', 'fleetwood-mac-rumors-colored-vinyl-vinyl-lp', 'Fleetwood Mac: Rumours on colored vinyl'], ['parachutehome.com', 'organic-rib-knit-throw-tobacco', '+ Parachute organic rib knit throw'], ['turntablelab.com', 'audio-technica-at-lp60x-bk-automatic-turntable-black', '+ Audio-Technica AT-LP60X turntable']],
  'Self-Watering Plant Wall': [['thesill.com', 'self-watering-plant-globes', 'Self-watering plant globes'], ['thesill.com', 'senecio-rowleyanus-string-of-pearls', '+ String of Pearls plant'], ['soltech.com', 'vita-grow-light', '+ Soltech Vita grow light']],
  'Reading Nook Ritual': [['fellowproducts.com', 'cherry-pick-fellow-drop-12oz-whole-bean', 'Fellow Drops whole-bean coffee'], ['eastfork.com', 'east-fork-mug', '+ East Fork handmade mug'], ['parachutehome.com', 'organic-rib-knit-throw-garnet', '+ Parachute reading throw']],
  'Pocket Maker Kit': [['ugmonk.com', 'analog-starter-kit-black', 'Ugmonk Analog starter kit'], ['ugmonk.com', 'hmm-pen-black', '+ HMM ballpoint pen'], ['ugmonk.com', 'analog-daily-focus-kit-black-aluminum', '+ Analog Daily Focus kit']],
  'Brunch & Beats Day': [['eastfork.com', 'sunday-morning-mug', 'East Fork Sunday Morning Mug'], ['turntablelab.com', 'fleetwood-mac-greatest-hits-vinyl-lp', '+ Fleetwood Mac: Greatest Hits vinyl'], ['turntablelab.com', 'audio-technica-at-lp60x-gm-automatic-turntable-gunmetal-black', '+ Audio-Technica AT-LP60X turntable']],
};
/** Per-trait product lists for gifts that are not a named recipe (Treasure Box = one trait, Duo Box = two traits mixed).
 *  The first product is the hero photo (kept different from every recipe's hero, so the gift table never repeats a photo);
 *  level 2 and 3 are add-ons. Labels get a "+ " prefix at runtime for levels 2+. */
export const TRAITS = {
  'Sunrise Hiker': [['topodesigns.com', 'wool-knit-beanie-garnet', 'Topo Designs wool knit beanie'], ['gsioutdoors.com', 'glacier-stainless-14-fl-oz-cup', 'GSI Glacier stainless camp cup'], ['topodesigns.com', 'daypack-classic-navy', 'Topo Designs Daypack Classic']],
  'Coffee Snob': [['fellowproducts.com', 'ethiopia-agaro', 'Fellow single-origin beans (Ethiopia Agaro)'], ['fellowproducts.com', 'carter-slide-mug', 'Fellow Carter Slide travel mug'], ['timemore.com', 'timemore-chestnut-c3-jet-black', 'TIMEMORE Chestnut C3 hand grinder']],
  'Brunch Royalty': [['eastfork.com', 'breakfast-bowl-tulip-crown', 'East Fork hand-painted breakfast bowl'], ['eastfork.com', 'sunday-morning-mug', 'East Fork Sunday Morning Mug'], ['eastfork.com', 'cook-in-a-book-pancakes', 'Cook in a Book: Pancakes!']],
  Maker: [['craighill.co', 'spectra-scissors', 'Craighill Spectra scissors'], ['ugmonk.com', 'hmm-pen-black', 'HMM ballpoint pen'], ['leatherman.com', 'wave', 'Leatherman Wave+ multi-tool']],
  'Film Shooter': [['retrospekt.com', 'kodak-gold-200-color-35mm-film-36-exposures-3-pack', 'Kodak Gold 200 film (3 rolls)'], ['retrospekt.com', 'peanuts-beagle-scouts-fc-11-35mm-film-camera', '35mm point-and-shoot film camera'], ['retrospekt.com', 'refurbished-polaroid-600-camera-silver-lms', 'Refurbished Polaroid 600 instant camera']],
  'Music Head': [['turntablelab.com', 'fleetwood-mac-greatest-hits-vinyl-lp', 'Fleetwood Mac: Greatest Hits vinyl'], ['turntablelab.com', 'turntable-lab-record-care-bundle-2-brush-fluid-inner-sleeves', 'Record care kit (brush, fluid, sleeves)'], ['turntablelab.com', 'audio-technica-at-lp60x-bk-automatic-turntable-black', 'Audio-Technica AT-LP60X turntable']],
  'Plant Parent': [['thesill.com', 'senecio-rowleyanus-string-of-pearls', 'String of Pearls plant'], ['thesill.com', 'self-watering-plant-globes', 'Self-watering plant globes'], ['soltech.com', 'vita-grow-light', 'Soltech Vita grow light']],
  Bookworm: [['outofprintclothing.com', 'library-card-tote-bag-cloud-blue', 'Out of Print Library Card tote'], ['eastfork.com', 'east-fork-mug', 'East Fork handmade mug'], ['craighill.co', 'false-books', 'Craighill False Books (hidden storage)']],
  'Hates Clutter': [['orbitkey.com', 'key-organiser-matte-leather', 'Orbitkey leather key organizer'], ['orbitkey.com', 'tech-organiser-mini', 'Orbitkey Tech Organizer Mini'], ['orbitkey.com', 'deskmat', 'Orbitkey Desk Mat']],
  'Cozy Nester': [['brooklinen.com', 'super-plush-slippers', 'Brooklinen Super-Plush slippers'], ['parachutehome.com', 'organic-rib-knit-throw-tobacco', 'Parachute organic rib knit throw'], ['parachutehome.com', 'cozy-knit-robe-garnet', 'Parachute Cozy Knit Robe']],
};
const UA = { 'user-agent': 'Mozilla/5.0 (BouquetCatalog; DubHacks 2026)' };
const ONLY = process.argv.find(a => a.startsWith('--only='))?.split('=')[1];
const prev = await fs.readFile('catalog/catalog.json', 'utf8').then(JSON.parse).catch(() => null);
const out = { fetchedAt: new Date().toISOString(), currency: 'USD', note: 'Prices as shown on each store page at fetch time.', recipes: {}, traits: {} };
const currencyOk = new Map();
async function fetchProduct(store, handle, tierTitle) {
  if (!currencyOk.has(store)) { const m = await (await fetch(`https://${store}/meta.json`, { headers: UA })).json(); currencyOk.set(store, m.currency); }
  if (currencyOk.get(store) !== 'USD') throw new Error(`${store} prices are in ${currencyOk.get(store)}, not USD`);
  const url = `https://${store}/products/${handle}`;
  const r = await fetch(url + '.json', { headers: UA }); if (!r.ok) throw new Error(`${url}.json -> ${r.status}`);
  const p = (await r.json()).product; const v = p.variants[0]; const src = p.image?.src ?? p.images[0].src;
  const img = await fetch(src + (src.includes('?') ? '&' : '?') + 'width=600', { headers: UA }); if (!img.ok) throw new Error('image ' + img.status);
  const type = img.headers.get('content-type') ?? 'image/jpeg'; const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const file = `${store.split('.')[0]}-${handle}`.slice(0, 80) + '.' + ext;
  await fs.writeFile(`catalog/images/${file}`, Buffer.from(await img.arrayBuffer()));
  console.log(tierTitle, '|', p.title, '|', v.price, '|', file);
  return { tierTitle, name: p.title, store: STORES[store], url, priceCents: Math.round(Number(v.price) * 100), image: file, imageSource: src };
}
for (const [section, plan] of [['recipes', PLAN], ['traits', TRAITS]]) {
  if (ONLY && ONLY !== section && prev?.[section]) { out[section] = prev[section]; continue; }
  for (const [key, tiers] of Object.entries(plan)) { out[section][key] = []; for (const t of tiers) out[section][key].push(await fetchProduct(...t)); }
}
if (ONLY && prev?.fetchedAt) out.fetchedAt = prev.fetchedAt, out.traitsFetchedAt = new Date().toISOString();
await fs.writeFile('catalog/catalog.json', JSON.stringify(out, null, 2));
