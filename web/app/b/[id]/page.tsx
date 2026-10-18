'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, $, countdown } from '../../../lib/api';
import { Bloom, Flower, TraitCard } from '../../../components/Art';
import Deck from '../../../components/Deck';
import Questionnaire from '../../../components/Questionnaire';
import PaySheet from '../../../components/PaySheet';
import GiftStrip from '../../../components/GiftStrip';
import ChipInAI from '../../../components/ChipInAI';
import ExplainPay from '../../../components/ExplainPay';
import Concierge from '../../../components/Concierge';
import TopUp from '../../../components/TopUp';

const STAGES = [['collecting', 'Cards'], ['fusing', 'Pick the gift'], ['funding', 'Chip in'], ['purchased', 'Bought'], ['revealed', 'Opened']];
const short = (d: any) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const clean = (t: string) => t.replace(/^\+ /, '');

export default function Room({ params }: { params: { id: string } }) {
  const r = useRouter(); const [s, setS] = useState<any>(null); const [err, setErr] = useState('');
  const load = useCallback(() => api(`/bouquets/${params.id}`).then(setS).catch(e => { if (e.status === 401) r.push(`/login?next=/b/${params.id}`); else setErr(e.message); }), [params.id]);
  const [live, setLive] = useState<{ mode: string; online: string[] }>({ mode: 'connecting', online: [] });
  const [demoMode, setDemoMode] = useState(false); useEffect(() => { api('/health').then(h => setDemoMode(!!h.demo)).catch(() => {}); }, []);
  // Live room: Cloudflare Durable Object over WebSocket when available → SSE fallback → 15 s polling safety net.
  useEffect(() => {
    load(); let closed = false; let es: EventSource | null = null; let ws: WebSocket | null = null; let retry: any = null; let attempt = 0;
    const sse = () => { if (closed || es) return; es = new EventSource(`/api/bouquets/${params.id}/stream`); es.onmessage = () => load(); setLive(l => ({ ...l, mode: 'sse' })); };
    const stopSse = () => { es?.close(); es = null; };
    // WebSocket first; on any drop, cover with SSE and keep retrying the socket with backoff (1s, 2s, 4s … 30s), so one blip isn't SSE forever.
    const connect = (url: string) => {
      if (closed) return; let opened = false;
      try { ws = new WebSocket(url); } catch { sse(); return schedule(url); }
      const failTimer = setTimeout(() => { if (ws && ws.readyState !== WebSocket.OPEN) ws.close(); }, 4000);
      ws.onopen = () => { opened = true; attempt = 0; clearTimeout(failTimer); stopSse(); setLive(l => ({ ...l, mode: 'websocket' })); load(); };
      ws.onmessage = e => { try { const m = JSON.parse(e.data); if (m.online) setLive(l => ({ ...l, online: m.online })); if (m.type !== 'hello' && m.type !== 'presence') load(); } catch { /* ignore */ } };
      ws.onclose = () => { clearTimeout(failTimer); if (closed) return; void opened; sse(); schedule(url); };
    };
    const schedule = (url: string) => { if (closed || retry) return; const ms = Math.min(30000, 1000 * 2 ** attempt++); retry = setTimeout(() => { retry = null; connect(url); }, ms); };
    api(`/bouquets/${params.id}/realtime`).then((rt: any) => {
      if (closed) return; if (!rt?.url || typeof WebSocket === 'undefined') return sse();
      connect(rt.url);
    }).catch(sse);
    const t = setInterval(load, 15000);
    return () => { closed = true; clearTimeout(retry); ws?.close(); es?.close(); clearInterval(t); };
  }, [load, params.id]);
  const act = async (path: string, body?: any, method?: string) => { setErr(''); try { setS(await api(`/bouquets/${params.id}${path}`, { body: body ?? {}, method })); } catch (e: any) { setErr(e.message); } };
  if (!s) return <div className="panel">{err || 'Loading…'}</div>;
  const b = s.bouquet; const idx = STAGES.findIndex(x => x[0] === b.status);
  const invite = b.inviteUrl ?? (typeof window !== 'undefined' && b.inviteToken ? `${location.origin}/join/${b.inviteToken}` : '');
  return <>
    <div className="panel">
      <div className="row"><div className="grow"><h1 data-testid="room-title">{b.recipientName}’s {String(b.occasion).toLowerCase()} gift</h1>
        <div className="muted">{b.note}</div></div>
        <div style={{ textAlign: 'right' }}>{['purchased', 'revealed'].includes(b.status)
          ? <><div className="deadline done" data-testid="countdown">{b.status === 'revealed' ? `✓ Opened by ${b.recipientName}` : '✓ Bought in time'}</div>
            <div className="muted">With {b.shipBufferDays} days left to ship</div></>
          : <><div className="deadline" data-testid="countdown">{b.status === 'expired' ? (b.cancelled ? 'Cancelled · nobody was charged' : 'Time ran out · nobody was charged') : countdown(b.buyByAt, s.now)}</div>
            <div className="muted">Open until {short(b.buyByAt)}</div></>}</div></div>
      <div className={'live' + (demoMode ? ' sronly' : '')} data-testid="live" data-mode={live.mode} title={live.mode === 'connecting' ? 'Connecting…' : 'Updates live'}>
        <span className={'dot ' + live.mode} />{live.mode === 'websocket' ? `Live${live.online.length ? ` · ${live.online.length} here now` : ''}` : live.mode === 'sse' ? 'Live' : 'Connecting…'}</div>
      <div className="stage">{STAGES.map(([k, l], i) => <span key={k} className={i === idx ? 'on' : i < idx ? 'done' : ''}>{i + 1}. {l}</span>)}</div>
      <div className="members">{s.members.map((m: any) => <div className="member" key={m.id}><Flower fb={m.flowerBack} size={28} />{m.displayName}{m.role === 'organizer' && ' ★'}
        {m.networkVerified && <span className="badge soft" title="Phone check passed">✓ phone</span>}{m.hasCard && <span className="chip">✓ card</span>}</div>)}</div>
      {b.isOrganizer && ['collecting', 'fusing', 'funding'].includes(b.status) && <div style={{ marginTop: 16 }}><label>Invite friends with this link</label>
        <div className="copy"><input readOnly value={invite} data-testid="invite-link" /><button className="ghost" onClick={() => navigator.clipboard?.writeText(invite)}>Copy</button></div>
        <button className="ghost sm" style={{ marginTop: 10 }} data-testid="cancel-bouquet" onClick={() => { if (confirm('Cancel this gift? Every hold is released and nobody pays. This can’t be undone.')) act('/cancel'); }}>Cancel gift</button></div>}
      {err && <div className="err" role="alert">{err}</div>}
    </div>
    {b.status === 'collecting' && <Collecting s={s} act={act} setS={setS} />}
    {b.status === 'fusing' && <Deck s={s} setS={setS} act={act} />}
    {b.status === 'fusing' && <Concierge s={s} act={act} />}
    {['funding', 'purchased', 'revealed', 'expired'].includes(b.status) && s.tiers.length > 0 && <Funding s={s} act={act} setS={setS} />}
    {['purchased', 'revealed'].includes(b.status) && <Purchased s={s} />}
    <DemoDrawer s={s} reload={load} />
    {s.cards.length > 0 && b.status !== 'collecting' && <div className="panel"><h2>The cards</h2><div className="cards flipall">{s.cards.map((c: any, i: number) => <div key={c.id} style={{ animationDelay: `${i * 120}ms` }} className="flipin"><TraitCard card={c} /></div>)}</div></div>}
  </>;
}

