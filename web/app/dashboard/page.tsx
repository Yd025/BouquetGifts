'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, countdown } from '../../lib/api';
export default function Dash() {
  const [list, setList] = useState<any[] | null>(null); const r = useRouter();
  useEffect(() => { api('/bouquets').then(x => setList(x.bouquets)).catch(() => r.push('/login?next=/dashboard')); }, []);
  return <div className="panel"><div className="row"><h1 className="grow">My bouquets</h1><Link className="btn" href="/new" data-testid="new-bouquet">+ New bouquet</Link></div>
    {list && !list.length && <p className="muted">No bouquets yet. Plant your first one for someone you love.</p>}
    <div className="list">{list?.map(b => <Link key={b.id} href={`/b/${b.id}`} className="item"><div className="row">{b.photoUrl ? <img className="dashimg" src={b.photoUrl} alt={b.product?.name ?? ''} data-testid="dash-photo" /> : <span className="dashimg ph">✿</span>}
      <div><b>{b.recipientName}</b> · {b.occasion}<div className="muted">{b.gift ? `${b.gift} · ` : ''}{b.members} friends · {b.role}</div></div></div>
      <div style={{ textAlign: 'right' }}><span className="chip">{b.status}</span><div className="muted">{countdown(b.buyByAt)}</div></div></Link>)}</div></div>;
}
