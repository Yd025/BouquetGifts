'use client';
import { useState } from 'react';
import { api } from '../lib/api';
/** "Explain my payment": who pays what, why that tier, what happens to the rest, in plain words for this one person. */
export default function ExplainPay({ bid, label = 'Explain my payment' }: { bid: string; label?: string }) {
  const [r, setR] = useState<any>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [math, setMath] = useState(false);
  const go = async () => { setErr(''); setBusy(true); try { setR(await api(`/bouquets/${bid}/explain`)); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  return <div style={{ marginTop: 14 }}>
    <button className="ghost" onClick={go} disabled={busy} data-testid="explain-pay">{busy ? 'Thinking…' : <>✨ {label}</>}</button>
    {err && <div className="err" role="alert">{err}</div>}
    {r && <div className="explain pop" data-testid="explain-text">
      <p style={{ margin: 0 }}>{r.text}</p>
      <div className="row muted" style={{ fontSize: 12, marginTop: 8 }}><span className="grow" data-testid="explain-source">{r.source === 'gemini' ? 'Worded by Gemini · every amount checked against the ledger' : 'Every amount computed from the group’s ledger'}</span>
        {r.source === 'gemini' && <button className="ghost sm" onClick={() => setMath(!math)}>{math ? 'Hide' : 'Show'} the exact math</button>}</div>
      {math && <p className="muted" style={{ fontSize: 13, margin: '6px 0 0' }} data-testid="explain-rules">{r.rules}</p>}
    </div>}
  </div>;
}