function Collecting({ s, act, setS }: any) {
  const mine = s.cards.find((c: any) => c.memberId === s.me.id); const [minting, setMinting] = useState(false);
  return <div className="grid2">
    <div className="panel">{!s.me.hasCard || minting ? <Questionnaire s={s} setS={(r: any) => { setMinting(false); setS(r); }} onMint={() => setMinting(true)} />
      : <><h2>Your card</h2><div style={{ maxWidth: 240 }}><TraitCard card={mine} testId="my-card" /></div><p className="muted">Your card is in. Everyone’s cards turn over together when the group is ready.</p></>}</div>
    <div className="panel"><h2>Cards so far ({s.cards.length})</h2><p className="muted">Cards stay face down until everyone’s in, then turn over together.</p>
      <div className="cards">{s.cards.map((c: any) => <div key={c.id}><TraitCard card={c} flipped={c.memberId === s.me.id} /><div className="muted" style={{ textAlign: 'center', marginTop: 6 }}>{c.memberId === s.me.id ? 'You' : c.memberName}</div></div>)}
        {s.cards.length === 0 && <div className="slot waiting" data-testid="cards-empty"><span className="slot-icon">✿</span><b>No cards yet</b><span className="muted">{s.me.hasCard ? 'Waiting for friends…' : 'Yours could be the first.'}</span></div>}</div>
      {(() => { const waiting = s.members.filter((m: any) => m.role !== 'organizer' && !m.hasCard && m.id !== s.me.id).map((m: any) => m.displayName);
        return waiting.length > 0 && <p className="muted" style={{ fontSize: 13, marginTop: 12 }} data-testid="still-writing">Still writing: {waiting.join(', ')}</p>; })()}
      {s.bouquet.isOrganizer && <div style={{ marginTop: 18 }}><button disabled={s.cards.length < 2} onClick={() => act('/fuse')} data-testid="fuse">Turn over the cards</button>
        {s.cards.length < 2 && <p className="muted">You need at least 2 cards.</p>}</div>}
    </div></div>;
}

