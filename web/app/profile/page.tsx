'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../lib/api';
export default function Profile() {
  const r = useRouter(); const [u, setU] = useState<any>(null); const [list, setList] = useState<any[]>([]);
  useEffect(() => { api('/auth/me').then(x => setU(x.user)).catch(() => r.push('/login?next=/profile')); api('/bouquets').then(x => setList(x.bouquets)).catch(() => {}); }, []);
  if (!u) return <div className="panel narrow">Loading…</div>;
  const organized = list.filter(b => b.role === 'organizer').length;
  return <div className="panel narrow" style={{ maxWidth: 560 }}>
    <h1 data-testid="profile-title">Your profile</h1>
    <div className="list">
      <div className="item"><span className="muted">Name</span><b>{u.name}</b></div>
      <div className="item"><span className="muted">Email</span><b>{u.email}</b></div>
      <div className="item"><span className="muted">Phone</span><span>{u.phone ? <>{u.phone} {u.phoneVerified && <span className="badge soft">✓ Phone check passed</span>}</> : <span className="muted">Added when you join a gift</span>}</span></div>
      <div className="item"><span className="muted">Gifts</span><span>{list.length} total · {organized} you organized</span></div>
    </div>
    <p className="muted" style={{ fontSize: 13, marginTop: 16 }}>Chipping in places a hold on your card. You’re only charged if the gift is bought, and never more than your share. (Demo: card holds are simulated.)</p>
    <div className="row" style={{ marginTop: 16 }}><Link className="btn" href="/dashboard">My gifts</Link><Link className="ghost btn" href="/new">Start a gift</Link>
      <button className="ghost" onClick={async () => { await api('/auth/logout', { method: 'POST' }); r.push('/'); }}>Log out</button></div>
  </div>;
}
