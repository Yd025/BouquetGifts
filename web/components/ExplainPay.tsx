'use client';
import { useState } from 'react';
import { api, $ } from '../lib/api';
/** "Explain my payment": who pays what, why that tier, what happens to the rest, in plain words for this one person. */
export default function ExplainPay({ bid, label = 'What will I pay?' }: { bid: string; label?: string }) {
  const [r, setR] = useState<any>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); 
  const go = async () => { setErr(''); setBusy(true); try { setR(await api(`/bouquets/${bid}/explain`)); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  return <div style={{ marginTop: 14 }}>
    <button className="ghost" onClick={go} disabled={busy} data-testid="explain-pay">{busy ? 'Thinking…' : label}</button>
    {err && <div className="err" role="alert">{err}</div>}
    {r && <div className="explain pop" data-testid="explain-text">
      {r.receipt && <div className="receipt" data-testid="explain-receipt">
        <div className="rl"><span>{r.receipt.mode === 'preview' ? 'You’d be charged' : r.receipt.mode === 'pending' ? 'Charged so far' : 'Charged'}</span><b data-testid="receipt-charged">{$(r.receipt.chargedCents)}</b></div>
        <div className="rl"><span>Back to your card</span><b data-testid="receipt-released">{$(r.receipt.releasedCents)}</b></div>
        <div className="rl why"><span>Why</span><span data-testid="receipt-why">{r.receipt.why}</span></div></div>}
      <details className="whyprose"><summary data-testid="explain-why">Why?</summary><p style={{ margin: '6px 0 0' }}>{r.text}</p>
        {r.source === 'gemini' && <p className="muted" style={{ fontSize: 13, margin: '6px 0 0' }} data-testid="explain-rules">Exact numbers: {r.rules}</p>}</details>
      <div className="row muted" style={{ fontSize: 12, marginTop: 8 }}><span className="grow" data-testid="explain-source">Every amount comes from the group’s records · demo, no real money moves</span></div>
    </div>}
  </div>;
}