function Fusing({ s, act }: any) {
  return <div className="panel"><h2>Fusion results</h2>
    <p className="muted">Traits from everyone’s cards fused into these gifts. <span className="chip rare">Rare</span> fusions only appear when 2+ friends independently named the same traits.</p>
    <div className="chips" style={{ margin: '12px 0 18px' }}>{s.traits.map((t: any) => <span key={t.label} className="chip">{t.label} ×{t.consensus}</span>)}</div>
    <div className="cands">{s.candidates.map((c: any) => <div key={c.id} className={`cand ${s.me.vote === c.id ? 'mine' : ''}`} data-testid="candidate">
      <div className="fusion">{c.traits.join(' + ')} {c.rare && <span className="chip rare">Rare find</span>}</div>
      <h3>{c.title}</h3><p className="muted" style={{ margin: 0 }}>{c.description}</p>
      <div className="muted" style={{ fontSize: 13 }}>From the cards of {c.citedFriends.join(', ')}</div>
      <div className="row"><b className="grow">{c.votes} vote{c.votes === 1 ? '' : 's'}</b><button className="sm btn" onClick={() => act('/vote', { candidateId: c.id })} data-testid="vote">{s.me.vote === c.id ? 'Voted ✓' : 'Vote'}</button></div></div>)}</div>
    {s.bouquet.isOrganizer && <div style={{ marginTop: 20 }}><button onClick={() => act('/choose')} data-testid="choose">Pick the top-voted gift →</button></div>}
  </div>;
}

