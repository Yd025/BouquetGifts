# ✿ Bouquet — gifts grown by everyone who loves them

DubHacks ’26 · **Visa: Reimagine Shopping** · side tracks: T-Mobile, Cloudflare, SpaceXAI/xAI

## The problem
Group gifts break at every step. One person **guesses** the gift alone, **fronts** the money, and **chases** Venmo for weeks.
Group-gift sites only collect money, and video-montage apps only collect messages. Nobody helps the group *decide*, and the person who organized it ends up paying for whatever is short.

## The solution
Bouquet turns group gifting into a card game:
1. **Plant.** The organizer creates a bouquet with a *needs-to-arrive-by* date and a shipping buffer. Bouquet computes the **buy-by deadline**.
2. **Invite.** Only the organizer sees the invite link, which uses `PUBLIC_ORIGIN`. Friends tap a face-down card and join as **guests** with just a name and phone number. The phone is verified by the carrier (T-Mobile CAMARA Number Verify). The account is completed lazily, at the hold step.
3. **Card.** One question per screen ("Card 2/7"): 4 shared questions plus 2 random ones visibly **drawn from the deck**, then a first-person memory. The art grows as you answer. Minting tears open a pack. The card title is built from the friend's own top traits, and stat chips show how many answers back each trait. No two cards in a bouquet share a title: if a friend's first title is taken, Bouquet tries other pairings of that friend's own traits (`uniqueCardTitle`). Cards grow to fit their chips and memory, so nothing is clipped. The art is Grok Imagine when `XAI_API_KEY` is set, otherwise a generated SVG, and is stored in R2 or on local disk. The "which gift would annoy them" answer **filters** gift candidates. While cards come in, the right column shows a face-down "No cards yet" slot and "Still writing: Priya, Sam".
4. **Fuse (deck game).** Cards flip together, then everyone draws trait cards from a deck, keeps or discards them (swipe, buttons or arrow keys, with Undo), and fuses two hand cards into a gift. Duplicate traits level up ("Sunrise ×3 · Lv3"). There are always 3 or more candidates (rare fusion, safe pick, wildcard), each citing the cards behind it, with a live vote tally. Generic gifts are named like gifts (*Bookshelf & Trailhead Duo Box*) and are built from **real products for their traits**, so every card on the gift table has a real product photo, and no photo appears twice on one table. That holds after a hand fusion too: if both traits' hero photos are already covers on the table, the new gift's cover is another product from its own box (`coverLevel`, stored as `candidates.cover_level`). A wildcard never duplicates a named recipe for the same two traits. Only if a trait had no catalog coverage would a gift fall back to its traits' flowers (labelled "no catalog product yet"), never a made-up photo. **Original fusion rule:** Traits fuse into gift candidates. **Rare fusions only unlock when 2+ friends independently name the same traits**, and every candidate cites whose cards produced it. The group votes.
5. **Bloom.** Every friend sets their **own budget** and places a card **hold** (not a charge). The gift grows in **tiers** of **real products** (GSI pour-over set $59.95 → + TIMEMORE C3 grinder → + Fellow beans), each with its real photo, store link and listed price, and the bouquet visibly blooms as money comes in. The top of the funding view shows the whole gift as a strip of its products: funded tiers are lit, the rest are dimmed with "$30 more".
   - Once you hold, the button reads **"Add $20 more with Visa"** (holds add up; they never replace each other).
   - The **Chip in** column also shows **Who's in** (each member is "✓ holding" or "no hold yet"; amounts and budgets stay private), the buy-by countdown, and **your own share**: "If the group checks out now, you pay $22 of your $45 hold and $23 goes back to your card."
