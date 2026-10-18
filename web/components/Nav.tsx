'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '../lib/api';
export default function Nav() {
  const [u, setU] = useState<any>(null); const path = usePathname(); const r = useRouter();
  useEffect(() => { api('/auth/me').then(x => setU(x.user)).catch(() => setU(null)); }, [path]);
  return <nav className="nav"><Link href="/" className="logo">✿ bouquet</Link><div className="navr">
    {u ? <><Link href="/dashboard">My gifts</Link><Link href="/new">New gift</Link><Link href="/profile" className="hello" data-testid="nav-user">Hi, {u.name}</Link>
      <button className="ghost" onClick={async () => { await api('/auth/logout', { method: 'POST' }); setU(null); r.push('/'); }}>Log out</button></>
      : <><Link href="/#how">How it works</Link><Link href="/login">Log in</Link><Link href="/signup" className="btn sm">Sign up</Link></>}</div></nav>;
}
