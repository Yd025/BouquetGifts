# Devpost form: ready-to-paste answers

## Project name
Bouquet Gifts

## Elevator pitch
Group gifts where friends just say what they can chip in ("$30, or $42 if we get the record"), AI turns it into fair Visa holds, and nobody fronts the money.

## Which AI tools did you use this weekend?
- **Gemini** (in the product)
- **Other:** AI coding agents (Cursor and Grok Bot) helped write and test the code. They are development tools only; nothing in the running app calls them.

## Did you implement a generative AI model or API in your hack? How and why?
Yes, Google Gemini through the Gemini API. Gemini 2.5 Flash (falling back to Flash-Lite when the free quota runs out) reads plain-words and voice chip-ins ("about $30, $40 max, paid Friday") into a hold, a private cap and a payday using JSON mode; it also words the gift concierge's picks, the per-person payment explainer and the top-up nudges, and writes card titles and gift blurbs. Gemini 2.5 Flash TTS narrates each friend's memory in the recipient's reveal. We used it because group payments break down where people talk in sentences and payment forms want numbers. A deterministic rules engine computes every dollar from the ledger: amounts Gemini returns must appear in what the person said, holds are capped by their own budget, conditional pledges are parsed by rules, and any AI wording that changes, adds or drops an amount (or changes whose gift it is) is rejected and the rules text is shown instead. We also wired Gemini 2.5 Flash Image for card art, but our key had no image quota, so cards fall back to procedural SVG art. Every AI feature works without Gemini.