6. **Checkout.** Holds are captured pro-rata at the **highest fully funded tier**, and any remainder is released. Before checkout, the funding view says exactly what will happen, using the same tier pick and the same pro-rata split as checkout itself (`totals.checkout` in the API). Over the goal it reads "$135 held · $96 goal reached" and "Checkout charges exactly $96, split pro-rata across 3 friends' holds. The extra $39 is released back to their cards, never charged." If the group misses the buy-by deadline, **every hold is released** automatically. After checkout the room header swaps the countdown for **"✓ Purchased in time"** ("Checked out ahead of the Oct 28 buy-by date"), and for "✓ Opened by Maya" once revealed.
7. **Reveal.** Tear open the pack, then flip or swipe through the cards. Trait names become compliments ("You chase every sunrise"), and each memory is read aloud. The finale is a holo legendary gift card with a garland and confetti.
   **Original:** The recipient opens a pack card by card, and each card reads the friend's memory aloud. The last, legendary card is the gift, framed in a **garland**.

## Architecture
```
web/  Next.js 14 (App Router, React 18). Proxies /api/* to the API.
api/  Express + TypeScript (tsx). Postgres (docker) or embedded PGlite (tests/dev).
      src/domain.ts    pure logic: question draw, traits, fusion + consensus, tiers, capture allocation, flower backs
      src/app.ts       routes, auth (bcrypt + JWT httpOnly cookie), state machine, SSE, deadline sweep, demo clock
      src/adapters.ts  Payments (MockVisaPayments), Network (MockNetwork | NacNetwork CAMARA), AI (MockAi | GrokAi)
      src/db.ts        schema + pg/PGlite driver
      src/catalog.ts   real-product catalog → tier titles/thresholds, photos, store links
      catalog/         catalog.json + cached product photos (built by scripts/build-catalog.mjs)
realtime/  Cloudflare Worker + Durable Object live room (wrangler dev / workerd locally)
e2e/  Playwright full-flow test + screenshots
```
- Bouquet states: `collecting → fusing → funding → purchased → revealed` (or `expired`).
- Money is stored in integer cents. The funded total is always `SUM(ledger_events)` (hold − release); there is no stored counter. Ledger events are append-only.
- Holds are idempotent (`idempotency_key` is unique). Checkout runs in a transaction with `SELECT … FOR UPDATE` and is idempotent, and it is tested against concurrent double-clicks and a race with the deadline sweep.
- SIM Swap is checked before any hold ≥ $50 and before capture. Phone numbers ending in `9999` simulate a recent swap, and numbers ending in `0000` fail verification.
- Mock Visa: any Luhn-valid card works (`4242 4242 4242 4242`), and `4000 0000 0000 0002` is declined.
- Modals (pack opening, fusion reveal, Visa pay sheet) are portalled to `<body>` (`components/Overlay.tsx`). Panels use `backdrop-filter`, which would otherwise trap a `position:fixed` overlay inside the panel.
- The backdrop fades in by animating its colour, never `opacity`, because children inherit opacity. The Visa sheet slides in using transform only, so it is fully opaque from the first frame.
- While a modal is open the page behind it is scroll-locked (`body { overflow: hidden }`, padded by the scrollbar width so nothing shifts) and restored on close.
- Turnstile runs in `interaction-only` mode, so the widget appears only if Cloudflare actually needs a click. Until it passes, the Hold button reads "Verifying with Cloudflare…". After it passes, the sheet shows "✓ Verified human by Cloudflare Turnstile".
- E2E waits for every modal's finite animations to finish before taking a screenshot. It then asserts that the modal is opaque all the way up its ancestor chain and is the topmost element at its centre (and at the Hold button), so nothing is stacked over it.
- Grok: if `XAI_API_KEY` is set, Grok writes the card titles and gift blurbs. The fusion and consensus rules stay deterministic.

### API (all under `/api`)
`POST auth/signup|login|logout`, `GET auth/me`, `POST bouquets`, `GET bouquets`, `GET bouquets/:id`, `GET invite/:token`, `POST join/:token`,
`PATCH bouquets/:id/budget`, `GET bouquets/:id/questions`, `POST bouquets/:id/cards`, `POST bouquets/:id/fuse`, `POST bouquets/:id/picks {traitId, keep}`, `DELETE bouquets/:id/picks/:traitId` (undo), `POST bouquets/:id/fuse-hand {traitIds:[a,b]}`, `POST bouquets/:id/vote`, `POST bouquets/:id/choose`,
`POST bouquets/:id/contributions`, `POST bouquets/:id/lock`, `GET reveal/:token`, `POST reveal/:token/flip`, `GET bouquets/:id/stream` (SSE fallback), `GET bouquets/:id/realtime` (signed WebSocket ticket for the Durable Object room), `GET media/catalog/:file` (product photos),
`POST dev/clock {offsetMs}` (DEMO_MODE only: fast-forwards the clock and runs the deadline sweep).