function Funding({ s, act, setS }: any) {
  const b = s.bouquet; const top = s.tiers[s.tiers.length - 1]?.thresholdCents ?? 1; const total = s.totals.fundedCents;
  const pledged = s.me.contributions.filter((c: any) => c.status === 'held').reduce((a: number, c: any) => a + c.amount_cents, 0);
  const room = Math.max(0, s.me.budgetMaxCents - pledged);
  const [amt, setAmt] = useState(20); const [sheet, setSheet] = useState(false); const [err, setErr] = useState(''); const [pop, setPop] = useState<string | null>(null);
  const [bud, setBud] = useState({ min: s.me.budgetMinCents / 100, max: s.me.budgetMaxCents / 100 }); const [claim, setClaim] = useState({ email: '', password: '' });
  const next = s.tiers.find((t: any) => t.id === s.totals.nextTier); const cand = s.candidates.find((c: any) => c.id === b.chosenCandidateId);
  const prevTier = useRef<string | null>(s.totals.currentTier); const prevTotal = useRef<number>(total);
  useEffect(() => { const cur = s.totals.currentTier;
    if (cur && cur !== prevTier.current) { const t = s.tiers.find((x: any) => x.id === cur); setPop(s.totals.blurred ? `Unlocked ${t?.title.replace(/^\+ /, '')} ✿` : `+${$(total - prevTotal.current)} unlocked ${t?.title.replace(/^\+ /, '')} ✿`); setTimeout(() => setPop(null), 5000); }
    prevTier.current = cur; prevTotal.current = total; }, [s.totals.currentTier, total]);
  const petals = s.members.filter((m: any) => m.holding); const co = b.status === 'funding' ? s.totals.checkout : null;
  // One idempotency key per opening of the Visa sheet: a double tap or a network retry can't place two holds.
  const payKey = useRef(''); useEffect(() => { if (sheet) payKey.current = crypto.randomUUID(); }, [sheet]);
  const pay = async (card: string, human: string | null) => { setErr('');
    try { setS(await api(`/bouquets/${b.id}/contributions`, { body: { amountCents: Math.round(amt * 100), cardNumber: card, idempotencyKey: payKey.current || crypto.randomUUID() }, human })); return true; }
    catch (e: any) { setErr(e.message); return true; } };
  // Latch the late card: once shown it stays mounted until the friend finishes or skips, so a realtime refresh
  // (which flips hasCard the moment the card is saved) can't yank the minted-card reveal mid-animation.
  const [late, setLate] = useState<'off' | 'on' | 'done'>('off');
  useEffect(() => { if (late === 'off' && b.status === 'funding' && !s.me.hasCard && s.me.role !== 'organizer') setLate('on'); }, [late, b.status, s.me.hasCard, s.me.role]);
  return <>{late === 'on' && b.status === 'funding' && <LateCard s={s} setS={setS} onDone={() => setLate('done')} />}<div className={b.status === 'funding' ? 'grid2' : 'solo'}>
    {pop && <div className="unlockpop" data-testid="unlock-pop">{pop}</div>}
    <div className="panel" style={{ textAlign: 'center' }}><h2>{cand?.title}</h2>
      {s.tiers.some((t: any) => t.product) && <GiftStrip items={s.tiers.map((t: any) => ({ photoUrl: t.product?.photoUrl, label: t.product?.label ?? t.title.replace(/^\+ /, ''), href: t.product?.url, title: t.product ? `${t.product.name} · ${t.product.store} · ${$(t.product.priceCents)}` : undefined,
        unlocked: t.unlocked, note: t.unlocked ? (b.status === 'funding' ? 'Unlocked' : 'In the box') : b.status === 'funding' ? (s.totals.blurred ? 'Not yet' : `${$(t.thresholdCents - total)} more`) : 'Not included' }))} />}
      <div className="bloomwrap"><Bloom progress={total / top} stems={3 + s.members.length} />
        <div className="petals" data-testid="petals">{petals.map((m: any, i: number) => <div key={m.id} className="petal pop" style={{ animationDelay: `${i * 90}ms` }}><Flower fb={m.flowerBack} size={30} /><span>{m.displayName}</span></div>)}</div></div>
      <div className="bar" style={{ margin: '14px 0 6px' }}><div style={{ width: `${Math.min(100, (total / top) * 100)}%` }} /></div>
      <div data-testid="funded">{b.status === 'funding' && s.totals.blurred ? <span data-testid="funded-private">{s.totals.currentTier ? <><b>{s.tiers.find((t: any) => t.id === s.totals.currentTier)?.level} of {s.tiers.length}</b> unlocked</> : <b>Not unlocked yet</b>} · With two people in, the total stays private.</span> : b.status === 'funding' && total >= top ? <><b>{$(total)}</b> in · fully funded</> : b.status === 'funding' ? <><b>{$(total)}</b> of {$(top)}</> : b.status === 'expired' ? <>{b.cancelled ? 'Cancelled' : 'Time ran out'} · every hold was released, nobody was charged</> : <><b>{$(total)}</b> paid · {s.tiers.find((t: any) => t.id === b.capturedTierId)?.level ?? '–'} of {s.tiers.length} in the box</>}</div>
      {next && b.status === 'funding' && <p className="muted">{s.totals.blurred ? 'Next up:' : `${$(next.thresholdCents - total)} more adds`} <b>{clean(next.title)}</b></p>}
      {co && <div className="goal" data-testid="checkout-preview">{co.releaseCents === null
        ? <><b>Ready to buy.</b> Buying now costs {$(co.chargeCents)}, shared by both of you in proportion to what you put in. Anything extra goes back to your cards.</>
        : <><b>{total >= top ? 'Fully funded.' : 'Ready to buy.'}</b> Buying now costs {$(co.chargeCents)}, shared by {co.holders === 1 ? 'the one person in' : `${co.holders} friends`} in proportion to what each put in.{co.releaseCents > 0 && <> The extra {$(co.releaseCents)} goes back to their cards.</>}</>}</div>}
      {co && <div className="muted" style={{ fontSize: 12, marginTop: 6 }} data-testid="fee-line">Bouquet fee: <b>$0</b> for now. Later: 4% of the final price ({$(Math.round(co.chargeCents * 0.04))} here), shown before anyone pays.</div>}
      <div className="tiers" style={{ marginTop: 14, textAlign: 'left' }}>{s.tiers.map((t: any) => <div key={t.id} className={`tier ${t.unlocked ? 'unlocked' : ''}`} data-testid="tier">
        {t.product ? <img className="tierimg" src={t.product.photoUrl} alt={t.product.name} data-testid="tier-photo" /> : <span className="tierimg ph">🎁</span>}
        <div className="grow"><b>{clean(t.title)}</b>{t.product && <div className="tiermeta"><a href={t.product.url} target="_blank" rel="noreferrer">{t.product.name}</a> · {t.product.store} · {$(t.product.priceCents)}</div>}</div>
        <span className="thr">{$(t.thresholdCents)}</span></div>)}</div>
    </div>
    {b.status === 'funding' && <div className="panel"><h2>Chip in</h2>
      {s.me.isGuest ? <div data-testid="claim">
        <p>Add an email and password so you can change your hold later.</p>
        <label>Email</label><input name="claimEmail" type="email" value={claim.email} onChange={e => setClaim({ ...claim, email: e.target.value })} />
        <label>Password</label><input name="claimPassword" type="password" value={claim.password} onChange={e => setClaim({ ...claim, password: e.target.value })} />
        <div style={{ marginTop: 14 }}><button onClick={async () => { setErr(''); try { await api('/auth/claim', { body: claim }); setS(await api(`/bouquets/${b.id}`)); } catch (e: any) { setErr(e.message); } }} data-testid="claim-save">Save my spot</button></div>
      </div> : <>
        <TopUp s={s} setS={setS} />
        <ChipInAI bid={b.id} onConfirm={async (p: any) => { const r = await api(`/bouquets/${b.id}/budget`, { method: 'PATCH', body: { budgetMinCents: p.softCents, budgetMaxCents: p.capCents, payday: p.payday ?? null, condition: p.condition ? { tierId: p.condition.tierId, baseCents: p.capCents - p.condition.extraCents } : null } });
          setS(r); setBud({ min: p.softCents / 100, max: p.capCents / 100 }); setAmt(p.holdNowCents / 100); setSheet(true); }} />
        <label>My limit ($)</label>
        <div className="row"><input name="budgetMin" type="number" min={0} value={bud.min} onChange={e => setBud({ ...bud, min: Number(e.target.value) })} style={{ width: 110 }} /><span>to</span>
          <input name="budgetMax" type="number" min={1} value={bud.max} onChange={e => setBud({ ...bud, max: Number(e.target.value) })} style={{ width: 110 }} />
          <button className="ghost" onClick={() => act('/budget', { budgetMinCents: Math.round(bud.min * 100), budgetMaxCents: Math.round(bud.max * 100), condition: null }, 'PATCH')} data-testid="save-budget">Save</button></div>
        <p className="muted" style={{ fontSize: 13 }}>Only you see this. You’ve put in {$(pledged)}, {$(room)} to go.</p>
        <label>{pledged > 0 ? 'Add to your hold ($)' : 'Chip in ($)'}</label><input name="amount" type="number" min={1} value={amt} onChange={e => setAmt(Number(e.target.value))} />
        <div style={{ marginTop: 14 }}><button onClick={() => setSheet(true)} data-testid="hold">{pledged > 0 ? `Add ${$(Math.round(amt * 100))} more` : `Chip in ${$(Math.round(amt * 100))}`}</button>
          {pledged > 0 && <button className="ghost sm" style={{ marginLeft: 8 }} data-testid="withdraw" onClick={async () => { if (!confirm(`Take back your ${$(pledged)}? The hold comes off your card and nothing is charged.`)) return; setErr('');
            try { setS(await api(`/bouquets/${b.id}/contributions/withdraw`, { body: {} })); } catch (e: any) { setErr(e.message); } }}>Take my money back</button>}</div>
        {s.me.contributions.length > 0 && <div className="list" style={{ marginTop: 16 }}>{s.me.contributions.map((c: any) => <div className="item" key={c.id}><span>Card •••• {c.card_last4}</span><span>{$(c.amount_cents)} · {({ held: 'on hold', captured: 'paid', released: 'returned', capture_pending: 'paying…', release_pending: 'returning…' } as any)[c.status] ?? c.status}</span></div>)}</div>}
      </>}
      {err && <div className="err toast" role="alert" data-testid="pay-error">{err}</div>}
      {co && co.myHeldCents > 0 && <div className="goal" data-testid="my-share">If it’s bought now, you pay <b>{$(co.myChargeCents)}</b> of your {$(co.myHeldCents)} hold{co.myHeldCents > co.myChargeCents ? <> and {$(co.myHeldCents - co.myChargeCents)} goes back to your card</> : ''}.</div>}
      {!s.me.isGuest && <ExplainPay bid={b.id} />}
      <div className="side" data-testid="whos-in"><h3>Who’s in</h3>
        <div className="muted" style={{ fontSize: 13 }}>{petals.length} of {s.members.length} in · amounts stay private</div>
        <div className="who">{s.members.map((m: any) => <div className="wrow" key={m.id} data-testid="who-row"><Flower fb={m.flowerBack} size={24} /><span className="grow">{m.id === s.me.id ? `${m.displayName} (you)` : m.displayName}{m.role === 'organizer' ? ' ★' : ''}</span>
          <span className={`st ${m.holding ? 'on' : ''}`}>{m.holding ? '✓ in' : 'not yet'}</span></div>)}</div>
        <div className="dl" data-testid="deadline-box"><b>{countdown(b.buyByAt, s.now)}</b> to buy (until {short(b.buyByAt)}). If it isn’t bought by then, every hold comes off and nobody pays.</div></div>
      {b.isOrganizer && <div style={{ marginTop: 22, borderTop: '1px dashed #f3d0df', paddingTop: 18 }}><h3>Ready to buy?</h3>
        <p className="muted">{co ? <>Buying now gets {co.tierLevel} of {s.tiers.length} parts for {$(co.chargeCents)}, shared fairly{co.releaseCents > 0 ? `; the extra ${$(co.releaseCents)} goes back` : ''}.</> : 'You can buy once the first part is fully funded. Everyone pays a fair share, and anything extra goes back to them.'}</p>
        <button disabled={!s.totals.currentTier} onClick={() => act('/lock')} data-testid="checkout">Buy the gift</button></div>}
      {sheet && <PaySheet amountCents={Math.round(amt * 100)} recipient={b.recipientName} onClose={() => setSheet(false)} onPay={pay} />}
    </div>}
  </div></>;
}

