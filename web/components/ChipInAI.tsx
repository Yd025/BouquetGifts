'use client';
import { useEffect, useRef, useState } from 'react';
import { api, $ } from '../lib/api';
/** "Just say it": a friend types how they want to chip in; Gemini turns it into a soft amount, a private cap and a payday, read back for confirmation before any Visa hold. */
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
export default function ChipInAI({ bid, onConfirm, endpoint, confirmLabel }: { bid?: string; onConfirm: (plan: any) => Promise<void>; endpoint?: string; confirmLabel?: string }) {
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [r, setR] = useState<any>(null); const [err, setErr] = useState('');
  const understand = async (t = text, conditionTierId?: string) => { setErr(''); setBusy(true); try { setR(await api(endpoint ?? `/bouquets/${bid}/chip-in/understand`, { body: { text: t, conditionTierId } })); } catch (e: any) { setErr(e.message); setR(null); } finally { setBusy(false); } };
  // 🎙 Say it out loud: the browser's own speech recognition (Web Speech API, free, on-device or browser-provided) fills the box, then we read it back.
  const [canMic, setCanMic] = useState(false); const [listening, setListening] = useState(false); const rec = useRef<any>(null);
  useEffect(() => { setCanMic(!!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)); }, []);
  const mic = () => {
    if (listening) { rec.current?.stop(); return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition; if (!SR) return;
    const r = new SR(); rec.current = r; r.lang = 'en-US'; r.interimResults = true; r.maxAlternatives = 1; let finalText = '';
    r.onresult = (e: any) => { let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; setText(t.slice(0, 500)); if (e.results[e.results.length - 1].isFinal) finalText = t.slice(0, 500); };
    r.onerror = (e: any) => { setListening(false); if (e?.error && e.error !== 'aborted' && e.error !== 'no-speech') setErr(e.error === 'not-allowed' ? 'Microphone permission was denied. You can type instead.' : 'Couldn’t hear that. You can type instead.'); };
    r.onend = () => { setListening(false); if (finalText.trim()) understand(finalText); };
    setErr(''); setListening(true); r.start();
  };
  const p = r?.plan; const payday = p?.payday ? new Date(p.payday + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : null;
  return <div className="aibox" data-testid="chipin-ai">
    <label className="sayit">Just say it <span className="chip aitag" title="Read by AI, then you confirm">AI</span></label>
    <div className="sayrow">
      <textarea name="chipinText" data-testid="chipin-text" rows={text.length > 30 ? 2 : 1} className="sayinput" maxLength={500}
        placeholder="“$30, up to $40”" value={text}
        onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && text.trim()) { e.preventDefault(); understand(); } }} />
      {canMic && <button className={'ghost mic tap' + (listening ? ' on' : '')} onClick={mic} disabled={busy} data-testid="chipin-mic" aria-pressed={listening} aria-label="Say it out loud" title="Say it out loud">{listening ? '■' : '🎙'}</button>}
      <button className="ghost tap" disabled={busy || !text.trim()} onClick={() => understand()} data-testid="chipin-understand">{busy ? '…' : 'Go'}</button></div>
    {err && <div className="err" role="alert" data-testid="chipin-error">{err}</div>}
    {p && <div className="readback pop" data-testid="chipin-plan">
      <div className="muted" style={{ fontSize: 12 }}>Here’s what I heard<span className="sronly" data-testid="chipin-source">{r.source === 'gemini' ? 'read by AI' : 'read by rules'}</span></div>
      {r.overCents && <div className="schedule" data-testid="chipin-over"><b>That’s more than the whole gift ({$(r.giftTotalCents)}).</b> {r.suggest?.length ? 'Did you mean:' : ''}
        <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 6 }}>{(r.suggest ?? []).map((c: number) => <button key={c} className="ghost sm tap" data-testid="chipin-suggest" onClick={() => { const t = `$${c / 100}`; setText(t); understand(t); }}>{c === r.giftTotalCents ? `The whole gift, ${$(c)}` : $(c)}</button>)}</div></div>}
      {r.choices && <div className="schedule" data-testid="chipin-choices"><b>{r.lookalike && r.choices.length === 1 ? `This gift doesn’t have “${p.conditional?.phrase}”. Did you mean the ${r.choices[0].title}?` : `Which one did you mean by “${p.conditional?.phrase}”?`}</b>
        <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 6 }}>{r.choices.map((c: any) => <button key={c.tierId} className="ghost sm" data-testid="chipin-choice" onClick={() => understand(text, c.tierId)}>{c.title}</button>)}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Until you pick, only the {$(p.holdNowCents)} part is planned.</div></div>}
      {p.condition && <div className="condbig" data-testid="chipin-condition"><b>{$(p.holdNowCents)} now, up to <span data-testid="chipin-cap-cond">{$(p.capCents)}</span> for the {cap(p.condition.tierTitle)}</b>
        <span>{p.condition.unlocksNow ? `Holding it now gets the group there right away.` : `+${$(p.condition.extraCents)} is offered later, only if the group goes for it. Nothing extra is held today.`}</span></div>}
      <div className="rbgrid">
        <div><span className="muted">Now</span><b data-testid="chipin-soft">{$(p.holdNowCents)}</b></div>
        <div><span className="muted">Max</span><b data-testid="chipin-cap">{$(p.capCents)}</b>{p.condition && <span className="muted" style={{ fontSize: 12 }}>only for the {cap(p.condition.tierTitle)}</span>}</div>
        {(p.scheduledTopUp || payday) && <div><span className="muted">{p.scheduledTopUp && payday ? `More on ${payday.split(',')[0]}` : 'Payday'}</span><b data-testid="chipin-payday">{p.scheduledTopUp ? $(p.scheduledTopUp.cents) : payday}</b></div>}</div>
      {p.scheduledTopUp && <div className="schedule" data-testid="chipin-schedule"><b>{payday}: up to {$(p.scheduledTopUp.cents)} more</b>, one tap, only if the group still needs it.</div>}
      {!p.condition && <p style={{ margin: '8px 0' }} data-testid="chipin-summary">{p.summary}</p>}
      {p.condition && <p className="sronly" data-testid="chipin-summary">{p.summary}</p>}
      {p.warnings.map((w: string) => <p key={w} className="muted" style={{ fontSize: 13, margin: '4px 0' }} data-testid="chipin-warning">ⓘ {w}</p>)}
      <div className="row" style={{ marginTop: 10 }}>
        <button disabled={busy || p.holdNowCents < 100 || !!r.overCents} data-testid="chipin-confirm" onClick={async () => { setBusy(true); try { await onConfirm(p); setR(null); setText(''); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }}>
          {p.holdNowCents >= 100 ? `Looks right: hold ${$(p.holdNowCents)}` : 'You’ve reached your limit'}</button>
        <button className="ghost" onClick={() => setR(null)}>Not quite</button></div>
      <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>Nothing is held until you confirm. Only you see your limit.</p>
    </div>}
  </div>;
}
