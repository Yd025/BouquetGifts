// Fetches the curated real-product catalog from each store's public Shopify product JSON and caches photos locally.
// Run: node scripts/build-catalog.mjs              (writes catalog/catalog.json + catalog/images/*)
//      node scripts/build-catalog.mjs --add          (fetches only lists not yet in catalog.json, keeps the rest as they are)
//      node scripts/build-catalog.mjs --only=traits (refreshes only the per-trait lists, keeps recipe prices as they are)
// Every store must report USD in its public /meta.json, and every URL is the canonical https://<store>/products/<handle>.
import fs from 'node:fs/promises';
const STORES = { 'gsioutdoors.com': 'GSI Outdoors', 'timemore.com': 'TIMEMORE', 'fellowproducts.com': 'Fellow', 'retrospekt.com': 'Retrospekt', 'turntablelab.com': 'Turntable Lab',
  'parachutehome.com': 'Parachute', 'thesill.com': 'The Sill', 'soltech.com': 'Soltech', 'eastfork.com': 'East Fork', 'ugmonk.com': 'Ugmonk',
  'topodesigns.com': 'Topo Designs', 'outofprintclothing.com': 'Out of Print', 'craighill.co': 'Craighill', 'leatherman.com': 'Leatherman', 'orbitkey.com': 'Orbitkey', 'brooklinen.com': 'Brooklinen',
  'artoftea.com': 'Art of Tea', 'rishi-tea.com': 'Rishi Tea', 'greatjonesgoods.com': 'Great Jones', 'fromourplace.com': 'Our Place', 'brightland.co': 'Brightland',
  'milkbarstore.com': 'Milk Bar', 'dandelionchocolate.com': 'Dandelion Chocolate', 'flybyjing.com': 'Fly By Jing', 'heatonist.com': 'Heatonist', 'baronfig.com': 'Baron Fig',
  'eeboo.com': 'eeBoo', 'pieceworkpuzzles.com': 'Piecework', 'litographs.com': 'Litographs', 'explodingkittens.com': 'Exploding Kittens', 'otherland.com': 'Otherland',
  'homesick.com': 'Homesick', 'brooklyncandlestudio.com': 'Brooklyn Candle Studio', 'oseamalibu.com': 'OSEA', 'bathingculture.com': 'Bathing Culture', 'manduka.com': 'Manduka',
  'snowpeak.com': 'Snow Peak', 'barebonesliving.com': 'Barebones', 'calpaktravel.com': 'CALPAK', 'cotopaxi.com': 'Cotopaxi', 'wildone.com': 'Wild One', 'fablepets.com': 'Fable',
  'modernsprout.com': 'Modern Sprout', 'bloomist.com': 'Bloomist', 'cocktailkingdom.com': 'Cocktail Kingdom', 'ohuhu.com': 'Ohuhu', 'nativeunion.com': 'Native Union',
  'filmphotographystore.com': 'Film Photography Project' };
