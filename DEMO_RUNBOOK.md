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
- Open Maya's gift on the laptop (My gifts → Maya's birthday gift). It starts at the card stage with Jon's, Priya's and Sam's cards.
- **If a run goes wrong, reset with one command** (laptop, signed in as demo@): open 🎬 Demo tools → **Reset demo**. If someone used the demo in the last 10 minutes it asks first; confirm to force it. (Same thing from a terminal: `POST /api/dev/reset-demo` with `{"force": true}` as demo@bouquet.gift.)

## The path
1. **Laptop, deck (record this first):** draw cards, keep/pass, put two kept cards together. The gift ideas turn over; vote; **Go with the top pick**. The gift is now funding, and Adelin's own $40 test-card hold is placed automatically so the Bought screen shows a real receipt.
2. **Phone 1 (Jon), the money moment:** open the gift, tap 🎙 next to *Just say it* and say "Thirty now, forty-five if we get the [last item on the strip]". The read-back shows **$30 now, up to $45 for that item** → *Looks right: hold $30* → the Visa sheet → *Hold $30*. The **"✓ You're in for $30 · •••• 4242"** card is pinned at the top.
3. **Laptop:** the vine grows and the funded items light up, live.
4. **Phone 2 (Leo), the blocked SIM swap:** tap $40 or type 60, *Chip in* → *Hold*. The sheet shows in red: **"We didn't place this hold. This number's SIM changed recently, so we're protecting your card."** Nothing is held. (Works whether or not Nokia is reachable: it falls back to Nokia's simulator answers.) Don't let Leo hold a small amount, or checkout will (correctly) ask to confirm him first.
5. **Laptop, checkout:** *Buy the gift*. The Bought ticket shows "You paid $X of your $40 hold" and one line per store: **"Paid <store> $X with a one-time Visa card •••• 1234 (sandbox)"**.
6. **The reveal:** copy the link under the receipt → open it → tear the pack, flip the cards, a memory is read aloud, and the gift card is revealed.

## Q&A (moved out of the video)
- **Live room:** a Cloudflare Worker with one Durable Object per gift (WebSocket Hibernation) pushes votes, funding and the reveal to everyone.
- **Why Gemini for words, rules for numbers:** the rules compute every dollar from the ledger; Gemini only rewords, and its version is shown only if every amount matches.
- **The ledger:** every hold, capture, release, renewal and one-time card is a ledger event; each person's receipt (charged + returned = held) comes from it.
- **Take my money back:** before checkout any friend can withdraw (under *Adjust*); the hold comes off and nothing is charged.
- **Who holds the money in production?** Nobody at Bouquet. We'd sit on an issuing/payfac partner (Visa issuing through a BaaS partner, or Stripe Connect + Issuing): friends' cards are authorized and captured by the processor, and the single-use store cards are issued by the partner, so Bouquet never holds funds.
- **Unit economics:** a 4% fee on a typical ~$150 group gift is about $6, plus store affiliate fees.
- **Card data:** the browser-side tokenization is a stub; production would use Visa/processor-hosted card fields.
