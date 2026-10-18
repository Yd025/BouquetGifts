'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { api } from '../lib/api';
function Form({ mode }: { mode: 'login' | 'signup' }) {
  const r = useRouter(); const next = useSearchParams().get('next') || '/dashboard';
  const [f, setF] = useState({ name: '', email: '', password: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e: any) => { e.preventDefault(); setErr(''); setBusy(true);
    try { await api(`/auth/${mode}`, { body: f }); r.push(next); r.refresh(); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } };
  return <div className="panel narrow"><h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
    <p className="muted">{mode === 'login' ? 'Log in to see your gifts.' : 'It takes a few seconds.'}</p>
    <form onSubmit={submit}>
      {mode === 'signup' && <><label>Your name</label><input name="name" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></>}
      <label>Email</label><input name="email" type="email" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
      <label>Password</label><input name="password" type="password" required minLength={mode === 'signup' ? 8 : 1} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
      {err && <div className="err" role="alert">{err}</div>}
      <div style={{ marginTop: 20 }}><button type="submit" disabled={busy} style={{ width: '100%' }}>{mode === 'login' ? 'Log in' : 'Sign up'}</button></div>
    </form>
    <p className="muted" style={{ marginTop: 16 }}>{mode === 'login' ? <>New here? <Link href={`/signup?next=${encodeURIComponent(next)}`}>Sign up</Link> · Just looking? Try demo@bouquet.gift / bouquet123</> : <>Have an account? <Link href={`/login?next=${encodeURIComponent(next)}`}>Log in</Link></>}</p>
  </div>;
}
export function AuthForm({ mode }: { mode: 'login' | 'signup' }) { return <Suspense><Form mode={mode} /></Suspense>; }
