'use client';
import { useState } from 'react';
import { api, $ } from '../lib/api';
/** AI gift concierge: the group's kept cards + votes + combined budget caps → a ranked pick, why it fits, and what the next upgrade costs. */
export default function Concierge({ s, act }: { s: any; act: (p: string, body?: any) => Promise<void> }) {
  const [r, setR] = useState<any>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const ask = async () => { setErr(''); setBusy(true); try { setR(await api(`/bouquets/${s.bouquet.id}/concierge`)); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  return <div className="panel" data-testid="concierge">
    <div className="row"><h2 className="grow" style={{ margin: 0 }}>Not sure? Get a suggestion</h2>
      <button className="ghost" onClick={ask} disabled={busy} data-testid="concierge-ask">{busy ? 'Thinking…' : r ? 'Ask again' : 'Pick for us'}</button></div>
    <p className="muted" style={{ fontSize: 13 }}>Looks at the cards your group kept and the votes, and ranks the gifts. Prices assume everyone goes up to their limit. Nobody’s own number is shown.</p>
    {err && <div className="err" role="alert">{err}</div>}
    {r && <div className="cands" style={{ marginTop: 8 }}>{r.picks.map((p: any, i: number) => <div key={p.candidateId} className={`cand ${i === 0 ? 'mine' : ''}`} data-testid="concierge-pick">
      <div className="fusion">{i === 0 ? '★ Top pick' : `#${i + 1}`}</div><h3 style={{ margin: '4px 0' }}>{p.title}</h3>
      <p style={{ margin: '0 0 4px', fontWeight: 600 }} data-testid="concierge-standout">{p.standout}</p>
      <p style={{ margin: 0 }} data-testid={i === 0 ? 'concierge-why' : undefined}>{p.why}</p>
      <div className="muted" style={{ fontSize: 13, marginTop: 4 }} data-testid={i === 0 ? 'concierge-tier' : undefined}>{p.budget.full
        ? `Within reach if everyone goes to their limit: all ${p.budget.items_total} items, ${$(p.budget.totalCents)}`
        : p.budget.coversCents ? `Limits could cover ${$(p.budget.coversCents)} of ${$(p.budget.totalCents)} (${p.budget.items} of ${p.budget.items_total} items)` : `First item is ${$(p.nextUpgrade?.priceCents ?? 0)}, more than everyone’s limits so far`}
        {p.nextUpgrade && p.budget.coversCents ? ` · ${$(p.nextUpgrade.priceCents)} adds ${p.nextUpgrade.title}` : ''}</div>
      <div className="row" style={{ marginTop: 6 }}><span className="grow" /><button className="sm btn" onClick={() => act('/vote', { candidateId: p.candidateId })} data-testid="concierge-vote">{s.me.vote === p.candidateId ? 'Voted ✓' : 'Vote for this'}</button></div>
    </div>)}</div>}
    {r && <div className="muted" style={{ fontSize: 12, marginTop: 10 }} data-testid="concierge-source">Ranked from your group’s cards, votes and limits</div>}
  </div>;
}
