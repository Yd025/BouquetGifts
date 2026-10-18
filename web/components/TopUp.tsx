'use client';
import { useEffect, useRef, useState } from 'react';
import { api, $ } from '../lib/api';
/** Your own top-up ask: a fair share of the gap, never above what you said you could do (nobody else's amount or cap is ever shown). One tap re-uses your saved Visa card after a SIM Swap check. */
export default function TopUp({ s, setS }: { s: any; setS: (x: any) => void }) {
  const [r, setR] = useState<any>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState<number | null>(null);
  const bid = s.bouquet.id;
  useEffect(() => { api(`/bouquets/${bid}/topup`).then(setR).catch(() => setR(null)); }, [bid, s.totals.heldCents, s.now?.slice(0, 13), s.me.budgetMaxCents, s.me.payday]);
  const a = r?.ask;
  // One idempotency key per ask on screen (same tier + amount): double taps and retries can't stack two top-ups.
  const key = useRef({ id: '', k: '' }); const askId = a ? `${a.tierTitle}|${a.cents}` : '';
  if (askId && key.current.id !== askId) key.current = { id: askId, k: crypto.randomUUID() };
  if (done && !a) return <div className="topup ok" data-testid="topup-done">✓ Topped up {$(done)} · <span data-testid="topup-phonecheck">📶 phone check passed</span>. The room updates for everyone.</div>;
  if (!a) return null;
  const on = a.availableAt ? new Date(a.availableAt + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : null;
  return <div className={`topup pop ${on ? 'later' : ''}`} data-testid="topup">
    <div className="row"><b className="grow" data-testid="topup-title">{on ? `📅 ${on} (your payday): top up ${$(a.cents)}?` : `💐 Top up ${$(a.cents)}?`}</b><span className="chip ai">✨ AI plan</span></div>
    <p style={{ margin: '6px 0' }} data-testid="topup-message">{a.message}</p>
    {on ? <p className="muted" style={{ fontSize: 13, margin: 0 }}>Nothing is held until then. The button turns on on your payday.</p>
      : <button disabled={busy} data-testid="topup-accept" onClick={async () => { setErr(''); setBusy(true);
          try { const st = await api(`/bouquets/${bid}/topup/accept`, { body: { cents: a.cents, idempotencyKey: key.current.k } }); setDone(a.cents); setS(st); }
          catch (e: any) { setErr(e.message); api(`/bouquets/${bid}/topup`).then(setR).catch(() => {}); } finally { setBusy(false); } }}>
          Top up {$(a.cents)} with Visa •••• {a.last4}</button>}
    <div className="topup-group" data-testid="topup-group"><b>+{$(a.cents)} from you</b>{a.friends > 1 ? ` · ${a.friends - 1} other friend${a.friends > 2 ? 's are' : ' is'} getting their own ask` : ' · you can close this one alone'}</div>
    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Never more than you said you could do. Nobody sees anyone else’s ask. A carrier SIM-swap check runs before the hold{r.source === 'gemini' ? ' · worded by Gemini' : ''}.</div>
    {err && <div className="err" role="alert">{err}</div>}
  </div>;
}
