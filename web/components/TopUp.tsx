'use client';
import { useEffect, useState } from 'react';
import { api, $ } from '../lib/api';
/** Your own top-up ask, sized to your private cap (nobody else's amount or cap is ever shown). One tap re-uses your saved Visa card. */
export default function TopUp({ s, setS }: { s: any; setS: (x: any) => void }) {
  const [r, setR] = useState<any>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState<number | null>(null);
  const bid = s.bouquet.id;
  useEffect(() => { api(`/bouquets/${bid}/topup`).then(setR).catch(() => setR(null)); }, [bid, s.totals.heldCents, s.now?.slice(0, 13), s.me.budgetMaxCents, s.me.payday]);
  const a = r?.ask;
  if (done && !a) return <div className="topup ok" data-testid="topup-done">✓ Topped up {$(done)}. The room updates for everyone.</div>;
  if (!a) return null;
  const on = a.availableAt ? new Date(a.availableAt + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : null;
  return <div className={`topup pop ${on ? 'later' : ''}`} data-testid="topup">
    <div className="row"><b className="grow" data-testid="topup-title">{on ? `📅 ${on} (your payday): top up ${$(a.cents)}?` : `💐 Top up ${$(a.cents)}?`}</b><span className="chip ai">✨ AI plan</span></div>
    <p style={{ margin: '6px 0' }} data-testid="topup-message">{a.message}</p>
    {on ? <p className="muted" style={{ fontSize: 13, margin: 0 }}>Nothing is held until then. The button turns on on your payday.</p>
      : <button disabled={busy} data-testid="topup-accept" onClick={async () => { setErr(''); setBusy(true);
          try { const st = await api(`/bouquets/${bid}/topup/accept`, { body: { cents: a.cents, idempotencyKey: crypto.randomUUID() } }); setDone(a.cents); setS(st); }
          catch (e: any) { setErr(e.message); api(`/bouquets/${bid}/topup`).then(setR).catch(() => {}); } finally { setBusy(false); } }}>
          Top up {$(a.cents)} with Visa •••• {a.last4}</button>}
    <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Sized to the cap you set. Friends only ever see their own ask{r.source === 'gemini' ? ' · worded by Gemini' : ''}.</div>
    {err && <div className="err" role="alert">{err}</div>}
  </div>;
}
