'use client';
import ChipInAI from '../../../components/ChipInAI';
import { tokenizeCard } from '../../../lib/tokenize';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, countdown, $ } from '../../../lib/api';
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
  if (inv.gift) return <ChipInFirst inv={inv} token={params.token} me={me} />;
  if (!open) return <div className="reveal-stage" style={{ paddingTop: 30 }}>
    <h1 style={{ textAlign: 'center' }}>{inv.organizer} invited you</h1>
    <p className="muted">for {inv.recipientName}’s {inv.occasion.toLowerCase()} · {inv.members} in so far · {countdown(inv.buyByAt)}</p>
    <button className="invitecard" onClick={() => setOpen(true)} data-testid="invite-card" aria-label="Tap to open your invitation">
      <div className="minback" style={{ width: 220, height: 308 }}><Flower fb={FB} size={150} /></div><span className="tapme">Tap to open</span></button>
  </div>;
  return <div className="panel narrow pop" style={{ maxWidth: 520 }}>
    <h1>Join the gift for {inv.recipientName}</h1>
    <p className="muted">Just your name and number. Then a few quick questions about {inv.recipientName}. You decide what to chip in later.</p>
    <form onSubmit={submit}>
      <label>Your name</label><input name="displayName" required value={f.displayName} onChange={e => setF({ ...f, displayName: e.target.value })} />
      <label>Mobile number</label><input name="phone" required placeholder="+1 206 555 0101" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
      <p className="muted" style={{ fontSize: 13 }}>We only use your number to keep payments safe. No codes to type.</p>
      <Turnstile onToken={setHuman} />
      {err && <div className="err">{err}</div>}
      <div style={{ marginTop: 18 }}><button type="submit" disabled={busy || human === null} style={{ width: '100%' }} data-testid="join-submit">Join</button></div></form>
    {me === null && <p className="muted" style={{ marginTop: 14, fontSize: 13 }}>Have an account? <Link href={`/login?next=${encodeURIComponent(`/join/${params.token}`)}`}>Log in</Link></p>}
  </div>;
}

/** Funding is open: one screen, money first. Gift, price, how many are in, a quick amount, name + number + card, one Visa hold. No account needed. */
function ChipInFirst({ inv, token, me }: { inv: any; token: string; me: any }) {
  const r = useRouter(); const g = inv.gift;
  // Presets start at a fair first share of what gets the gift going, and end at $40.
  const first = Math.min(30, Math.max(10, Math.ceil((g.startCents || 3000) / 300))); const presets = [...new Set([first, Math.round((first + 40) / 2), 40])];
  const [amt, setAmt] = useState(first); const [cap, setCap] = useState(0); const formRef = useRef<HTMLFormElement>(null); const [f, setF] = useState({ displayName: me?.name ?? '', phone: me?.phone ?? '', card: '4242 4242 4242 4242' });
  const [human, setHuman] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { if (me) setF(x => ({ ...x, displayName: x.displayName || me.name, phone: x.phone || (me.phone ?? '') })); }, [me]);
  const by = new Date(inv.buyByAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const cents = Math.round(amt * 100);
  const submit = async (e: any) => { e.preventDefault(); setErr(''); setBusy(true);
    try { const s = await api(`/join/${token}`, { body: { displayName: f.displayName, phone: f.phone, budgetMaxCents: Math.max(cents, cap), hold: { amountCents: cents, ...tokenizeCard(f.card), idempotencyKey: crypto.randomUUID() } }, human });
      r.push(`/b/${s.bouquet.id}?held=${cents}`); }
    catch (x: any) { setErr(x.message); } finally { setBusy(false); } };
  return <div className="panel narrow pop chipfirst" style={{ maxWidth: 520 }} data-testid="chip-first">
    <h1 style={{ marginBottom: 4 }}>Chip in on {inv.recipientName}’s gift</h1>
    <p className="muted" style={{ margin: '0 0 10px' }}>{g.title} · organized by {inv.organizer}</p>
    {g.photoUrl && <img src={g.photoUrl} alt={g.title} className="cf-photo" />}
    <p className="cf-meta" data-testid="cf-meta"><b>{$(g.topCents)}</b> for the whole gift{g.tiers.length > 1 ? ` · ${$(g.startCents)} gets it started` : ''}<br />{g.holders ? <b>{g.holders} {g.holders === 1 ? 'friend has' : 'friends have'} chipped in</b> : <b>Be the first to chip in</b>} · open until {by}</p>
    <ChipInAI endpoint={`/join/${token}/chip-in/understand`} onConfirm={async (p: any) => { setAmt(p.holdNowCents / 100); setCap(p.capCents); setTimeout(() => formRef.current?.querySelector<HTMLInputElement>('input[name=displayName]')?.focus(), 50); }} />
    <form onSubmit={submit} ref={formRef}>
      <label>Or pick an amount</label>
      <div className="cf-amts" role="group" aria-label="Amount">{presets.map(v => <button type="button" key={v} className={amt === v ? 'on' : 'ghost'} onClick={() => setAmt(v)} data-testid={`cf-amt-${v}`}>${v}</button>)}
        <input name="amount" type="number" min={1} inputMode="decimal" aria-label="Other amount" value={amt} onChange={e => setAmt(Math.max(1, Number(e.target.value) || 0))} data-testid="cf-amount" /></div>
      <label>Your name</label><input name="displayName" required autoComplete="name" value={f.displayName} onChange={e => setF({ ...f, displayName: e.target.value })} />
      <label>Mobile number</label><input name="phone" required type="tel" autoComplete="tel" placeholder="+1 206 555 0101" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
      <label>Card <span className="muted" style={{ fontWeight: 400 }}>· Test card (demo)</span></label><input name="card" required inputMode="numeric" autoComplete="cc-number" value={f.card} onChange={e => setF({ ...f, card: e.target.value })} />
      <Turnstile onToken={setHuman} />
      {err && <div className="err" role="alert">{err}</div>}
      <button type="submit" disabled={busy || human === null || cents < 100} className="cf-go" data-testid="cf-hold">{busy ? 'Holding…' : `Chip in ${$(cents)}`}</button>
      <p className="muted cf-fine" data-testid="cf-fine">It’s a hold, not a charge. If the gift is bought by {by}, you pay your share, never more than <b>{$(cents)}</b>, and {inv.organizer} sends it. If not, the hold drops off.</p>
    </form>
    <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>No account needed.</p>
  </div>;
}
