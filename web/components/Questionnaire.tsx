'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Flower, TraitCard } from './Art';
import Overlay from './Overlay';

/** One card per screen. Shared cards come first; random cards are visibly drawn from a deck. The flower grows as you answer. */
export default function Questionnaire({ s, setS, onMint }: any) {
  const bid = s.bouquet.id; const fb = s.members.find((m: any) => m.id === s.me.id)?.flowerBack;
  const [qs, setQs] = useState<any[]>([]); const [ans, setAns] = useState<Record<string, number>>({}); const [i, setI] = useState(0);
  const [story, setStory] = useState(''); const [err, setErr] = useState(''); const [mint, setMint] = useState<any>(null); const [phase, setPhase] = useState(0);
  useEffect(() => { api(`/bouquets/${bid}/questions`).then(x => setQs(x.questions)); }, [bid]);
  // Keep a draft so a refresh doesn't lose your answers (this browser only, cleared once the card is minted).
  const key = `bq-q-${bid}-${s.me.id}`; const restored = useRef(false);
  useEffect(() => { if (!qs.length || restored.current) return; restored.current = true;
    try { const d = JSON.parse(localStorage.getItem(key) ?? 'null'); if (d) { const ok = Object.fromEntries(Object.entries(d.ans ?? {}).filter(([id]) => qs.some((q: any) => q.id === id))) as Record<string, number>;
      setAns(ok); setI(Math.min(Object.keys(ok).length, qs.length)); setStory(String(d.story ?? '')); } } catch { /* ignore a bad draft */ } }, [qs, key]);
  useEffect(() => { if (restored.current && !mint) localStorage.setItem(key, JSON.stringify({ ans, story })); }, [ans, story, key, mint]);
  const total = qs.length + 1; const q = qs[i]; const answered = Object.keys(ans).length;
  const choose = (k: number) => { setAns(a => ({ ...a, [q.id]: k })); setTimeout(() => setI(x => Math.min(x + 1, qs.length)), 260); };
  const submit = async () => { setErr('');
    try { onMint?.(); const r = await api(`/bouquets/${bid}/cards`, { body: { answers: ans, story: story || undefined } }); const card = r.cards.find((c: any) => c.memberId === s.me.id);
      localStorage.removeItem(key); setMint({ r, card }); setPhase(0); setTimeout(() => setPhase(1), 700); setTimeout(() => setPhase(2), 1300); } catch (e: any) { setErr(e.message); setS(await api(`/bouquets/${bid}`)); } };
  if (!qs.length || !fb) return <div className="muted">Shuffling your cards…</div>;
  const growFb = { ...fb, petals: Math.max(3, Math.round(fb.petals * Math.min(1, (answered + 1) / qs.length))), layers: answered >= qs.length - 1 ? fb.layers : 1 };
  return <div className="qn">
    <div className="row"><h2 className="grow">Fill out your card</h2><span className="chip" data-testid="q-progress">Card {Math.min(i + 1, total)}/{total}</span></div>
    <div className="qdots">{Array.from({ length: total }).map((_, k) => <i key={k} className={k < i ? 'done' : k === i ? 'on' : ''} />)}</div>
    <div className="qgrid">
      <div className="qgrow" aria-hidden><Flower fb={growFb} size={150} /><div className="muted" style={{ fontSize: 12 }}>Your card art grows as you answer</div></div>
      {q ? <div className={`qcard ${q.kind === 'random' ? 'drawn-q' : ''}`} key={q.id} data-testid="q-card">
        {q.kind === 'random' ? <div className="drawbadge" data-testid="drawn-badge">A bonus question: only some friends get this one</div> : <div className="drawbadge shared">Everyone answers this</div>}
        <div className="prompt">{q.prompt}</div>
        <div className="opts">{q.options.map((o: string, k: number) => <button key={k} className={`opt ${ans[q.id] === k ? 'sel' : ''}`} onClick={() => choose(k)} data-testid="q-opt">{o}</button>)}</div>
        <div className="row" style={{ marginTop: 14 }}><button className="ghost" disabled={i === 0} onClick={() => setI(i - 1)}>← Back</button>
          {ans[q.id] !== undefined && <button className="ghost" onClick={() => setI(i + 1)}>Next →</button>}</div>
      </div> : <div className="qcard" data-testid="q-memory">
        <div className="drawbadge shared">Last card: your memory</div>
        <div className="prompt">Share a memory with {s.bouquet.recipientName}, in your own words</div>
        <textarea value={story} onChange={e => setStory(e.target.value)} placeholder={`I remember when ${s.bouquet.recipientName} and I…`} data-testid="story" rows={4} />
        <p className="muted" style={{ fontSize: 13 }}>It plays aloud when {s.bouquet.recipientName} opens the bouquet. Optional.</p>
        <div className="row"><button className="ghost" onClick={() => setI(i - 1)}>← Back</button>
          <button disabled={answered < qs.length} onClick={submit} data-testid="mint-card">Finish my card</button></div>
        {err && <div className="err">{err}</div>}
      </div>}
    </div>
    {mint && <Overlay testId="mint-overlay">
      <div className="mintstage">
        {phase < 2 && <div className={`pack ${phase >= 1 ? 'torn' : ''}`}><div className="packtop" /><div className="packbody"><Flower fb={fb} size={120} /><b>bouquet</b></div></div>}
        {phase >= 2 && <div className="pop" style={{ width: 240 }}><TraitCard card={{ ...mint.card, flowerBack: fb }} testId="minted-card" /></div>}
        {phase >= 2 && <button onClick={() => setS(mint.r)} data-testid="mint-done">Add to the bouquet →</button>}
      </div></Overlay>}
  </div>;
}
