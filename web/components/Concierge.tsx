'use client';
import { useState } from 'react';
import { api, $ } from '../lib/api';
/** AI gift concierge: the group's kept cards + votes + combined budget caps → a ranked pick, why it fits, and what the next upgrade costs. */
export default function Concierge({ s, act }: { s: any; act: (p: string, body?: any) => Promise<void> }) {
  const [r, setR] = useState<any>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const ask = async () => { setErr(''); setBusy(true); try { setR(await api(`/bouquets/${s.bouquet.id}/concierge`)); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  return <div className="panel" data-testid="concierge">
    <div className="row"><h2 className="grow" style={{ margin: 0 }}>Gift concierge <span className="chip ai">✨ AI</span></h2>
      <button className="ghost" onClick={ask} disabled={busy} data-testid="concierge-ask">{busy ? 'Thinking…' : r ? 'Ask again' : 'Pick for us'}</button></div>
    <p className="muted" style={{ fontSize: 13 }}>Reads the cards your group kept, the votes, and everyone’s budget caps added together (never anyone’s own number), then ranks the gifts on the table.</p>
    {err && <div className="err" role="alert">{err}</div>}
    {r && <div className="cands" style={{ marginTop: 8 }}>{r.picks.map((p: any, i: number) => <div key={p.candidateId} className={`cand ${i === 0 ? 'mine' : ''}`} data-testid="concierge-pick">
      <div className="fusion">{i === 0 ? '★ Top pick' : `#${i + 1}`}</div><h3 style={{ margin: '4px 0' }}>{p.title}</h3>
      <p style={{ margin: 0 }} data-testid={i === 0 ? 'concierge-why' : undefined}>{p.why}</p>
      <div className="muted" style={{ fontSize: 13 }} data-testid={i === 0 ? 'concierge-tier' : undefined}>{p.reachableTier ? `Budget reaches tier ${p.reachableTier.level}` : 'Over budget so far'}{p.nextTier ? ` · next upgrade: ${p.nextTier.title} at ${$(p.nextTier.thresholdCents)}` : ' · every tier fits'}</div>
      <div className="row" style={{ marginTop: 6 }}><span className="grow" /><button className="sm btn" onClick={() => act('/vote', { candidateId: p.candidateId })} data-testid="concierge-vote">{s.me.vote === p.candidateId ? 'Voted ✓' : 'Vote for this'}</button></div>
    </div>)}
      <div className="muted" style={{ fontSize: 12 }} data-testid="concierge-source">{r.source === 'gemini' ? 'Top pick worded by Gemini · ranking and prices come from Bouquet’s rules' : 'Ranked by Bouquet rules (Gemini offline)'}</div></div>}
  </div>;
}