function Purchased({ s }: any) {
  const link = s.bouquet.revealToken && typeof window !== 'undefined' ? `${location.origin}/reveal/${s.bouquet.revealToken}` : null;
  const mine = s.me.contributions.filter((c: any) => c.status === 'captured').reduce((a: number, c: any) => a + c.captured_cents, 0);
  return <div className="panel"><h2>Bought <span className="chip" data-testid="sandbox-chip" title="This is a demo. Card holds are simulated.">Demo · no real money moved</span></h2>{(() => { const held = s.me.contributions.reduce((a: number, c: any) => a + c.amount_cents, 0); const tier = s.tiers.find((t: any) => t.id === s.bouquet.capturedTierId);
      if (!held) return <p>You didn’t place a hold, so you paid nothing. The organizer orders the gift.</p>;
      return <p>Your share: <b data-testid="my-charge">{$(mine)}</b>{held > mine ? <>, not {$(held)}. The group got up to “{clean(tier?.title ?? '')}”, so the rest of your hold went back to your card</> : ''}. The organizer orders the gift.</p>; })()}
    <ExplainPay bid={s.bouquet.id} label="What did I pay?" />
    {link && <><label>Send {s.bouquet.recipientName} this link to open the gift</label><div className="copy"><input readOnly value={link} data-testid="reveal-link" /><a className="btn sm" href={link} target="_blank">Preview</a></div></>}</div>;
}

