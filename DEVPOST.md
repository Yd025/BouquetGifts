# Bouquet ✿ — gifts grown by everyone who loves them

## Inspiration
Every friend group has one person who ends up organizing the gift. They guess what to buy, put it on their own card, and then spend three weeks chasing Venmo requests. The rest of the group knows things that would have made the gift better ("she's been shooting film all summer"), but none of it gets to the person buying it. Group-gift tools only collect money. We wanted to change the whole shopping journey for a group buying together: how they discover the gift, decide on it, pay for it, and give it.

## What it does
Bouquet is a group gift played as a card game.
- **Plant:** the organizer sets the recipient, the occasion, and when the gift has to arrive. Bouquet subtracts shipping time to get a **buy-by deadline**.
- **Invite:** friends tap a face-down card and join as a guest with just a name and phone number. The **T-Mobile network verifies the number** (CAMARA Number Verify), so there's no OTP, app or account to create until they chip in.
- **Card:** one question per screen. Shared questions come first, then random ones **drawn from a deck**, so every card is different. The art grows as you answer, and minting tears open a pack. Each card's title comes from the friend's own answers, with stat chips like *Sunrise Hiker ×2*, and no two friends in a bouquet get the same title. The chips follow the title: most answers first, and on a tie the trait the title names comes first, so *The Caffeinated Sunrise Hiker* lists *Coffee Snob ×1* before *Bookworm ×1*. Every card has its own flower back, and the art is painted by **Gemini's image model** (with an instant SVG placeholder), cached in Cloudflare R2. One answer ("which gift would annoy them?") filters out bad gifts.
- **Draw & fuse:** everyone's answers become a **deck of trait cards** with common, rare and legendary frames that shimmer. Each friend draws from the deck and **keeps (swipe right) or discards (swipe left)** each card, Tinder-style, with buttons and arrow keys as an alternative and an Undo. Kept cards fan out into a **hand**. Select or drag two hand cards together and they **fuse** into a gift card, so *Sunrise Hiker + Coffee Snob* becomes a summit pour-over kit. **Rare fusions only unlock when 2+ friends agree**, and every gift cites whose answers produced it. A fusion counts as your vote, and the gift table shows live tallies. Every gift on the table, including the safe-pick Treasure Box and wildcard Duo Boxes, is made of **real products for its traits** and shows a real product photo, with no photo repeated on one table, even after a friend fuses a new gift from their hand.
- **Bloom:** each friend sets **their own budget** and places a **Visa hold**, not a charge. The gift gets bigger in tiers as people join. Each tier is a **real product with its real photo, store link and price** (a GSI pour-over set, then a TIMEMORE grinder, then Fellow beans), and the thresholds are the actual cumulative prices. The bouquet on screen grows as it fills, and the gift itself is shown as a strip of its products that light up one by one as tiers are funded. A **Who's in** list shows who is holding (never how much), next to the buy-by countdown. Holding already? The button says "Add $20 more with Visa", so nobody wonders whether it replaces their hold.
- **Checkout:** before anyone checks out, each friend sees their exact share ("If the group checks out now, you pay $22 of your $45 hold"), and an over-funded gift says where the extra goes ("Checkout charges exactly $96 … the extra $39 is released, never charged"). The preview runs the same allocation code as checkout. After checkout, in plain English ("You were charged $38.18, not $45, because the group funded tier 2"), holds are captured at the **highest tier the group fully funded**, split fairly in proportion to each hold. Anything left over is released. If the deadline passes, **every hold is released** and nobody pays. Once bought, the room header stops counting down and says **"✓ Purchased in time"**.
- **Reveal:** the recipient tears open a pack. Each card turns a trait into a compliment ("You chase every sunrise") and a **Gemini TTS narrator** reads that friend's own memory aloud. The finale is a holo legendary gift card in a **garland** with confetti.
- **Works on a phone:** judges and friends usually open the invite link on a phone. At 390px the landing pitch fits with nothing cut off, the nav stays on one screen width, the gift table stacks into one column, and the friend cards become a swipeable row instead of a stack of full-screen cards.
- **Judge demo drawer** (a small 🎬 button that sits in the page margin, clear of the panels): try a declined card, simulate a SIM-swapped friend (T-Mobile blocks the hold), and fast-forward past the deadline (every hold is released).

## How we built it
- **Next.js 14** frontend with hand-drawn SVG: procedural flower card backs, a bouquet that blooms with funding, and the garland frame. Cards use 3D flip animations.
- **Express + TypeScript** API on **Postgres**, with an embedded PGlite (WASM Postgres) for tests. The app is a state machine: collecting → fusing → funding → purchased → revealed, or expired.
- **Money safety:** amounts are integer cents, ledger events are append-only, and the funded total is always the sum of the ledger, never a stored counter. Holds are idempotent, and checkout uses `SELECT … FOR UPDATE`. We tested it against double-click checkouts and against checkout racing the deadline sweeper.
- **Adapters:** a payments service (mock Visa holds, capture and release) built to swap in a real processor, **T-Mobile CAMARA** Number Verify + SIM Swap (Nokia Network-as-Code style, with SIM Swap checked before large holds and before capture), and **Google Gemini** for card titles, memory polish and gift pitches (`gemini-2.5-flash`), card art (`gemini-2.5-flash-image`) and the reveal narrator (`gemini-2.5-flash-preview-tts`), with every generated image and voice line cached so it is made once. Every adapter has a deterministic mock so the demo works offline.
- **Live room on Cloudflare:** a Worker plus a **Durable Object per bouquet** (WebSocket Hibernation) fans out votes, funding and the reveal to everyone in the room, with presence. The API signs short-lived member tickets with HMAC. If the worker is unreachable, the room falls back to SSE and then polling.
- **Real catalog:** 37 products from 16 US stores, covering every recipe and every trait. Product data and photos come from each store's public product JSON, and the script refuses any store whose `/meta.json` isn't USD. Photos are cached locally and served from R2 or local storage, and tier thresholds are the real cumulative prices.
- **Testing:** Vitest unit tests (consensus, tiers, pro-rata capture fuzzed across 200 cases), API integration tests, and a Playwright end-to-end run that plays an organizer, three friends, and the recipient.

## Challenges
- Splitting a capture fairly in integer cents, so it never exceeds any single hold and always adds up exactly (we used a largest-remainder split).
- Making "rare fusion" mean something. It requires distinct friends to agree, not the same friend picking a trait twice.
- Handling a buy-by deadline that can fire during checkout.

## Accomplishments
A working flow from the first invite to the garland reveal, in which no single friend ever fronts the money and the gift is picked by what the whole group knows about the person.

## What we learned
Payments logic is more about idempotency, locking, and the ledger than about calling a charge API.

## What's next
Voice interviews with Gemini Live (friends talk instead of type), a voice for each friend in the reveal, real Visa sandbox holds (credentials are already wired and probed; holds still run on the mock until then), and live catalog price refresh.

## Built with
nextjs · react · typescript · cloudflare-turnstile · cloudflare-r2 · cloudflare-workers · durable-objects · websockets · express · postgresql · pglite · docker · playwright · vitest · google-gemini · gemini-tts · camara · t-mobile · visa
