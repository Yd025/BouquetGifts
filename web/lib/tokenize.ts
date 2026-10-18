/** Card tokenization happens in the browser: the full number never leaves this page.
 *  We check it (Luhn), then hand the server only a one-time token and the last 4 digits, the same shape a real
 *  processor's hosted card field returns. Sandbox only: no real network is contacted. */
export function luhn(d: string) { let s = 0; for (let i = 0; i < d.length; i++) { let n = +d[d.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9; } s += n; } return s % 10 === 0; }
export function tokenizeCard(raw: string): { cardToken: string; last4: string } {
  const d = String(raw).replace(/\D/g, '');
  if (d.length < 13 || d.length > 19 || !luhn(d)) throw new Error('That card number doesn’t look right. Please check it.');
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
  return { cardToken: 'tok_' + rand, last4: d.slice(-4) };
}
