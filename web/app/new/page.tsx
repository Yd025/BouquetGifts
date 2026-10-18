'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
export default function New() {
  const r = useRouter(); const def = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const [f, setF] = useState({ recipientName: '', occasion: 'Birthday', note: '', neededBy: def, shipBufferDays: 3, budget: 50 }); const [err, setErr] = useState('');
  const buyBy = new Date(new Date(f.neededBy + 'T12:00:00').getTime() - f.shipBufferDays * 864e5);
  const submit = async (e: any) => { e.preventDefault(); setErr('');
    try { const s = await api('/bouquets', { body: { recipientName: f.recipientName, occasion: f.occasion, note: f.note || undefined, neededBy: new Date(f.neededBy + 'T12:00:00').toISOString(), shipBufferDays: Number(f.shipBufferDays), budgetMaxCents: Math.round(f.budget * 100) } });
      r.push(`/b/${s.bouquet.id}`); } catch (x: any) { if (x.status === 401) r.push('/login?next=/new'); setErr(x.message); } };
  return <div className="panel narrow" style={{ maxWidth: 560 }}><h1>Start a gift</h1><p className="muted">Who’s it for, and when does it need to arrive?</p>
    <form onSubmit={submit}>
      <label>Who’s it for?</label><input name="recipientName" required value={f.recipientName} onChange={e => setF({ ...f, recipientName: e.target.value })} placeholder="Maya" />
      <label>Occasion</label><select name="occasion" value={f.occasion} onChange={e => setF({ ...f, occasion: e.target.value })}>{['Birthday', 'Farewell', 'Graduation', 'Wedding', 'Thank you', 'Just because'].map(o => <option key={o}>{o}</option>)}</select>
      <label>Note for friends (optional)</label><textarea value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder="Maya turns 25 on the 30th" />
      <div className="grid2"><div><label>Needs to arrive by</label><input name="neededBy" type="date" value={f.neededBy} onChange={e => setF({ ...f, neededBy: e.target.value })} /></div>
        <div><label>Days to ship</label><input name="shipBufferDays" type="number" min={0} max={30} value={f.shipBufferDays} onChange={e => setF({ ...f, shipBufferDays: Number(e.target.value) })} /></div></div>
      <p className="ok" style={{ marginTop: 12 }}>Friends can chip in until <b>{buyBy.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</b>. If the gift isn’t funded by then, nobody pays.</p>
      <label>The most you’d put in ($)</label><input name="budget" type="number" min={1} value={f.budget} onChange={e => setF({ ...f, budget: Number(e.target.value) })} />
      {err && <div className="err">{err}</div>}
      <div style={{ marginTop: 20 }}><button type="submit" style={{ width: '100%' }}>Start the gift</button></div></form></div>;
}