## Run
```bash
docker compose up --build        # web http://localhost:3000 · api :4000 · live room :8787 · postgres
```
Without Docker:
```bash
cd api && npm i && DATABASE_URL=memory DEMO_MODE=1 npm start      # embedded Postgres
cd web && npm i && npm run build && npm start
```

## Cloudflare
- **Turnstile** guards join, holds and opening the reveal pack. docker-compose ships with Cloudflare's official always-pass test keys, and with no keys set the check is skipped.
- **R2** stores card art (`src/storage.ts`, S3-compatible). Without `R2_*`, art is written to the `media` volume. Either way it is served at `/api/media/...`.
- **Worker + Durable Object live room** (`realtime/`). Each bouquet maps to one `BouquetRoom` Durable Object, using the WebSocket Hibernation API.
  - The API publishes every room event (join, card, vote, pick, fuse, contribution, purchase, reveal flip) to `POST /room/:id/publish`, guarded by the shared `REALTIME_SECRET`.
  - Browsers ask the API for a 2-minute HMAC-signed member ticket, then connect to `ws://…/room/:id/ws?ticket=…`. The DO fans each event out to every socket in that room and broadcasts presence ("Live room · 4 here now").
  - Locally, the `realtime` compose service runs it with `wrangler dev --local` (workerd/miniflare).
  - **Fallback chain:** WebSocket, then SSE (`/stream`, if the worker is unreachable or the socket closes), then polling every 15 s. The room header shows which mode is active.
  - Deploy with `cd realtime && npx wrangler deploy && npx wrangler secret put REALTIME_SECRET`, then set `REALTIME_URL` and `PUBLIC_REALTIME_URL` to the workers.dev URL.

## Real product catalog
- Every recipe gift has **3 real products**, one per tier. Each was pulled from the store's own public Shopify product JSON (`https://<store>/products/<handle>.json`) by `api/scripts/build-catalog.mjs`.
- Every one of the 10 traits also has **3 real products** (`traits` in `catalog.json`), so non-recipe gifts are real too:
  - A **Treasure Box** (one trait) is that trait's three products. For example, Bookworm is an Out of Print Library Card tote ($22), then an East Fork mug, then Craighill False Books.
  - A **Duo Box** (two traits) is each trait's hero product plus one add-on. It leads with whichever hero isn't already on the gift table.
  - Tiers and thresholds come from those products' real prices, exactly as for recipes. Each trait's hero is a different product from every recipe's hero.
- 37 products from 16 US stores: GSI Outdoors, TIMEMORE, Fellow, Retrospekt, Turntable Lab, Parachute, The Sill, Soltech, East Fork, Ugmonk, Topo Designs, Out of Print, Craighill, Leatherman, Orbitkey and Brooklinen.
  - The script refuses any store whose public `/meta.json` doesn't report USD.
  - `--only=traits` refreshes the trait lists without touching recipe prices.
  - For each product the script records the store page URL, the price shown (first variant, USD) and the product photo. Photos are downloaded and cached in `api/catalog/images/`.
