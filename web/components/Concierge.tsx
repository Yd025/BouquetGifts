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
      <p style={{ margin: '0 0 4px', fontWeight: 600 }} data-testid="concierge-standout">{p.standout}</p>
      <p style={{ margin: 0 }} data-testid={i === 0 ? 'concierge-why' : undefined}>{p.why}</p>
      <div className="muted" style={{ fontSize: 13, marginTop: 4 }} data-testid={i === 0 ? 'concierge-tier' : undefined}>{p.budget.full
        ? `Budget covers the whole ${$(p.budget.totalCents)} gift (all ${p.budget.items_total} items)`
        : p.budget.coversCents ? `Budget covers ${$(p.budget.coversCents)} of ${$(p.budget.totalCents)} (${p.budget.items} of ${p.budget.items_total} items)` : `First item is ${$(p.nextUpgrade?.priceCents ?? 0)}, above your budgets so far`}
        {p.nextUpgrade && p.budget.coversCents ? ` · ${$(p.nextUpgrade.priceCents)} adds ${p.nextUpgrade.title}` : ''}</div>
      <div className="row" style={{ marginTop: 6 }}><span className="grow" /><button className="sm btn" onClick={() => act('/vote', { candidateId: p.candidateId })} data-testid="concierge-vote">{s.me.vote === p.candidateId ? 'Voted ✓' : 'Vote for this'}</button></div>
    </div>)}</div>}
    {r && <div className="muted" style={{ fontSize: 12, marginTop: 10 }} data-testid="concierge-source">{r.source === 'gemini' ? 'Top pick worded by Gemini · ranking and prices come from Bouquet’s rules' : 'Ranked from your group’s kept cards, votes and budgets'}</div>}
  </div>;
}
