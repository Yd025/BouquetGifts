'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, countdown } from '../../../lib/api';
import { Flower } from '../../../components/Art';
import Turnstile from '../../../components/Turnstile';
const FB = { petals: 9, petalColor: '#f7a1c4', bgColor: '#ffd6e7', centerColor: '#f6c34a', rotation: 12, layers: 3, petalShape: 'round' };
export default function Join({ params }: { params: { token: string } }) {
  const r = useRouter(); const [inv, setInv] = useState<any>(null); const [me, setMe] = useState<any>(undefined); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false); const [human, setHuman] = useState<string | null>(null);
  const [f, setF] = useState({ displayName: '', phone: '' });
  useEffect(() => { api(`/invite/${params.token}`).then(setInv).catch(e => setErr(e.message)); api('/auth/me').then(x => { setMe(x.user); setF({ displayName: x.user.name, phone: x.user.phone ?? '' }); }).catch(() => setMe(null)); }, []);
  useEffect(() => { if (inv?.alreadyMember) r.push(`/b/${inv.bouquetId}`); }, [inv]);
  const submit = async (e: any) => { e.preventDefault(); setErr(''); setBusy(true);
    try { const s = await api(`/join/${params.token}`, { body: { displayName: f.displayName, phone: f.phone }, human }); r.push(`/b/${s.bouquet.id}`); }
    catch (x: any) { setErr(x.message); } finally { setBusy(false); } };
  if (!inv) return <div className="panel narrow">{err ? <div className="err">{err}</div> : 'Loading…'}</div>;
  if (!open) return <div className="reveal-stage" style={{ paddingTop: 30 }}>
    <h1 style={{ textAlign: 'center' }}>{inv.organizer} dealt you a card</h1>
    <p className="muted">for {inv.recipientName}’s {inv.occasion.toLowerCase()} · {inv.members} friends in · {countdown(inv.buyByAt)}</p>
    <button className="invitecard" onClick={() => setOpen(true)} data-testid="invite-card" aria-label="Tap to open your invitation">
      <div className="minback" style={{ width: 220, height: 308 }}><Flower fb={FB} size={150} /></div><span className="tapme">Tap to flip</span></button>
  </div>;
  return <div className="panel narrow pop" style={{ maxWidth: 520 }}>
    <h1>Join {inv.recipientName}’s bouquet</h1>
    <p className="muted">Just your name and number. No account or app needed. You’ll fill out a card about {inv.recipientName}, and you’ll set your budget later, only if you chip in.</p>
    <form onSubmit={submit}>
      <label>Name on your card</label><input name="displayName" required value={f.displayName} onChange={e => setF({ ...f, displayName: e.target.value })} />
      <label>Mobile number</label><input name="phone" required placeholder="+1 206 555 0101" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
      <p className="tmo"><span className="badge big">T-Mobile</span> Verified silently by the T-Mobile network (CAMARA Number Verify). No codes to type.</p>
      <Turnstile onToken={setHuman} />
      {err && <div className="err">{err}</div>}
      <div style={{ marginTop: 18 }}><button type="submit" disabled={busy || human === null} style={{ width: '100%' }} data-testid="join-submit">Join the bouquet</button></div></form>
    {me === null && <p className="muted" style={{ marginTop: 14, fontSize: 13 }}>Have an account? <Link href={`/login?next=${encodeURIComponent(`/join/${params.token}`)}`}>Log in</Link></p>}
  </div>;
}
