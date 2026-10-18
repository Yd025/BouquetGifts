# Demo runbook (the 2-minute path)

Live site: https://bouquetgiftsfrom.us · every password is `bouquet123`.

| Device | Sign in as | Role |
|---|---|---|
| Laptop | demo@bouquet.gift | Adelin, the organizer of "Maya's birthday gift" |
| Phone 1 | jon@bouquet.gift | Jon, a friend (Nokia's "not swapped" test number) |
| Phone 2 (or a private window) | leo@bouquet.gift | Leo, a friend whose number is Nokia's **SIM-swapped** test number (+99999991000) |
| Any browser | the reveal link from the Bought screen | Maya |

Priya (priya@) and Sam (sam@) are also seeded if you want more friends holding.

## Before you start
- **Demo the seeded Maya gift as the organizer (demo@ on the laptop), never a fresh gift.** Only the Maya gift places the organizer's own $40 test-card hold when the gift is picked, so the Bought ticket reads "You paid $X of your $40 hold". A gift made from scratch has no organizer hold and would say "You didn't place a hold".
- Open Maya's gift on the laptop (My gifts → Maya's birthday gift). It starts at the card stage with Jon's, Priya's and Sam's cards.
- **If a run goes wrong, reset with one command** (laptop, signed in as demo@): open 🎬 Demo tools → **Reset demo**. If someone used the demo in the last 10 minutes it asks first; confirm to force it. (Same thing from a terminal: `POST /api/dev/reset-demo` with `{"force": true}` as demo@bouquet.gift.)

## The path
1. **Laptop, deck (record this first):** draw cards, keep/pass, put two kept cards together. The gift ideas turn over; vote; **Go with the top pick**. The gift is now funding, and Adelin's own $40 test-card hold is placed automatically so the Bought screen shows a real receipt.
2. **Phone 1 (Jon), the money moment:** open the gift, tap 🎙 next to *Just say it* and say "Thirty now, forty-five if we get the [last item on the strip]". The read-back shows **$30 now, up to $45 for that item** → *Looks right: hold $30* → the Visa sheet → *Hold $30*. The **"✓ You're in for $30 · •••• 4242"** card is pinned at the top.
3. **Laptop:** the vine grows and the funded items light up, live.
4. **Phone 2 (Leo), the blocked SIM swap:** type 60 in the amount box (holds of $50 or more get the carrier check), *Chip in $60* → *Hold $60*. The sheet shows in red: **"We didn't place this hold. This number's SIM changed recently, so we're protecting your card."** Nothing is held. (Works whether or not Nokia is reachable: it falls back to Nokia's simulator answers.) Don't let Leo hold a small amount, or checkout will (correctly) ask to confirm him first.
5. **Laptop, checkout:** *Buy the gift*. The Bought ticket shows "You paid $X of your $40 hold" and one line per store: **"Paid <store> $X with a one-time Visa card •••• 1234 (sandbox)"**.
6. **The reveal:** copy the link under the receipt → open it → tear the pack, flip the cards, a memory is read aloud, and the gift card is revealed.

## Q&A (moved out of the video)
- **Live room:** a Cloudflare Worker with one Durable Object per gift (WebSocket Hibernation) pushes votes, funding and the reveal to everyone.
- **Why Gemini for words, rules for numbers:** the rules compute every dollar from the ledger; Gemini only rewords, and its version is shown only if every amount matches.
- **The ledger:** every hold, capture, release, renewal and one-time card is a ledger event; each person's receipt (charged + returned = held) comes from it.
- **Take my money back:** before checkout any friend can withdraw (under *Adjust*); the hold comes off and nothing is charged.
- **Unit economics:** a 4% fee on a typical ~$150 group gift is about $6, plus store affiliate fees.
- **Card data:** the browser-side tokenization is a stub; production would use Visa/processor-hosted card fields.

## Money Q&A (answer these with confidence)
- **Don't card holds expire?** Holds are placed or renewed only within the authorization window before the buy-by date, and renewed on day 6. Pledges made earlier than that are commitments, not holds. (Today's demo build places the hold at chip-in and renews it on day 6; a renewal the card declines releases the hold and asks the friend to hold again.)
- **Who is the merchant of record? Who holds the money?** Bouquet is the merchant of record through a licensed payment facilitator partner. Stores are paid with single-use Visa virtual cards from an issuing partner (for example Visa issuing through a BaaS partner, or Stripe Connect + Issuing), so Bouquet never holds funds itself.
- **Can you really charge less than the hold?** Yes. Partial capture is a standard authorization feature: we capture each friend's share and the rest of the hold is released automatically.

## Why early friends do the card quiz first
Friends invited early fill out a card about Maya before money ever comes up. That's on purpose: the cards pick the gift, so there's nothing to price until the deck has turned into a real gift. Friends invited after funding opens skip the quiz and go straight to chipping in.
