# Bouquet team log

Decisions made by the agent team (architect, payments, realtime, frontend, QA, docs), newest first. Times are PT.

## Sat Oct 17, 2026 · ~2 PM cycle: phones work, the Judge button stops covering panels, chips follow the card title, no orphan gift

Build state before: API 43/43, realtime 2/2, Playwright 3/3 in WebSocket mode (`E2E_REALTIME=1`). The first baseline E2E run had 1 failure (`demo account login works`: the login input wasn't editable within 15s) because I ran it alongside the API and realtime suites. The API suite also timed out in its hooks under that load. Both passed when re-run one at a time (API 43/43, E2E 3/3). So it's a load flake, not a regression, and from then on suites ran one after another. Critique is from the 1 PM screenshots (backed up to `/tmp/bq-shots-2pm` before the baseline run overwrote them), plus a 390px phone probe of the landing page and room, since there was no phone screenshot.

### Critiques
- **DH Judge.**
  - **On a phone the landing pitch is cut off.** At 390px the page is 415px wide, so the headline reads "everyone who love…" and every line of the pitch loses its last word. The room is 414px wide (the nav overflows), and the logo wraps onto two lines. Judges often open the Devpost link on a phone, so this is the first thing they see.
  - On the phone the room's "Cards so far" turns into a stack of full-screen face-down cards, about three screens of scrolling with nothing to read.
  - `09e-gift-table`: 4 gifts in a 3-column grid leave the *Bookworm Treasure Box* alone on a second row with two-thirds of the row empty. The "pick a gift" moment looks unfinished.
  - `10d-demo-simswap` confirms the known issue: in a real 1280px viewport the 🎬 Judge demo pill (x≈1100–1262) covers the Chip in panel's right edge (≈1172), over the Who's in "holding" badges.
- **DH Skeptic.**
  - "Sam's card says *The Caffeinated Sunrise Hiker*, but the chips say Sunrise Hiker ×2, **Bookworm** ×1, Coffee Snob ×1. Why is the caffeinated thing last?" Same with Priya: *The Minimalist Sunrise Hiker* lists Hates Clutter after Bookworm. The title and chips look like they come from different people.
  - `09a`: the drawn card says "0 kept" twice (in the corner and as a pill). Minor.
  - `11-purchased`: the unfunded tier-3 row looks the same as the bought rows in the price list, although the strip above says "Not funded". Minor.
- **DH Architect.**
  - Root cause of the phone clipping: below 800px `.hero` is `grid-template-columns: 1fr`, which is `minmax(auto, 1fr)`. The track grows to its widest child's min-content (the sample-gift panel's 175px + products grid), so the whole hero column became 415px. Fix: `minmax(0, 1fr)` and `min-width: 0` on its children. Nothing else on the page needed to change.
  - Root cause of the chip/title mismatch: chips are sorted count-desc then A–Z (`traitsFromAnswers`), but `uniqueCardTitle` deliberately picks a *different* adjective when the first title is already taken. On a tie the chip order is arbitrary, so fix it at display time, with ties broken by "the title names this trait". Counts are never changed, and the stored `stats` are untouched (no migration). A Grok-written title (keys at 3 PM) that names no trait falls back to A–Z.
  - The Judge button is a labelled pill. A 44px circle at `right:18px` sits in the page margin from about 1164px wide (main is 1080px + 20px padding). That's a CSS-only change, and it's the same button and test id, so the judge flow is unchanged.
  - Gift grid: `auto-fill, minmax(260px)` gives 3 tracks in a ~990px panel. `auto-fit, minmax(220px)` fits 4 in a row, and 3 gifts still stretch across the full row. 5 gifts would still leave one alone on a row (deferred).

### Agreed and shipped (all three personas agreed on each)
1. **Phone layout** (`globals.css`, `@media (max-width:560px)` only, so desktop is unchanged).
   - Landing: hero track `minmax(0,1fr)`, h1 36px, sample-gift panel in one column. Nothing is clipped.
   - Nav: one line, logo doesn't wrap, "New bouquet" hidden (the dashboard has its own button).
   - Room: friend cards become a swipeable row (scroll-snap, 72% wide so the next card peeks in) instead of full-screen stacked cards.
   - *Why:* a judge opening the link on a phone used to see a broken pitch.
   - *Tests:* E2E at 390×844: landing `scrollWidth ≤ 390` (`01b-landing-mobile.png`); the room has no sideways scroll, the nav is under 90px tall, and every friend card shares one row (`10e-mobile-room.png`). The viewport is restored to 1280 afterwards.