function DemoDrawer({ s, reload }: any) {
  const [demo, setDemo] = useState(false); const [open, setOpen] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  useEffect(() => { api('/health').then(h => setDemo(!!h.demo)).catch(() => {}); }, []);
  if (!demo) return null;
  const run = async (fn: () => Promise<string>) => { try { setMsg({ ok: true, t: await fn() }); } catch (e: any) { setMsg({ ok: false, t: e.message }); } reload(); };
  const b = s.bouquet;
  return <div className="drawer"><button className="ghost fab" onClick={() => setOpen(!open)} data-testid="demo-toggle" aria-label="Demo tools" title="Demo tools" aria-expanded={open}><span aria-hidden="true">🎬</span><span className="fablbl"> Demo tools {open ? '▾' : '▸'}</span></button>
    {open && <div className="panel" style={{ marginTop: 8 }}>
      <div className="row">
        <button className="ghost" disabled={b.status !== 'funding'} onClick={() => run(async () => { await api(`/bouquets/${b.id}/contributions`, { body: { amountCents: 500, cardNumber: '4000 0000 0000 0002', idempotencyKey: crypto.randomUUID() } }); return 'Hold placed'; })} data-testid="demo-decline">Try a declined card</button>
        <button className="ghost" onClick={() => run(async () => { const r = await api('/dev/clock', { body: { bouquetId: b.id, offsetMs: new Date(b.buyByAt).getTime() - Date.now() + 60000 } }); return `Skipped past the deadline. ${r.expired} gift(s) ran out of time and their holds came off.`; })} data-testid="demo-ff">Skip past the deadline</button>
        <button className="ghost" onClick={() => run(async () => { await api('/dev/clock', { body: { bouquetId: b.id, offsetMs: 0 } }); return 'Clock reset to now'; })}>Reset clock</button>
        {s.me.payday && <button className="ghost" data-testid="demo-payday" onClick={() => run(async () => { await api('/dev/clock', { body: { bouquetId: b.id, offsetMs: Math.max(0, new Date(s.me.payday + 'T01:00:00Z').getTime() - Date.now()) } }); return `Jumped to your payday (${s.me.payday}). Any payday top-up is now one tap.`; })}>Jump to my payday</button>}
        <button className="ghost" disabled={b.status !== 'funding'} data-testid="demo-simswap" onClick={() => run(async () => { await api('/dev/simswap', { body: { bouquetId: b.id } });
          try { await api(`/bouquets/${b.id}/contributions`, { body: { amountCents: 6000, cardNumber: '4242424242424242', idempotencyKey: crypto.randomUUID() } }); return 'Hold went through (no phone on file?)'; }
          finally { await api('/dev/simswap', { body: { bouquetId: b.id, on: false } }); } })}>Try a stolen phone number</button>
        {b.isOrganizer && <button className="ghost" data-testid="demo-reset" onClick={() => run(async () => { const r = await api('/dev/reset-demo', { body: {} }); window.location.href = `/b/${r.bouquetId}`; return 'Fresh demo bouquet ready'; })}>Reset demo</button>}
      </div>
      <p className="muted" style={{ fontSize: 13 }}>“Try a stolen phone number” marks your number as recently moved to a new SIM and tries a $60 hold. The phone safety check blocks it, then the mark is cleared.</p>
      {msg && <div className={msg.ok ? 'ok' : 'err'} role="status" data-testid="demo-msg">{msg.ok ? '✓ ' : ''}{msg.t}</div>}</div>}</div>;
}

/** After the money ask: add a card about the recipient (it goes in the reveal). Skippable, and collapsed until tapped. */
function LateCard({ s, setS, onDone }: { s: any; setS: (x: any) => void; onDone: () => void }) {
  const [open, setOpen] = useState(false); const setSkip = (_: boolean) => onDone();
  return <div className="panel latecard" data-testid="late-card">{open ? <Questionnaire s={s} setS={(x: any) => { setS(x); onDone(); }} onMint={() => {}} />
    : <div className="row"><div className="grow"><b>Add a note for {s.bouquet.recipientName}</b> <span className="muted">(30 seconds)</span><div className="muted" style={{ fontSize: 13 }}>A few taps and a memory. {s.bouquet.recipientName} sees it when they open the gift.</div></div>
      <button onClick={() => setOpen(true)} data-testid="late-card-open">Add my card</button><button className="ghost" onClick={() => setSkip(true)} data-testid="late-card-skip">Skip</button></div>}</div>;
}
