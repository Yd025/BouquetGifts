# Bouquet: demo video script (about 2:15)

**0:00–0:15 · Hook (face cam or title card)**
"Every group gift has one person who guesses the gift, fronts the money, and chases Venmo for weeks. Everyone else knows something that would have made the gift better, and none of it gets used. We built Bouquet."

**0:15–0:30 · Plant** *(screen: landing, with the sample bouquet's real product photos → sign up → Plant a bouquet)*
"I'm making a bouquet for Maya's birthday. It needs to arrive by the 30th, and shipping takes three days, so Bouquet sets a buy-by deadline. If we miss it, nobody gets charged."

**0:30–0:50 · Invite + Card** *(screen: invite link → join page with the T-Mobile badge → questionnaire)*
"Friends tap a face-down card and join with just a name and a number. T-Mobile's network verifies it, so there are no codes and no account yet. Then it's one card per screen. This question was drawn from the deck, so not everyone gets it, and the flower grows as Jon answers. He writes a memory in his own words, mints, and the pack tears open: *The Well-Read Sunrise Hiker*."

**0:50–1:10 · Draw, keep, fuse** *(screen: deck → draw flips → swipe right KEEP stamp → swipe left to discard → hand fan → select two → fusion animation)*
"Everyone's cards flip together, each with its own title and memory. Their answers become a deck. I draw. Film Shooter, legendary, because all three friends said it. Swipe right to keep. Coffee Snob, swipe left. Oops, undo. Now I fuse two cards from my hand, and out comes a trail film camera set. It's a rare fusion, so it only unlocks because two or more friends agreed. My fusion is my vote, and the gift table updates live for everyone. That runs on a Cloudflare Durable Object, one per bouquet, on the free plan. Not sure which gift to pick? I ask the Gemini concierge. It reads the cards we kept and everyone's budget caps added together, and tells us what sets each gift apart: the trail film camera set is the only rare fusion, and our budget covers all of it."

**1:10–1:50 · AI between people and payment** *(screen: "Just say it" box → read-back card → Visa sheet prefilled → hold; then "✨ Explain my payment")*
"This is where people and payments usually clash. Payment forms want numbers, but people talk in sentences. So Jon just types: 'I can do about thirty, forty max, and I get paid Friday.' Gemini reads it back: thirty now, a private cap of forty, payday Friday, and it warns him if payday falls after the buy-by date. Gemini can't invent money: if it names an amount Jon never wrote, we throw it out. The payday is optional, but because he gave one, Bouquet holds thirty now and offers the last ten as a one-tap top-up on Friday, only if the group still needs it. One tap and the Visa sheet is already filled in with thirty dollars. When the group is a few dollars short of the next item, each friend gets their own small ask, sized to the cap they set, never anyone else's: 'Top up four dollars?' One tap on their saved card, and everyone's room updates live. And at any point, anyone can tap 'Explain my payment': 'If Olive checks out now, you pay twenty-nine seventy of your thirty dollar hold, and thirty cents goes back. Tier two costs ninety-eight, the group holds ninety-nine, so it's fully funded.' Our rules compute every number from the ledger, Gemini makes the wording human, and we only show its version if every dollar amount matches."

**1:50–2:00 · Bloom + Checkout** *(screen: gift strip lighting up, bloom growing, checkout → header reads "✓ Purchased in time")*
"Those are Visa holds, not charges, and Cloudflare Turnstile quietly checks it's a human first. As the group fills it, the gift grows into real products from real stores: a 35mm camera, then Kodak Gold film, then a Polaroid. These are their actual photos and prices, and each one lights up at the top of the page as we fund it. At checkout, Bouquet captures the highest tier we fully funded, splits it fairly, and releases the rest. The countdown turns into a green 'Purchased in time.'"

*Honesty note (don't read aloud): Visa isn't issuing API credentials this weekend, so holds, captures and releases run on our mock Visa sandbox. Say so if asked, and say it on the Devpost. T-Mobile checks run on the mock until the Nokia Network as Code key is wired in. If Gemini is down, each AI box says "Bouquet rules (Gemini offline)" and still works.*

**2:00–2:10 · Reveal** *(screen: recipient pack → cards flip with voice → garland gift)*
"Maya tears open her pack. Every card turns a trait into a compliment, 'You chase every sunrise', and a Gemini voice reads that friend's memory in their own words. The last card is legendary: her gift, with a photo of exactly what's coming, in a garland, with confetti."

*(optional, 10s, judge drawer: click the small 🎬 button at the bottom right)* "And for the judges: a SIM-swapped phone tries to put $60 on hold, and T-Mobile blocks it. Fast-forward past the deadline, and every hold is released."

**2:10–2:15 · Close**
"Bouquet. AI that speaks human between your friends and the payment. Gifts grown by everyone who loves them. Built with Google Gemini, on a Visa sandbox, T-Mobile network APIs and Cloudflare."

*Recording tip (don't read aloud): record at 1280px or wider so the 🎬 button stays in the page margin. For a phone cut-in, the room works at 390px: the friend cards swipe sideways in one row.*