2. **The Judge demo button no longer covers panels** (`b/[id]/page.tsx`, `globals.css`).
   - Below 1440px it's a 44px white 🎬 circle (with `aria-label`/`title` "Judge demo" and `aria-expanded`). At ≥1440px it keeps the full label. The drawer contents are unchanged.
   - *Why:* closes the deferred overlap in a real 1280px viewport (verified in `10d`: the circle sits in the margin right of the Chip in panel).
   - *Tests:* E2E at 1280px: the toggle is ≤48px wide and its left edge is right of every `main .panel` (excluding the drawer's own panel).
3. **Chips follow the card title** (`domain.ts` `orderStatsForTitle`, applied in `app.ts` room state and reveal).
   - Sort by count desc, then traits the title names (by trait name or its adjective), then A–Z. Final run: *The Caffeinated Sunrise Hiker* shows Coffee Snob ×1 before Bookworm ×1, and *The Minimalist Sunrise Hiker* shows Hates Clutter ×1 before Bookworm ×1.
   - *Why:* closes the long-deferred "trait tie-break order" in the place where it was visible, without touching the domain's trait selection.
   - *Tests:* unit (tie → named trait first; unknown/Grok title → A–Z; count still wins; input not mutated). E2E checks every card on the room: counts never increase down the list, and no un-named chip precedes a named chip with the same count.
4. **No orphan gift** (`.cands` → `repeat(auto-fit, minmax(220px,1fr))`). 4 gifts sit in one row at 1280px (`09e-gift-table.png`). On a phone the 220px minimum forces one column (by arithmetic, not screenshotted).
   - *Tests:* covered by the existing gift-table assertions plus the screenshot check (no new assertion: the layout depends on how many gifts the seeded answers produce).
5. **Docs for 3 PM keys** (README): a 4-step "wiring the keys in" list (`.env` from `.env.example`, PEMs in `./secrets/`, `docker compose … npm run check:keys` with the exact no-key output, then restart). Verified `npm run check:keys` runs on the box and prints `not set → mock` for all three without printing anything secret. DEVPOST gains "Works on a phone" and the chip rule. VIDEO_SCRIPT says where the 🎬 button is and to record at ≥1280px.

### Deferred
- 5+ gifts on the table would still leave one alone on a row at 1280px (4 fit).
- Between about 1080px and 1164px viewport width the 🎬 circle can still touch a panel edge (CSS arithmetic, not measured). 1280px and up is clear, as asserted.
- The Visa pay sheet and deck/drag interactions at 390px weren't checked this cycle (only the landing page and the room during funding were).
- `09a`: "0 kept" appears twice on a freshly drawn card. `11`: the unfunded tier row in the price list isn't marked "not funded" (the strip above it is). The dashboard is a large blank panel for a brand-new user.
- Carried over: live price refresh, real Visa sandbox holds (keys at 3 PM; holds still use `MockVisaPayments`). The fusion de-dupe is proven deterministically only by the unit test.

Build state after:
- API **44/44** (+1 unit: chip order follows title), realtime **2/2**, `tsc --noEmit` clean.
- Playwright **3/3** in WebSocket mode (`E2E_REALTIME=1`, three passing runs after the changes: the first before the final phone-CSS tweak, the last on the final code, and that last run produced the screenshots) and **3/3** in SSE fallback (`E2E_FALLBACK=1`, :8797 worker stopped, then restarted and realtime re-tested: 2/2 and E2E 3/3). The room page changed, so the fallback was re-run.
- Separate stack on :3100/:4100/:8797. The web app was built in the scratch copy `/tmp/bqw` (synced with `cp`, because `rsync` isn't on the box; `diff -rq` against `web/` is clean). The :4100 API and :8797 worker were restarted on the new code with their original env (the worker needs Node 22: `/workspace/.node22/bin`). The processes on :3000/:4000/:8787 and the `.next` of :3000 were never touched. Source backups: `/tmp/bq-src-backup-2pm`.
- Screenshots were regenerated from the final WebSocket run (group picked *Reading Nook Ritual*). New: `01b-landing-mobile.png`, `10e-mobile-room.png`. `09e-gift-table.png` shows 4 gifts in one row with 4 distinct photos. `10d-demo-simswap.png` shows the 🎬 circle clear of the Chip in panel. `10a`/`10-funding-bloom` show title-ordered chips.
- No new dependencies. Dockerfiles and compose are unchanged, and there's no DB migration this cycle.
- Mac deploy: not done. Adelin's Mac (`Yidans-MacBook-Pro-5.local`) showed as connected at about 2:11 PM. The first command got "temporarily unreachable", a retry got "not connected", It then showed offline at every check from 2:13 PM through the last one at 2:18 PM. Nothing was copied to `/Users/mayidan/Downloads/Dubhacks 2026/bouquet`. A packed update is ready on the box at `/workspace/bouquet-update-2pm.tgz` (excludes `node_modules`, `.next`, `.env*` except `.env.example`, `secrets/`, and the runtime media in `api/data`). To deploy: unpack it over the folder, which leaves her `.env` and `secrets/` alone, then `docker compose up --build -d`.

## Sat Oct 17, 2026 · ~1 PM cycle: the room says where you are (done, empty, adding), and no repeated photo after a fusion

Build state before: API 41/41, realtime 2/2, Playwright 3/3 in WebSocket mode (`E2E_REALTIME=1`), all green. Critique is from the 12 PM screenshots (backed up to `/tmp/bq-shots-12pm` before the baseline run overwrote them).

### Critiques
- **DH Judge.**
  - In `09e-gift-table`, after Jon fused *Bookworm + Sunrise Hiker* from his hand, the new *Bookshelf & Trailhead Duo Box* showed **the same tote photo** as the *Bookworm Treasure Box* next to it (and in the `09d` fusion reveal). The "magic" fusion looks like a copy of an existing card.
  - `11-purchased` still reads "10d 23h left · Buy by 10/28" in the header after checkout. The deadline story (VISA journey: deadline → checkout → done) never visibly closes.
  - The 🎬 Judge demo button sits on top of the Who's in badges in every full-page shot (`10-funding-bloom`, `10a`, `11`), so the Devpost images look unpolished.
- **DH Skeptic.**
  - "I already have $45 on hold. If I press *Chip in $20 with Visa*, does it replace my $45 or add to it?"
  - `07-questionnaire-a` caught the question card mid-animation (faded, tilted), and the right column says "Cards so far (0)" over a big empty panel. Nothing tells me what will show up there or who we're waiting on.
  - `10a-guest-claim` caught "The cards" mid flip-in (one squashed, faded card).
  - Scrolling with the Visa sheet open scrolls the room behind it (carried over: no body scroll lock).
- **DH Architect.**
  - Root cause of the repeated photo: `preferFreshHero` only knows the two trait heroes. When **both** heroes are already covers (both Treasure Boxes on the table), it gives up and returns the duplicate. Covers were also always tier 1, computed statelessly, so there was no way to say "this gift leads with its 3rd product". Fix: store a per-candidate `cover_level` at insert time (first product of the gift's own box whose photo isn't already a cover), so the older cards never change photo and the new one gets a fresh one. Nothing invented: the cover is always one of that gift's real products.
  - Header bug: the countdown ignores `status` except `expired`.
  - `07`/`10a` are the same capture-timing class as earlier cycles; reuse `settle()`.
  - The Judge button is `position:fixed`; a full-page capture paints it at viewport-bottom, i.e. mid-page. It's a judge-only tool, so product shots should hide it (Playwright's `style` option) while `10d` keeps showing it.
  - Deferred empty space above the small bloom: the Bloom SVG viewBox starts at y=0, but even fully grown flowers never reach above y≈35, so the top 30 units are always blank.
  - 10:10 AM carry-over (faded Visa pay sheet): **verified resolved**. `10b-pay-sheet` is crisp and `expectCrisp` still passes.

### Agreed and shipped (all three personas agreed on each)
1. **No repeated photo after a hand fusion** (`catalog.ts` `coverLevel`, `db.ts` migration `candidates.cover_level`, `app.ts` `/fuse-hand` and `/fuse`, state uses `cover_level ?? 1`).
   - A new gift whose hero photo is already on the table leads with the next product from its own box (e.g. the East Fork mug in *Bookshelf & Trailhead*), and the "+ 2 more" label follows. `/fuse` applies the same rule as a backstop. Tiers, prices and the funding strip are unchanged.
   - *Why:* the fusion is the deck game's payoff; a duplicate photo makes it look fake.
   - *Tests:* unit (both heroes taken → cover is tier 3, not on the table; nothing taken → default). API (fuse-hand a pair whose heroes are already covers when one exists: every table photo distinct, cover is one of the gift's own products). E2E asserts all `cand-photo` srcs on `09e` are distinct after Jon's fusion.
2. **The room header says it's done** (`b/[id]/page.tsx`). After checkout the countdown becomes a green "✓ Purchased in time" with "Checked out ahead of the Oct 28 buy-by date (3 shipping days built in)", and "✓ Opened by Maya" once revealed. Expired is unchanged.
   - *Why:* closes the deadline → checkout → done loop on screen.
   - *Tests:* E2E: header reads exactly "✓ Purchased in time" and no longer contains "left".
3. **"Add $20 more with Visa"** once you already hold, and the field label becomes "Add to your hold ($)".
   - *Why:* answers the Skeptic's add-or-replace question (holds are separate rows and add up).
   - *Tests:* E2E checks each friend's button reads "Add $N more with Visa" right after their hold.
4. **Body scroll lock behind modals** (`Overlay.tsx`): `body { overflow:hidden }` while the pack, fusion or Visa sheet is open, padded by the scrollbar width so nothing shifts, restored on close.
   - *Tests:* E2E asserts body overflow is `hidden` while the Visa sheet is open, and the lock is gone after it closes.
5. **Empty states and screenshot polish.**
   - "Cards so far (0)" now shows a dashed face-down "No cards yet" slot ("Yours could be the first. Each card lands here face-down." / "Waiting for friends…"), plus "Still writing: Priya, Sam" while friends are missing cards (only names, organizer excluded).
   - Bloom viewBox trimmed from `0 0 240 220` to `0 30 240 190` (the always-blank top band), which closes the deferred "empty space above the small bloom".
   - E2E: `settle()` before `07-questionnaire-a` and before `10a` (and asserts 3 cards in it). Full-page product shots hide the fixed Judge demo button; `10d-demo-simswap` still shows it open.
   - *Tests:* E2E asserts the "No cards yet" slot for Jon, and that the organizer sees neither the slot nor "Still writing" once all 3 cards are in (WebSocket and SSE branches).

### Deferred
- Trait tie-break order (domain change; not worth the risk today).
- The fusion de-dupe is proven deterministically by the unit test. The API and E2E runs exercise it only when the seeded questions happen to put both heroes on the table, because questions are seeded per member.
- In a real viewport the fixed Judge demo button can still cover the right edge of a panel by about 40px at 1280px wide. It clears content only from about 1440px, going by the CSS (1080px `main`, a ~160px button 18px from the edge), not by a measurement. Only screenshots hide it. Moving it would change the judge flow.
- Carried over: live price refresh, real Visa sandbox holds (keys at 3 PM; holds still use `MockVisaPayments`).

Build state after:
- API **43/43** (+2: unit cover pick, API fuse-hand distinct photos), realtime **2/2**.
- Playwright **3/3** in WebSocket mode (`E2E_REALTIME=1`, run three times this cycle) and **3/3** in SSE fallback (`E2E_FALLBACK=1`, :8797 worker stopped, then restarted and realtime re-tested). The room page changed, so the fallback was re-run.
- Separate stack on :3100/:4100/:8797. The web app was built in the scratch copy `/tmp/bqw` (in sync with `web/`). The test API on :4100 and the worker on :8797 were restarted on the new code. The `.next` of the process on :3000 and the processes on :3000/:4000/:8787 were never touched.
- Screenshots were regenerated from the final WebSocket run. In that run the group picked *Reading Nook Ritual* and held $135 against tier 2 ($66) of 3 ($165). `11-purchased.png` shows "✓ Purchased in time" and "$66 charged · tier 2 of 3". `10-funding-bloom.png` shows "Add to your hold" and "Add $20 more with Visa" with no Judge button over Who's in. `07-questionnaire-a.png` shows a crisp question card and the "No cards yet" slot. `09e-gift-table.png` shows 4 distinct product photos.
- No new dependencies. Dockerfiles and compose are unchanged (one additive `ALTER TABLE … ADD COLUMN IF NOT EXISTS`).
- Adelin's Mac was offline this cycle, so there was no deploy or copy to `/Users/mayidan/Downloads/Dubhacks 2026`.

## Sat Oct 17, 2026 · ~12 PM cycle: the gift visibly grows, and the money is explained

Build state before: API 39/39, realtime 2/2, Playwright 3/3 in WebSocket mode and in SSE fallback, all green. Critique is from the 11 AM screenshots.

### Critiques
- **DH Judge.**
  - The VISA-track screen (`10-funding-bloom`) reads "$135 held of $96". It looks like a bug, and the judge can't tell who pays what.
  - The core pitch is "the gift grows with every friend", but the gift header shows one small photo (the latest unlocked item). The gift never visibly grows.
  - The landing hero is a bloom and a text card in a big white panel. There is no product on the first screen of a shopping-track project.
- **DH Skeptic.**
  - "I put $45 on hold. Will I be charged $45? What happens to the extra $39?" Nothing on screen answered that before checkout.
  - "Who else is in? Is the deadline real?" The right "Chip in" column was half empty during funding.
  - Before checkout, "$X more unlocks + Parachute reading throw" kept the stray "+ ".
  - After checkout, "$66 captured of $165" sounds like the gift failed.
- **DH Architect.**
  - Checked the capture logic in `lock()`. It is correct: it takes the highest fully funded tier and splits that tier's threshold across the live holds with `allocateCapture` (largest remainder, never more than a hold). Everything else is released. The bug was only that the UI never said so.
  - Root cause of the confusion: the UI had no access to the allocation, so it couldn't make an honest promise. Fix it on the server, using the same code as checkout, rather than doing the maths again in React.
  - `10-funding-bloom` caught the third friend card mid flip-in (`rotateY(90deg)`), so only 2 of 3 cards showed. Same capture-timing class as last cycle.
  - The 🎬 Judge demo button is `position:fixed; bottom:18px`. In full-page screenshots it lands mid-page over the Chip in column, but in a real viewport it sits bottom-right. Left as is.

### Agreed and shipped (all three personas agreed on each)
1. **Honest checkout preview** (`app.ts` state, `b/[id]/page.tsx`).
   - The API now returns `totals.checkout` = `{ tierLevel, chargeCents, releaseCents, holders, myHeldCents, myChargeCents }`. It is computed with the same `highestFundedTier` and `allocateCapture` calls (same hold order) as `lock()`, so the preview is what checkout will actually do. Each member gets only their own share. Nobody else's amount or budget is exposed.
   - Over the goal: "$135 held · $96 goal reached ✿" and "Fully funded: every tier is unlocked. Checkout charges exactly $96, split pro-rata across 3 friends' holds. The extra $39 is released back to their cards, never charged."
   - Between tiers: "Tier 2 is fully funded. Checking out now charges exactly $66 …".
   - Your share: "If the group checks out now, you pay $22 of your $45 hold and $23 goes back to your card."
   - The organizer's checkout text names the tier and the amount. After purchase the bar reads "$66 charged · tier 2 of 3". Expired reads "every hold was released, no one was charged".
   - *Why:* money clarity is the VISA-track story, and the over-goal state looked broken.
   - *Tests:* new API test funds over the top tier with 3 friends. It checks charge = top threshold, release = held − top, 3 holders, and that the shares add up exactly to the charge, each ≤ its hold. It then checks that after the real `lock()` each friend's captured amount equals their preview. E2E checks the preview text (and the "released … never charged" line when over the goal), "you pay $X of your $45 hold", and that Sam's final "You were charged" equals the previewed share.
2. **The gift as a whole** (`components/GiftStrip.tsx`).
   - The single hero photo is replaced by one tile per tier product. Unlocked tiles are lit ("✿ Tier 2 unlocked"). Locked tiles are dimmed and greyscale with a dashed border ("🔒 $30 more"). After purchase they read "in the box" or "Not funded".
   - *Why:* it makes "the gift grows with every friend" visible.
   - *Tests:* E2E asserts one tile per tier, every photo decoded, all tiles locked before any hold, lit tiles = unlocked tiers after the holds, and the strip on the purchased view.
3. **Chip in column filled with useful things.**
   - **Who's in:** every member with their flower, "✓ holding" or "no hold yet", and "3 of 4 holding · everyone's amount and budget stay private".
   - **Buy-by box:** "⏳ 10d 23h left to check out (buy by Oct 28, leaving 3 days to ship). If nobody checks out in time, every hold is released and no one is charged." This matches the deadline sweep.
   - *Why:* it closes the deferred empty column with information the Skeptic asked for, and it shows only hold status, which the petals already revealed.
   - *Tests:* E2E checks "0 of 4 holding" for the organizer before holds, 4 rows and "3 of 4 holding" after, that no "$" appears in the list, and the deadline text.
4. **Real products on the landing page** (`GET /api/catalog/featured`, `components/HeroGift.tsx`).
   - The hero panel now shows a "Sample bouquet: Summit Pour-Over Kit" with its 3 real catalog products (GSI pour-over set, TIMEMORE C3 grinder, Fellow beans). Each has its photo, store link and real cumulative tier price ($60 / $169 / $189). The first two are lit and the last is locked, next to Jon's card.
   - The endpoint picks the first recipe that has 3 catalog products. Nothing is invented.
   - *Tests:* API (≥3 products, canonical `/products/` URLs, photos served as images, one tier price per product). E2E (3 tiles, every photo decoded, store links, 2 lit and 1 locked).
5. **Small fixes.** The stray "+ " is gone from "$X more unlocks …". E2E settles the friend-card flip-in before `10-funding-bloom` and asserts all 3 cards are in it, and it waits for the unlock toast to clear so the toast doesn't cover the room title.

### Deferred
- The Judge demo button overlaps content in full-page screenshots only (fixed position). Moving it changes the judge flow; not worth it today.
- On the purchased view there is empty space above a small bloom (the SVG viewBox at low progress). Cosmetic.
- Carried over: body scroll lock behind modals, trait tie-break order, live price refresh, real Visa sandbox holds (keys at 3 PM; holds still use `MockVisaPayments`).

Build state after:
- API **41/41** (+2: checkout preview, landing sample gift), realtime **2/2**.
- Playwright **3/3** in WebSocket mode (`E2E_REALTIME=1`) and **3/3** in SSE fallback (`E2E_FALLBACK=1`, worker stopped).
- Separate stack on :3100/:4100/:8797. The web app was built in a scratch copy (`/tmp/bqw`), so the `.next` used by the process on :3000 was never touched, and :3000/:4000/:8787 were left alone.
- Screenshots were regenerated from the final WebSocket run. In that run the group picked *Bookshelf & Trailhead Duo Box* and held $135 against a $108 top tier. `10-funding-bloom.png` shows all 3 tiles lit, "$135 held · $108 goal reached ✿", "Checkout charges exactly $108 … the extra $27 is released back to their cards, never charged", Sam's "you pay $36 of your $45 hold and $9 goes back to your card", and Who's in. `11-purchased.png` reads "$108 charged · tier 3 of 3". The partly-funded state (2 lit tiles, 1 locked "$30 more") was checked visually in an earlier run of this cycle. (Each run's gift varies because questions are seeded per member.) `01-landing.png` shows the real-product sample bouquet.
- No new dependencies. Dockerfiles and compose are unchanged.

## Sat Oct 17, 2026 · ~11 AM cycle: crisp Visa sheet + real photos on every gift

Build state before: API 35/35, realtime 2/2, Playwright 3/3 in WebSocket mode and in SSE fallback (`E2E_FALLBACK=1`), all green. Critique is from the 10 AM screenshots.

### Critiques
- **DH Judge.**
  - The VISA-track moment still looks unfinished. In `10b-pay-sheet` the sheet and its "Hold $50 with Visa" button are washed out, the page shows through the card, and there is a blank gap above the button.
  - On the gift table (`09e`), 3 of 4 gifts are flower tiles reading "no catalog product yet". That is the opposite of "reimagine shopping": the judge sees a shop with no products.
- **DH Skeptic.**
  - "Is the Hold button disabled? Is this broken?"
  - "Bookworm + Coffee Snob" appears twice on the table: as *Reading Nook Ritual* and as *Bookshelf & Café Duo Box*.
  - Gift links show cryptic store titles ("Cherry Pick · Fellow"). Nobody knows that's coffee.
  - After products were added to the generic gifts, a first pass showed the **same tote photo on 3 of 4 cards**. We caught this before shipping (see item 2).
- **DH Architect.**
  - Root cause of the faded sheet (two causes stacked):
    - **Capture timing:** the sheet used `.pop`, an opacity 0→1 animation over 0.7s, and E2E took the screenshot as soon as the sheet was in the viewport, mid-fade.
    - **A genuinely disabled button:** `opacity:.5` stayed on while the Turnstile test widget loaded. The blank gap was that widget's iframe.
  - The stacking itself was fine: one portal, `z-index:50`, and no opacity on the overlay.
  - Same timing risk in `08b` (minted card) and `09d` (fusion), which used fixed 500–600 ms waits against a 700 ms animation.
  - Product lookup was keyed only by recipe title, so a non-recipe gift could never get a product.

### Agreed and shipped (high impact, low risk)
1. **Crisp Visa sheet** (`Overlay.tsx`, `PaySheet.tsx`, `globals.css`).
   - The backdrop fades by animating `background-color` (never `opacity`, which children inherit), and the sheet slides in with transform only, so it is opaque from frame one.
   - The disabled Hold button inside the sheet no longer fades. While Turnstile runs it reads "Verifying with Cloudflare…".
   - Turnstile is `interaction-only`, and "✓ Verified human by Cloudflare Turnstile" appears once it passes. That is clearer and still shows the Cloudflare side track.
   - *Why:* the VISA moment is the money shot.
   - *Tests:* E2E `settle()` waits for every finite animation on the modal, its subtree and its ancestors. `expectCrisp()` asserts that the product of opacities up the ancestor chain is 1 and that `elementFromPoint` at the centre of the sheet and of the Hold button lands inside them. It also asserts that the button is enabled and the Turnstile ✓ is visible. `08b` and `09d` use the same helpers instead of fixed waits.
2. **Real product photos on every gift** (`catalog.ts`, `domain.ts`, `app.ts`, `scripts/build-catalog.mjs`).
   - Each of the 10 traits now has 3 real products. Products were fetched with the existing pipeline from each store's public Shopify JSON, and photos are cached locally.
   - That added 16 new products from 6 new US stores: Topo Designs, Out of Print, Craighill, Leatherman, Orbitkey and Brooklinen. The catalog now has 37 products from 16 stores.
   - The script checks each store's `/meta.json` currency is USD, and `--only=traits` refreshes trait lists without touching recipe prices.
   - A Treasure Box is its trait's 3 products. A Duo Box is each trait's hero plus an add-on. Tiers and thresholds are the real cumulative prices, as for recipes, and blurbs list what's actually in the box.
   - **No repeated photos:** each trait's hero differs from every recipe's hero (Brunch leads with a breakfast bowl, Film with Kodak Gold, Music with a Mitski LP). A Duo Box whose hero is already on the table leads with its other trait instead (`preferFreshHero`, applied in `fuse` and in `/fuse-hand`). The extra fallback gifts are now Treasure Boxes for the next traits. The photo book and "favourite things" day remain only as a true last resort (art tile).
   - Nothing is invented: every URL, price and photo was fetched by the script.
   - *Tests:*
     - Unit: wildcard dedupe, duo hero flip, blurbs and tier titles from real products.
     - API: every trait has 3 USD products with canonical `/products/<handle>` URLs and cached photos over 5 KB, and no trait hero is a recipe hero. Tiers equal cumulative prices for every fused gift. Over HTTP, every candidate has a served photo, all photos on a table are distinct, and choosing a generic gift gives 3 product tiers.
     - E2E: every candidate has a decoded product photo and a store `/products/` link, with zero art tiles, both before and after Jon's fused duo.
3. **No look-alike gifts.** The wildcard Duo Box skips trait pairs that a named recipe already covers. *Why:* Skeptic saw "Bookworm + Coffee Snob" twice. *Test:* unit.
4. **Plain-English product labels.** Gift cards and the reveal's "includes" list show our label ("Fellow Drops whole-bean coffee + 2 more") instead of the store title ("Cherry Pick"). The store title is in the link tooltip, and the API adds `label` to products. *Why:* clarity for first-time users.
5. **Test robustness.**
   - Friends' questions are seeded per member, so a named recipe isn't always on the table. E2E now votes for the named recipe when there is one and otherwise for the top gift. The SSE run surfaced this.
   - An API test that assumed a $40 placeholder tier now funds whatever tier 1 really costs.

### Deferred
- The empty lower half of the "Chip in" column during funding (layout change, medium risk).
- Body scroll lock behind modals.
- Trait tie-break order.
- Live price refresh.
- Real Visa sandbox holds. Keys arrive at 3 PM; holds still use `MockVisaPayments`.
- Bouquets fused before this change keep their old placeholder tier titles (demo data only).

Build state after:
- API **39/39**, realtime **2/2**.
- Playwright **3/3** in WebSocket mode (`E2E_REALTIME=1`) and **3/3** in SSE fallback (`E2E_FALLBACK=1`, worker stopped).
- Runs used a separate stack on :3100/:4100/:8797 so the other process on :3000/:4000/:8787 was untouched.
- Screenshots were regenerated from the final WebSocket run. `10b-pay-sheet.png` is crisp, and `09e-gift-table.png` shows 4 distinct real product photos.
- No new dependencies. Dockerfiles and compose are unchanged.

## Sat Oct 17, 2026 · ~10 AM cycle: polish and UX gaps

Build state before: API 33/33, realtime 2/2, Playwright 3/3 (WebSocket mode), all green. Critique is from the screenshots that run produced.

### Critiques
- **DH Judge.** The two wow moments are broken on screen. The fusion reveal and the **Visa pay sheet** render inside their panels, not over the page: in `10b-pay-sheet` the sheet is off-screen, so the VISA-track moment is invisible. On the reveal, each friend's memory and compliments are clipped off the card, which is the emotional payoff.
- **DH Skeptic.** All three cards under "The cards" read "The Well-Read Sunrise Hiker", so they look like duplicates (confirmed: same traits give the same title). The gift table mixes photo cards with bare text cards (Treasure Box, duo box), so it reads unfinished. "Bookworm × Sunrise Hiker Box" under a "Bookworm + Sunrise Hiker" header repeats itself. Before the first draw, the deck has a blank gap and an unlabeled dashed discard box. The empty hand is about 170 px of nothing. After purchase, the organizer reads "You were charged $0", and the funding panel sits alone in half the page.
- **DH Architect.** Root cause of the overlay bug: `.panel { backdrop-filter }` makes each panel the containing block for `position:fixed` children. Cards clip because the faces are absolute inside a fixed 5:7 box. There is no Docker on the box, so `docker compose build` is verified on Adelin's Mac. Dockerfiles, compose and `.dockerignore` are unchanged, and no dependencies were added.

### Agreed and shipped (high impact, low risk)
1. **Modals portal to `<body>`** (`Overlay.tsx`): pack mint, fusion reveal and pay sheet. They scroll if taller than the screen. *Why:* it fixes both wow moments with one small component. E2E now asserts that each one is `toBeInViewport`.
2. **Every friend's card is its own.** `uniqueCardTitle` gives each card in a bouquet a distinct title, still built only from that friend's traits, so it still matches the chips. Cards grow to fit their chips and memory (the faces share one grid cell, with 5:7 as the minimum shape). *Why:* duplicate-looking cards undercut "everyone's knowledge counts". Tests: unit, API (3 identical answer sets give 3 titles) and E2E (3 distinct titles; the reveal memory is in the viewport).
3. **Gift table reads finished.** Gifts with no product get a same-size art tile of their traits' flowers, labelled "Group-curated box · no catalog product yet" (no invented product). Duo gifts are named like gifts: *Bookshelf & Trailhead Duo Box*. *Why:* even cards look polished, and nothing fake is shown. E2E: every candidate has exactly one photo or art tile.
4. **Deck and hand empty states.** A dashed card slot ("Draw a card · tap the deck or press Space · N trait cards") holds the space the drawn card lands in. The discard pile says "Swipe left or press ← to discard". The empty hand is a compact row. After the last draw, a "Deck curated" message points to fusing.
5. **Post-purchase tidy-up.** The funding panel is centered once funding is over, and an organizer with no hold reads "You didn't place a hold, so you weren't charged anything".

### Deferred
- Trait ties sort alphabetically, so a friend whose answers all differ gets ×1 chips in A–Z order. A better tie-break is a domain change and was not worth the risk today.
- Products for generic gifts (the known gap from this morning).
- Body scroll lock behind modals.

Build state after: API 35/35, realtime 2/2, Playwright 3/3 in WebSocket mode, and the flow also passes in SSE fallback (`E2E_FALLBACK=1`, worker stopped). Screenshots regenerated.

- **Carry-over for next cycle (moderator check, 10:10 AM):** in `10b-pay-sheet.png` the Visa sheet and its Hold button look washed out and faded, as if the screenshot caught the fade-in animation or the dimmed backdrop sits on top of the sheet. Verify, and fix either the capture timing or the stacking order.

## Sat Oct 17, 2026 · morning ship: real product photos + live room

### Real product catalog
- **Source.** Each store's own public Shopify product JSON (`/products/<handle>.json`).
  - *Why:* it gives the store's own title, price, canonical URL and CDN image without scraping HTML or using affiliate APIs.
  - Script: `api/scripts/build-catalog.mjs`. Output: `api/catalog/catalog.json` plus `api/catalog/images/` (21 products, about 1.1 MB).
- **Only real, fetched data.** Every URL, price and photo in the catalog was fetched by the script. Nothing is hand-typed. Every entry records `imageSource`.
  - A test checks that each recipe has 3 products, that URLs are canonical `/products/<handle>`, and that photos are served as images over 5 KB.
- **USD only.** We dropped a UK film shop (GBP prices) and used Retrospekt instead, so displayed prices match what a US group would pay.
- **Tiers are the products.** Tier titles and thresholds now come from the catalog, with each threshold set to the cumulative price rounded up to the dollar.
  - *Why:* "tier 2 funded" must buy the tier-2 products. Experience tiers such as concert tickets, workshops and dev credits were replaced with products, because they have no stable product page or price.
  - Recipe blurbs were rewritten to match. "Brunch & Beats Day" moved from tag `experience` to `clutter`, since it is now physical goods.
- **Photos are cached locally, never hotlinked.** On boot they are copied into storage (R2 when configured, otherwise the media volume) and served from `/api/media/catalog/*`. The demo works offline and the stores' CDNs aren't hit by our traffic.
- **Known gap (accepted):** generic fallback gifts (Treasure Box, duo boxes, photo book, favourite-things day) have no products and keep their icon.
  - *Why:* inventing a product for a generic trait would be dishonest. The E2E test has Priya and Sam vote for a product-backed gift so the photo path is always exercised.
- **Prices are a snapshot.** Rerun the script to refresh them. Live price refresh is deferred.

### Live room: Cloudflare Worker + Durable Object
- **One DO per bouquet** (`idFromName(bouquetId)`), using the WebSocket Hibernation API (`acceptWebSocket`/`getWebSockets`) so idle rooms cost nothing. The DO is a pure fan-out: Postgres stays the source of truth, and clients refetch state on each event. That way there is no second copy of money state that could drift.
- **Publishing.** The API publishes after every state change, fire-and-forget with a 2-second timeout and the `x-realtime-secret` header. A worker outage can never fail a request.
- **Auth.** The API signs a 2-minute HMAC-SHA256 ticket `{b, m, n, exp}`, and the worker verifies it with WebCrypto. A ticket is rejected if the signature is bad, it is for another room, or it has expired. Only members can get one (403 otherwise).
- **Fallback chain:** WebSocket, then SSE (the existing `/stream`), then 15-second polling. The room header shows "Live room · N here now" or "Live (fallback)" (`data-testid=live`, `data-mode`).
- **Local runtime.** The `realtime` compose service runs `wrangler dev --local` (workerd/miniflare) on Node 22, because wrangler 4 needs Node ≥ 22. The secret is passed with `--var`.
- **Tests:**
  - `realtime/test`: fan-out reaches only the room's sockets, presence works, and bad, expired, cross-room and unauthenticated requests are rejected.
  - API: the ticket signature verifies, publish carries the secret, outsiders get 403, and health shows `sse` when no worker is configured.
  - E2E: with `E2E_REALTIME=1`, the organizer sees friends' cards arrive with no reload. With `E2E_FALLBACK=1` and the worker stopped, SSE mode is used and the flow still passes.

### Keys due at 3 PM
- `.env.example` and the compose file now carry these variables:
  - `XAI_API_KEY`, `XAI_MODEL`, `XAI_IMAGE_MODEL`
  - `VISA_BASE_URL`, `VISA_USER_ID`, `VISA_PASSWORD`, `VISA_CERT_PATH`, `VISA_KEY_PATH`, `VISA_CA_PATH` (PEM files go in `./secrets`, mounted read-only)
  - `NAC_API_KEY`, `NAC_BASE_URL`, `NAC_TEST_PHONE`
- `npm run check:keys` probes each service read-only: xAI `/v1/models`, Visa `/vdp/helloworld` over mTLS, and NaC SIM Swap. It never prints secrets.
- **Honest status:** Visa credentials are probed only. Holds and captures remain on `MockVisaPayments` until we pick and wire a sandbox authorization, capture and reversal API. This is documented in the README.
