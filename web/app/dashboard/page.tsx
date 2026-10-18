'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, countdown } from '../../lib/api';
const LABEL: Record<string, string> = { collecting: 'Filling out cards', fusing: 'Picking the gift', funding: 'Chipping in', purchased: 'Purchased', revealed: 'Opened', expired: 'Expired · holds released' };
const label = (b: any) => b.cancelled ? 'Cancelled · holds released' : LABEL[b.status] ?? b.status;
export default function Dash() {
  const [list, setList] = useState<any[] | null>(null); const r = useRouter();
  useEffect(() => { api('/bouquets').then(x => setList(x.bouquets)).catch(() => r.push('/login?next=/dashboard')); }, []);
  return <div className="panel"><div className="row"><h1 className="grow">My bouquets</h1><Link className="btn" href="/new" data-testid="new-bouquet">+ New bouquet</Link></div>
    {list && !list.length && <p className="muted">No bouquets yet. Plant your first one for someone you love.</p>}
    <div className="list">{list?.map(b => <Link key={b.id} href={`/b/${b.id}`} className="item"><div className="row">{b.photoUrl ? <img className="dashimg" src={b.photoUrl} alt={b.product?.name ?? ''} data-testid="dash-photo" /> : <span className="dashimg ph">✿</span>}
      <div><b>{b.recipientName}</b> · {b.occasion}<div className="muted">{b.gift ? `${b.gift} · ` : ''}{b.members} {b.members === 1 ? 'person' : 'people'} · {b.role === 'organizer' ? 'you organize' : 'friend'}</div></div></div>
      <div style={{ textAlign: 'right' }}><span className="chip" data-testid="dash-status">{label(b)}</span>{['collecting', 'fusing', 'funding'].includes(b.status) && <div className="muted">{countdown(b.buyByAt)}</div>}</div></Link>)}</div></div>;
}