- On boot the API copies the photos into storage (R2 or the media volume) and serves them at `/api/media/catalog/…`, so the demo never hotlinks a store.
- Tier thresholds are the **cumulative real prices**, rounded up to the dollar. For example, Reading Nook is $22 → $66 → $165. "Tier 2 funded" therefore means those two products are actually paid for.
- Photos appear on the landing page (a sample bouquet from `GET /api/catalog/featured`, a real recipe's real products and tier prices), the gift table cards, the fusion overlay, the tier list, the funding gift strip, the dashboard, and the legendary reveal card (with an "includes" list).
- Gift cards show our plain-English label for each item, such as "Fellow Drops whole-bean coffee", rather than the store's own title ("Cherry Pick"). The link goes to the real store page.
- Prices are a snapshot from Oct 17, 2026. Rerun `node api/scripts/build-catalog.mjs` to refresh them.
- Bouquets fused before this change keep their old placeholder tier titles. New bouquets get product tiers.

## Keys (drop-in)
Copy `.env.example` to `.env`, fill in the keys, then run `docker compose up -d --build api && docker compose exec api npm run check:keys`. The check runs read-only probes and never prints secrets.

Wiring the keys in (about 2 minutes):
1. `cp .env.example .env` (skip if `.env` exists; never commit it), then paste `XAI_API_KEY`, the `VISA_*` values and the `NAC_*` values.
2. Copy the Visa PEM files into `./secrets/` and point `VISA_CERT_PATH`, `VISA_KEY_PATH` and `VISA_CA_PATH` at them.
3. `docker compose up -d --build api && docker compose exec api npm run check:keys`. No line should still say `not set`; any failing probe is printed without the secret. Without keys it prints `Grok (xAI) not set → mock`, `Visa sandbox not set → MockVisaPayments`, `Nokia Network-as-Code not set → mock`.
4. `docker compose up -d --build` to restart the rest. If Grok writes a card title that names no trait, the chips keep the plain count, then A–Z order.
| key | what it turns on | without it |
|---|---|---|
| `XAI_API_KEY` (+ `XAI_MODEL`, `XAI_IMAGE_MODEL`) | Grok card titles, memory polish, gift blurbs, Grok Imagine card art | deterministic mock + SVG art |
| `VISA_USER_ID`, `VISA_PASSWORD`, `VISA_CERT_PATH`, `VISA_KEY_PATH`, `VISA_CA_PATH`, `VISA_BASE_URL` | `check:keys` verifies two-way TLS against Visa's sandbox `/vdp/helloworld`. Put the PEM files in `./secrets/`. | `MockVisaPayments` |
| `NAC_API_KEY`, `NAC_BASE_URL`, `NAC_TEST_PHONE` | Nokia Network-as-Code CAMARA Number Verify and SIM Swap | `MockNetwork` |

**Honest status:** holds and captures still run through `MockVisaPayments` even when the Visa credentials are set. Wiring a real sandbox authorization, capture and reversal API is the next step after the keys are verified.

## Demo mode
`DEMO_MODE=1` seeds a ready **"Maya" bouquet** owned by demo@bouquet.gift, with cards from Jon, Priya and Sam that have distinct first-person memories. It also shows the **🎬 Judge demo** drawer, which can try a declined card, simulate a SIM-swapped friend (the hold is blocked, with the reason), and fast-forward past the deadline (all holds released).

## Demo credentials
| email | password |
|---|---|
| demo@bouquet.gift (Adelin) | bouquet123 |
| maya@ / jon@ / priya@ / sam@bouquet.gift | bouquet123 |

## Tests
```bash
cd api && npm test                         # unit + API integration (vitest, embedded Postgres)
cd realtime && npm i && npm run dev & npm test   # Durable Object fan-out + ticket checks (needs Node 22)
cd e2e && npm i && npx playwright install chromium && npx playwright test   # needs the app on :3000
E2E_REALTIME=1 npx playwright test   # also asserts WebSocket mode + live push without reload
E2E_FALLBACK=1 npx playwright test   # with the worker stopped: asserts the SSE fallback
```
The Playwright test plays an organizer, 3 friends, and the recipient through the whole flow and saves screenshots to `screenshots/`. Full-page product shots hide the fixed 🎬 Judge demo button (a full-page capture would paint it mid-page); `10d-demo-simswap.png` shows it on purpose. Below 1440px the button collapses to a 44px 🎬 circle, and E2E asserts it sits right of every panel at 1280px. E2E also checks the phone layout at 390px (no sideways scroll on the landing page or room, nav under 90px tall, friend cards in one swipeable row; `01b-landing-mobile.png`, `10e-mobile-room.png`) and that each card's chips follow its title (equal counts: the trait the title names comes first).