export const PLAN = {
  'Summit Pour-Over Kit': [['gsioutdoors.com', 'gourmet-pour-over-java-set', 'GSI Gourmet Pour Over Java Set'], ['timemore.com', 'timemore-chestnut-c3-jet-black', '+ TIMEMORE Chestnut C3 hand grinder'], ['fellowproducts.com', 'ethiopia-agaro', '+ Fellow single-origin beans (Ethiopia Agaro)']],
  'Trail Film Camera Set': [['retrospekt.com', 'peanuts-beagle-scouts-fc-11-35mm-film-camera', '35mm point-and-shoot film camera'], ['retrospekt.com', 'kodak-gold-200-color-35mm-film-36-exposures-3-pack', '+ Kodak Gold 200 film (3 rolls)'], ['retrospekt.com', 'refurbished-polaroid-600-camera-silver-lms', '+ refurbished Polaroid 600 instant camera']],
  'Vinyl Night In': [['turntablelab.com', 'fleetwood-mac-rumors-colored-vinyl-vinyl-lp', 'Fleetwood Mac: Rumours on colored vinyl'], ['parachutehome.com', 'organic-rib-knit-throw-tobacco', '+ Parachute organic rib knit throw'], ['turntablelab.com', 'audio-technica-at-lp60x-bk-automatic-turntable-black', '+ Audio-Technica AT-LP60X turntable']],
  'Self-Watering Plant Wall': [['thesill.com', 'self-watering-plant-globes', 'Self-watering plant globes'], ['thesill.com', 'senecio-rowleyanus-string-of-pearls', '+ String of Pearls plant'], ['soltech.com', 'vita-grow-light', '+ Soltech Vita grow light']],
  'Reading Nook Ritual': [['fellowproducts.com', 'cherry-pick-fellow-drop-12oz-whole-bean', 'Fellow Drops whole-bean coffee'], ['eastfork.com', 'east-fork-mug', '+ East Fork handmade mug'], ['parachutehome.com', 'organic-rib-knit-throw-garnet', '+ Parachute reading throw']],
  'Pocket Maker Kit': [['ugmonk.com', 'analog-starter-kit-black', 'Ugmonk Analog starter kit'], ['ugmonk.com', 'hmm-pen-black', '+ HMM ballpoint pen'], ['ugmonk.com', 'analog-daily-focus-kit-black-aluminum', '+ Analog Daily Focus kit']],
  'Brunch & Beats Day': [['eastfork.com', 'sunday-morning-mug', 'East Fork Sunday Morning Mug'], ['turntablelab.com', 'fleetwood-mac-greatest-hits-vinyl-lp', '+ Fleetwood Mac: Greatest Hits vinyl'], ['turntablelab.com', 'audio-technica-at-lp60x-gm-automatic-turntable-gunmetal-black', '+ Audio-Technica AT-LP60X turntable']],
  'Matcha Morning Set': [['artoftea.com', 'art-of-tea-ceremonial-matcha-40g-tin', 'Art of Tea ceremonial matcha'], ['artoftea.com', 'colored-glass-tea-cup', '+ colored glass tea cup'], ['dandelionchocolate.com', 'japanese-tea-bonbon-collection', '+ Dandelion Japanese tea bonbons']],
  'Pizza & Games Night': [['brightland.co', 'the-pizza-night-set', 'Brightland Pizza Night olive oil set'], ['explodingkittens.com', 'sell-me-a-sasquatch', '+ Sell Me A Sasquatch party game'], ['explodingkittens.com', 'dead-therapist', '+ Dead Therapist party game']],
  'Campfire Cocoa Night': [['dandelionchocolate.com', 'peppermint-hot-chocolate-mix-large', 'Dandelion peppermint hot chocolate'], ['snowpeak.com', 'mini-backpackers-cup-in-blue', '+ Snow Peak backpacker cup'], ['barebonesliving.com', 'box-candle-lantern-bundle', '+ Barebones candle lantern set']],
  'Candlelit Bath Ritual': [['brooklyncandlestudio.com', 'japanese-satsuma-classic-2-wick-candle', 'Japanese Satsuma 2-wick candle'], ['bathingculture.com', 'bathhouse-check-organic-towel', '+ Bathing Culture organic bath towel'], ['oseamalibu.com', 'sea-glow-body-routine', '+ OSEA Sea Glow body routine']],
  'Sketchbook Getaway': [['ohuhu.com', 'ohuhu-hilo-series-direct-ink-acrylic-paint-markers', 'Ohuhu acrylic paint markers'], ['calpaktravel.com', 'luka-1-quart-zip-pouch', '+ CALPAK Luka zip pouch'], ['cotopaxi.com', 'todo-1l-shoulder-bag-copy', '+ Cotopaxi Todo shoulder bag']],
  'Everyday Carry Upgrade': [['baronfig.com', 'draft-writing-journal', 'Baron Fig Draft writing journal'], ['nativeunion.com', 'pop-cable-xl', '+ Native Union braided charging cable'], ['nativeunion.com', 'slide-card-wallet', '+ Native Union magnetic card wallet']],
  'Backyard Bird Garden': [['modernsprout.com', 'cardinal-finch-feast-wild-bird-seed-blend', 'Cardinal & Finch wild bird seed'], ['bloomist.com', 'terra-cotta-planter-garden-sage', '+ Bloomist terracotta planter'], ['bloomist.com', 'terracotta-bird-house-garden-sage', '+ Bloomist terracotta birdhouse']],
  'Hot Pot Party': [['flybyjing.com', 'hot-pot-base', 'Fly By Jing hot pot base'], ['flybyjing.com', 'classic-soy-noodles', '+ Fly By Jing soy noodles'], ['fromourplace.com', 'rice-bowl-set', '+ Our Place rice bowl set']],
  'Studio Calm Kit': [['manduka.com', 'equilibria-pilates-slipper-socks', 'Manduka grip socks'], ['rishi-tea.com', 'organic-ritual-green-teabag-sachets-50-count', '+ Rishi Ritual Green tea sachets'], ['manduka.com', 'cloud-pilates-mat-12mm', '+ Manduka CLOUD Pilates mat']],
  'Half-Frame Travel Kit': [['filmphotographystore.com', '35mm-film-camera-lomo-simple-half-frame-color-with-film', 'Half-frame 35mm camera (with film)'], ['filmphotographystore.com', '35mm-color-lomography-classiccolor-200', '+ Lomography ClassicColor 200 film'], ['calpaktravel.com', 'clear-quart-zip-pouch', '+ CALPAK clear travel pouch']],
  'Literary Puzzle Night': [['litographs.com', 'maltese-puzzle', 'Litographs Maltese Falcon text puzzle'], ['litographs.com', 'maltese-tote', '+ Litographs book tote'], ['homesick.com', 'sense-and-sensibility-elinors-sense-candle', '+ Sense and Sensibility candle']],
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
  'Tea Lover': [['rishi-tea.com', 'wuyi-oolong-da-hong-pao', 'Rishi Da Hong Pao oolong'], ['artoftea.com', 'art-of-tea-cup-and-saucer', 'Art of Tea cup and saucer'], ['rishi-tea.com', 'red-shudei-mogake-tokoname-teapot', 'Tokoname clay teapot']],
  'Home Chef': [['brightland.co', 'the-classic-oil-vinegar-duo', 'Brightland olive oil & vinegar duo'], ['fromourplace.com', 'beechwood-serving-spoons', 'Our Place beechwood serving spoons'], ['fromourplace.com', 'carbon-steel-wok', 'Our Place carbon steel wok']],
  Baker: [['milkbarstore.com', 'drew-barrymore-buttercream-baking-mix', 'Milk Bar shortbread baking mix'], ['greatjonesgoods.com', 'great-whisk', 'Great Jones whisk'], ['greatjonesgoods.com', 'sweet-treat-gift-set', 'Great Jones bakeware set']],
  'Sweet Tooth': [['dandelionchocolate.com', 'the-originals-collection', 'Dandelion single-origin chocolate bars'], ['milkbarstore.com', 'salted-butterscotch-pudding-cookie-tin', 'Milk Bar cookie tin'], ['dandelionchocolate.com', 'single-origin-caramel', 'Dandelion single-origin caramels']],
  'Spice Chaser': [['flybyjing.com', 'sichuan-chili-crisp', 'Fly By Jing Sichuan chili crisp'], ['heatonist.com', 'hot-ones-hot-sauce-trio-pack-season-31', 'Hot Ones hot sauce trio'], ['flybyjing.com', 'the-hot-pot-starter-set', 'Fly By Jing mini hot pot set']],
  'Stationery Nerd': [['baronfig.com', 'legend-notebook', 'Baron Fig hardcover notebook'], ['baronfig.com', 'squire-hex-pen', 'Baron Fig Squire pen'], ['baronfig.com', 'universal-squire-pen-stand', 'Baron Fig pen stand']],
  'Puzzle Solver': [['eeboo.com', 'mushroom-rainbow-1000pc-square-puzzle', 'eeBoo 1000-piece mushroom puzzle'], ['pieceworkpuzzles.com', 'tinseltown', 'Piecework 1000-piece puzzle'], ['litographs.com', 'oz2-puzzle', 'Wizard of Oz text puzzle']],
  'Game Night Host': [['explodingkittens.com', 'i-suck-at-drawing', 'I Suck At Drawing party game'], ['explodingkittens.com', 'poetry-for-neanderthals-uncensored', 'Poetry for Neanderthals game'], ['explodingkittens.com', 'fast-friends', 'Fast Friends card game']],
  'Candle Collector': [['otherland.com', 'cardamom-milk', 'Otherland Cardamom Milk candle'], ['homesick.com', 'roasted-chestnuts-candle', 'Homesick Roasted Chestnuts candle'], ['brooklyncandlestudio.com', 'cardamom-classic-2-wick-candle', 'Brooklyn Candle Studio 2-wick candle']],
  'Spa Devotee': [['oseamalibu.com', 'undaria-algae-body-butter-bergamot-vanilla-bean', 'OSEA body butter'], ['bathingculture.com', 'jumbo-mineral-sea-sponge', 'Bathing Culture sea sponge'], ['bathingculture.com', 'bathhouse-check-organic-robe', 'Bathing Culture organic robe']],
  Yogi: [['manduka.com', 'lean-recycled-foam-yoga-block', 'Manduka recycled foam yoga block'], ['manduka.com', 'go-play-5-0-mat-carrier', 'Manduka mat carrier'], ['manduka.com', 'grp-adapt-lite-2-1-yoga-mat-4mm', 'Manduka GRP yoga mat']],
  'Happy Camper': [['snowpeak.com', 'titaniumbackpackers-cup-blue', 'Snow Peak titanium cup'], ['barebonesliving.com', 'enamel-2-tone-kettle-indigo-blue', 'Barebones enamel camp kettle'], ['snowpeak.com', 'home-camp-burner-set', 'Snow Peak Home & Camp burner']],
  Globetrotter: [['calpaktravel.com', 'luka-2-quart-zip-pouch', 'CALPAK travel pouch'], ['calpaktravel.com', 'luka-belt-bag-in-vegan-leather', 'CALPAK belt bag'], ['cotopaxi.com', 'viaje-45l-travel-duffel-copy', 'Cotopaxi Viaje 45L travel duffel']],
  'Dog Person': [['wildone.com', 'playful-plush-dog-toy', 'Wild One plush dog toy'], ['fablepets.com', 'the-towel-microfiber-dog-cat-drying-towel-hand-pockets-odor-resistant-7-water-absorbent', 'Pet drying towel'], ['wildone.com', 'waterproof-collar-lightweight-leash-dog-walk-kit', 'Wild One collar & leash walk kit']],
  'Cat Person': [['wildone.com', 'cat-wild-wand', 'Wild One cat wand toy'], ['wildone.com', 'cat-tunnel', 'Wild One cat tunnel'], ['wildone.com', 'cat-bolster-bed', 'Wild One cat bed']],
  Gardener: [['modernsprout.com', 'winter-bulb-kits', 'Modern Sprout indoor bulb kit'], ['barebonesliving.com', 'herb-harvest-strip-tool', 'Barebones herb harvest tool'], ['barebonesliving.com', 'hori-hori-ultimate-ii', 'Barebones hori hori garden knife']],
  'Bird Watcher': [['modernsprout.com', 'songbird-symphony-wild-bird-seed-blend', 'Songbird wild bird seed'], ['modernsprout.com', 'birds-on-the-block-window-birdfeeder', 'Window bird feeder'], ['bloomist.com', 'terracotta-bird-bath-garden-sage', 'Bloomist terracotta bird bath']],
  Mixologist: [['cocktailkingdom.com', 'seamless-paddle-mixing-glass-550ml-19oz', 'Cocktail Kingdom mixing glass'], ['cocktailkingdom.com', 'lucky-cat-barspoon-stainless-steel-29-5cm', 'Lucky Cat bar spoon'], ['cocktailkingdom.com', 'mustipher-zombie-glass-16oz-450ml-2-pack', 'Tiki zombie glasses (2)']],
  Artist: [['ohuhu.com', 'ohuhu-honolulu-s-24-colors-dual-soft-tips-alcohol-art-markers-brush-soft-chisel', 'Ohuhu 24 dual-tip art markers'], ['ohuhu.com', 'ohuhu-heavyweight-bleedproof-double-sided-marker-pad-with-pu-cover', 'Ohuhu bleedproof marker sketchbook'], ['ohuhu.com', 'ohuhu-honolulu-2s-104-basic-colors-dual-tips-alcohol-art-markers-brush-soft-chisel', 'Ohuhu 104-color marker set']],
  'Tech Lover': [['nativeunion.com', 'find-it-card-duo', 'Native Union Find It tracker cards'], ['nativeunion.com', 'belt-cable-xl-set', 'Native Union cable set'], ['nativeunion.com', 'pop-phone-bubble-gum-limited-edition', 'Native Union POP retro handset']],
};
const UA = { 'user-agent': 'Mozilla/5.0 (BouquetCatalog; DubHacks 2026)' };
const ADD = process.argv.includes('--add');
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
  for (const [key, tiers] of Object.entries(plan)) {
    if (ADD && prev?.[section]?.[key]?.length) { out[section][key] = prev[section][key]; continue; } // --add keeps existing lists (and their prices) untouched
    out[section][key] = []; for (const t of tiers) out[section][key].push(await fetchProduct(...t)); }
}
if (ONLY && prev?.fetchedAt) out.fetchedAt = prev.fetchedAt, out.traitsFetchedAt = new Date().toISOString();
if (ADD && prev?.fetchedAt) out.fetchedAt = prev.fetchedAt, out.traitsFetchedAt = prev.traitsFetchedAt, out.addedAt = new Date().toISOString();
await fs.writeFile('catalog/catalog.json', JSON.stringify(out, null, 2));
