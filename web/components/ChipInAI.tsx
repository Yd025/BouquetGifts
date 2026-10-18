'use client';
import { useState } from 'react';
import { api, $ } from '../lib/api';
/** "Just say it": a friend types how they want to chip in; Gemini turns it into a soft amount, a private cap and a payday, read back for confirmation before any Visa hold. */
export default function ChipInAI({ bid, onConfirm }: { bid: string; onConfirm: (plan: any) => Promise<void> }) {
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [r, setR] = useState<any>(null); const [err, setErr] = useState('');
  const understand = async () => { setErr(''); setBusy(true); try { setR(await api(`/bouquets/${bid}/chip-in/understand`, { body: { text } })); } catch (e: any) { setErr(e.message); setR(null); } finally { setBusy(false); } };
  const p = r?.plan; const payday = p?.payday ? new Date(p.payday + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : null;
  return <div className="aibox" data-testid="chipin-ai">
    <label>Just say it <span className="chip ai">✨ AI</span></label>
    <textarea name="chipinText" data-testid="chipin-text" rows={2} style={{ width: '100%', resize: 'vertical' }} maxLength={500}
      placeholder="e.g. I can do about $30, $40 max, and I get paid Friday" value={text}
      onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && text.trim()) { e.preventDefault(); understand(); } }} />
    <div className="row" style={{ marginTop: 6 }}><span className="muted grow" style={{ fontSize: 12 }}>Mention a payday if you like (optional). Bouquet will hold what you can now and offer the rest as a one-tap top-up after you’re paid.</span>
      <button className="ghost" disabled={busy || !text.trim()} onClick={understand} data-testid="chipin-understand">{busy ? 'Reading…' : 'Understand'}</button></div>
    {err && <div className="err" role="alert" data-testid="chipin-error">{err}</div>}
    {p && <div className="readback pop" data-testid="chipin-plan">
      <div className="muted" style={{ fontSize: 12 }}>Here’s what I heard · <span data-testid="chipin-source">{r.source === 'gemini' ? 'read by Gemini' : 'read by Bouquet rules (Gemini offline)'}</span></div>
      <div className="rbgrid">
        <div><span className="muted">Comfortable</span><b data-testid="chipin-soft">{$(p.softCents)}</b></div>
        <div><span className="muted">Private cap</span><b data-testid="chipin-cap">{$(p.capCents)}</b></div>
        <div><span className="muted">Payday (optional)</span><b data-testid="chipin-payday">{payday ?? "not given"}</b></div></div>
      {p.scheduledTopUp && <div className="schedule" data-testid="chipin-schedule">📅 <b>{payday}: payday top-up of up to {$(p.scheduledTopUp.cents)}</b>, offered with one tap only if the group still needs it. Nothing is held for it today.</div>}
      <p style={{ margin: '8px 0' }} data-testid="chipin-summary">{p.summary}</p>
      {p.warnings.map((w: string) => <p key={w} className="muted" style={{ fontSize: 13, margin: '4px 0' }} data-testid="chipin-warning">ⓘ {w}</p>)}
      <div className="row" style={{ marginTop: 10 }}>
        <button disabled={busy || p.holdNowCents < 100} data-testid="chipin-confirm" onClick={async () => { setBusy(true); try { await onConfirm(p); setR(null); setText(''); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }}>
          {p.holdNowCents >= 100 ? `Looks right: hold ${$(p.holdNowCents)} with Visa` : 'Nothing left under your cap'}</button>
        <button className="ghost" onClick={() => setR(null)}>Not quite</button></div>
      <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>Nothing is held until you confirm on the Visa sheet. Your cap and payday stay private.</p>
    </div>}
  </div>;
}
