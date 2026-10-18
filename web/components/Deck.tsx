'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, $ } from '../lib/api';
import { Flower, FB } from './Art';
import Overlay from './Overlay';

const PAL = [['#f7a1c4', '#ffd6e7'], ['#c3a6ff', '#ece2ff'], ['#ffb38a', '#ffe3d1'], ['#8fd3c1', '#d9f5ec'], ['#f5d06f', '#fff3c9'], ['#9ec5ff', '#e0edff']];
function hash(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
export function traitFlower(label: string): FB { const h = hash(label), p = PAL[h % PAL.length];
  return { petals: 5 + (h % 7), petalColor: p[0], bgColor: p[1], centerColor: ['#f6c34a', '#fff', '#7a4b94', '#e8735a'][(h >> 3) % 4], rotation: h % 360, layers: 1 + ((h >> 5) % 3), petalShape: (h >> 7) % 2 ? 'round' : 'pointed' }; }
const ICON: Record<string, string> = { 'Sunrise Hiker': '⛰️', 'Coffee Snob': '☕', 'Brunch Royalty': '🥐', Maker: '🛠️', 'Film Shooter': '📷', 'Music Head': '🎧', 'Plant Parent': '🪴', Bookworm: '📚', 'Hates Clutter': '✨', 'Cozy Nester': '🧶' };

export function TraitFace({ t, small = false }: { t: any; small?: boolean }) {
  const fb = traitFlower(t.label);
  return <div className={`tface r-${t.rarity}`} style={{ background: `linear-gradient(160deg,#fff 0,${fb.bgColor} 100%)` }}>
    <div className="tface-top"><span className={`rar r-${t.rarity}`}>{t.rarity}</span>{!small && <span className="kept" data-testid="kept-count">♥ {t.keptCount} kept</span>}</div>
    <div className="tart"><Flower fb={fb} size={small ? 56 : 110} /><span className="ticon">{ICON[t.label] ?? '✿'}</span></div>
    <h3>{t.label}</h3>
    {t.consensus > 1 && <span className="lvl" data-testid="level">{t.label.split(' ')[0]} ×{t.consensus} · Lv{t.level ?? t.consensus}</span>}
    {!small && <><div className="chips" style={{ justifyContent: 'center' }}><span className="chip stat">Friends who named it <b>{t.consensus}</b></span><span className="chip stat">Kept <b>{t.keptCount}</b></span></div>
      <div className="muted cite">From {t.friends.join(', ')}’s answers</div></>}
  </div>;
}

/** Art tile for gifts with no catalog product: the traits' own flowers, never a made-up product photo. */
function GiftArt({ traits }: { traits: string[] }) {
  return <div className="prodimg giftart" data-testid="cand-art">{traits.slice(0, 3).map((l, i) => <span key={l} className="giftart-f" style={{ ['--i' as any]: i }}>
    <Flower fb={traitFlower(l)} size={traits.length > 1 ? 92 : 120} /><span className="ticon">{ICON[l] ?? '✿'}</span></span>)}</div>;
}

export default function Deck({ s, setS, act, concierge }: any) {
  const bid = s.bouquet.id;
  const order = useMemo(() => [...s.traits].sort((a: any, b: any) => (hash(s.me.id + a.id) - hash(s.me.id + b.id))), [s.me.id, s.traits.length]);
  const remaining = order.map((o: any) => s.traits.find((t: any) => t.id === o.id)).filter((t: any) => t && t.myPick === null);
  const hand = s.traits.filter((t: any) => t.myPick === 'keep'); const discards = s.traits.filter((t: any) => t.myPick === 'discard');
  const [drawn, setDrawn] = useState<string | null>(null); const [flipped, setFlipped] = useState(false);
  const [dx, setDx] = useState(0); const [fly, setFly] = useState<0 | 1 | -1>(0); const [hist, setHist] = useState<string[]>([]);
  const [sel, setSel] = useState<string[]>([]); const [fusing, setFusing] = useState<any>(null); const [err, setErr] = useState('');
  const start = useRef<number | null>(null);
  const cur = s.traits.find((t: any) => t.id === drawn);
  // Ideas stay face down until the first gift is made (a fusion casts a vote); until then, keeps fill each idea's match bar.
  const revealed = s.candidates.some((c: any) => c.votes > 0);
  const keptLabels = hand.map((t: any) => t.label);
  const byMatch = s.candidates.map((c: any) => ({ c, kept: c.traits.filter((l: string) => keptLabels.includes(l)) })).sort((a: any, b: any) => b.kept.length - a.kept.length);
  const call = async (p: string, method: string, body?: any) => { setErr(''); try { const r = await api(`/bouquets/${bid}${p}`, { method, body }); setS(r); return r; } catch (e: any) { setErr(e.message); } };
  const draw = () => { if (drawn || !remaining.length) return; setDrawn(remaining[0].id); setFlipped(false); setDx(0); setFly(0); setTimeout(() => setFlipped(true), 30); };
  const decide = async (keep: boolean) => { if (!cur || fly) return; setFly(keep ? 1 : -1); const id = cur.id;
    setTimeout(async () => { setHist(h => [...h, id]); const r = await call('/picks', 'POST', { traitId: id, keep }); if (!r) setHist(h => h.filter(x => x !== id)); setDrawn(null); setFly(0); setDx(0); }, 320); };
  const undo = async () => { const last = hist[hist.length - 1]; if (!last) return; await call(`/picks/${last}`, 'DELETE'); setHist(h => h.slice(0, -1)); setSel(x => x.filter(i => i !== last)); };
  const fuse = async (ids: string[]) => { if (ids.length !== 2) return; const a = s.traits.find((t: any) => t.id === ids[0]), b = s.traits.find((t: any) => t.id === ids[1]);
    setFusing({ a, b, cand: null }); const r = await call('/fuse-hand', 'POST', { traitIds: ids });
    if (!r) { setFusing(null); return; } setFusing({ a, b, cand: r.candidates.find((c: any) => c.id === r.fusedCandidateId) }); setSel([]); };
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.key === 'ArrowRight') decide(true); else if (e.key === 'ArrowLeft') decide(false); else if (e.key === ' ' || e.key === 'Enter') { if (!drawn) { e.preventDefault(); draw(); } } else if (e.key.toLowerCase() === 'z') undo(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); });
  const vel = useRef({ x: 0, t: 0, v: 0 });
  const onDown = (e: React.PointerEvent) => { start.current = e.clientX; vel.current = { x: e.clientX, t: e.timeStamp, v: 0 }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); };
  const onMove = (e: React.PointerEvent) => { if (start.current === null) return; const dt = Math.max(1, e.timeStamp - vel.current.t); vel.current = { x: e.clientX, t: e.timeStamp, v: .7 * ((e.clientX - vel.current.x) / dt) + .3 * vel.current.v }; setDx(e.clientX - start.current); };
  const onUp = () => { if (start.current === null) return; start.current = null; const v = vel.current.v; if (dx > 110 || (dx > 30 && v > .6)) decide(true); else if (dx < -110 || (dx < -30 && v < -.6)) decide(false); else setDx(0); }; // a quick flick counts too
  const x = fly ? fly * 700 : dx;

  return <div className="panel deckpanel">
    <div className="row"><div className="grow"><h2>The deck</h2>
      <p className="muted" style={{ margin: 0 }}>Each card is something a friend loves about them. Keep it (swipe right) or pass (swipe left), then put two together to make a gift idea.</p></div>
      <button className="ghost" onClick={undo} disabled={!hist.length} data-testid="undo">↶ Undo</button></div>
    {err && <div className="err" role="alert">{err}</div>}
    <div className="table">
      <div className="pile"><div className="pile-label">Deck · {remaining.length}</div>
        <button className="stack" onClick={draw} disabled={!!drawn || !remaining.length} aria-label="Draw the top card" data-testid="deck">
          {remaining.slice(0, 4).map((t: any, i: number) => <div key={t.id} className="stackcard" style={{ ['--i' as any]: i, ['--r' as any]: `${[-5, 4, -2, 6][i]}deg` }}>
            <div className="minback"><Flower fb={traitFlower(t.label + 'back')} size={70} /></div></div>)}
          {!remaining.length && <div className="empty">All drawn</div>}
        </button></div>
      <div className="playarea">
        {cur ? <div className={`drawn ${flipped ? 'flipped' : ''}`} data-testid="drawn-card" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          style={{ transform: `translate(${x}px, ${fly ? -60 : Math.abs(x) * -.06}px) rotate(${x / (fly ? 9 : 14)}deg)`, transition: start.current !== null ? 'none' : 'transform .34s cubic-bezier(.3,.7,.4,1), opacity .34s', opacity: fly ? 0 : 1 }}>
          <div className="flipinner"><div className="cardface back" style={{ background: '#ffd6e7' }}><div className="backframe"><Flower fb={traitFlower(cur.label + 'back')} size={110} /></div></div>
            <div className="cardface front tfront"><TraitFace t={cur} />
              {dx > 40 && <div className="stamp keep">KEEP</div>}{dx < -40 && <div className="stamp toss">PASS</div>}</div></div>
        </div> : <div className={`slot ${remaining.length ? '' : 'done'}`} data-testid="draw-slot">{remaining.length
          ? <><div className="slot-icon"><span className="slot-card" /></div><b>Draw a card</b><span>Tap the deck<span className="kbdhint"> or press <kbd>Space</kbd></span></span><span className="muted">{remaining.length} trait card{remaining.length === 1 ? '' : 's'} from your friends’ answers</span></>
          : <><div className="slot-icon">✿</div><b>All sorted</b><span>{hand.length >= 2 ? 'Now pick two kept cards to make a gift ↓' : 'Keep at least two cards to make a gift. Undo to rethink.'}</span></>}</div>}
        {cur && <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
          <button className="ghost" onClick={() => decide(false)} data-testid="discard">✕ Pass</button><button onClick={() => decide(true)} data-testid="keep">♥ Keep</button></div>}
      </div>
      <div className="pile"><div className="pile-label">Discard · {discards.length}</div>
        <div className="stack discard" data-testid="discard-pile">{!discards.length && <div className="pile-hint">Swipe left<span className="kbdhint"><br />or press ←</span><br />to discard</div>}{discards.slice(-3).map((t: any, i: number) => <div key={t.id} className="stackcard" style={{ transform: `rotate(${(i - 1) * 9}deg)` }}><div className="mini"><TraitFace t={t} small /></div></div>)}</div></div>
    </div>
    <div className="handwrap"><div className="row"><h3 className="grow">Your hand · {hand.length}</h3>
      <span className="muted">Pick two<span className="kbdhint"> (or drag one onto another)</span> to make a gift</span>
      <button disabled={sel.length !== 2} onClick={() => fuse(sel)} data-testid="fuse-hand">Make a gift ({sel.length}/2)</button></div>
      <div className={`hand ${hand.length ? '' : 'empty'}`} data-testid="hand">{hand.map((t: any, i: number) => { const mid = (hand.length - 1) / 2, on = sel.includes(t.id);
        return <button key={t.id} className={`handcard ${on ? 'sel' : ''}`} data-testid="hand-card" aria-pressed={on} draggable
          onDragStart={e => e.dataTransfer.setData('text/plain', t.id)} onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const o = e.dataTransfer.getData('text/plain'); if (o && o !== t.id) fuse([o, t.id]); }}
          onClick={() => setSel(x => on ? x.filter(i => i !== t.id) : [...x, t.id].slice(-2))}
          style={{ transform: `rotate(${(i - mid) * 6}deg) translateY(${Math.abs(i - mid) * 6 - (on ? 22 : 0)}px)` }}><TraitFace t={t} small /></button>; })}
        {!hand.length && <div className="hand-empty">{[0, 1].map(k => <span key={k} className="ghostcard" />)}<span className="muted">Cards you keep land here. Keep two, then put them together.</span></div>}</div></div>
    {fusing && <Overlay onClick={() => fusing.cand && setFusing(null)} testId="fuse-overlay">
      <div className="fuse-anim">{!fusing.cand ? <><div className="fz l"><TraitFace t={fusing.a} small /></div><div className="spark">✨</div><div className="fz r"><TraitFace t={fusing.b} small /></div></>
        : <div className={`giftcard pop ${fusing.cand.rare ? 'holo' : ''}`} data-testid="fused-gift"><div className={`rar ${fusing.cand.rare ? 'r-legendary' : 'r-common'}`}>{fusing.cand.rare ? 'Rare find' : 'Gift idea'}</div>
          {fusing.cand.product ? <img className="prodimg" src={fusing.cand.product.photoUrl} alt={fusing.cand.product.name} /> : <GiftArt traits={fusing.cand.traits} />}
          <h2>{fusing.cand.title}</h2><p className="muted">{fusing.cand.description}</p><div className="muted cite">{fusing.cand.traits.join(' + ')} · from {fusing.cand.citedFriends.join(', ')}</div>
          <button onClick={() => setFusing(null)} data-testid="fuse-close">Add to the gift ideas →</button></div>}</div></Overlay>}
    {concierge && React.isValidElement(concierge) ? React.cloneElement(concierge as React.ReactElement<any>, { locked: !revealed }) : concierge}
    {!revealed && <><h3 style={{ marginTop: 26 }}>Gift ideas · face down until someone makes a gift</h3>
      <p className="muted" style={{ marginTop: 0 }}>Every card you keep moves the match bar on the idea it fits. Put two kept cards together and the ideas turn over.</p>
      <div className="cands" data-testid="facedown-ideas">{byMatch.map(({ c, kept }: any, i: number) =>
        <div key={c.id} className="cand facedown" data-testid="candidate" data-facedown="1">
          <div className="fdback" aria-hidden><Flower fb={traitFlower(c.id + 'idea')} size={64} /></div>
          <b>Gift idea {i + 1}</b>
          <div className="matchbar" aria-label={`${kept.length} of ${c.traits.length} traits kept`}><div style={{ width: `${(kept.length / Math.max(1, c.traits.length)) * 100}%` }} /></div>
          <small data-testid="match-note">{kept.length ? kept.map((l: string) => `${l} kept`).join(' · ') + ` · +${kept.length}` : 'No match yet'}</small></div>)}</div></>}
    {revealed && <><h3 style={{ marginTop: 26 }}>Gift ideas · vote for your favorite</h3>
    <div className="cands reveal">{[...s.candidates].sort((x: any, y: any) => y.votes - x.votes).map((c: any) =>
      <div key={c.id} className={`cand ${s.me.vote === c.id ? 'mine' : ''} ${c.rare ? 'holo' : ''}`} data-testid="candidate">
        <div className="fusion">{c.traits.join(' + ')} <span className={`chip kind-${c.kind}`} data-testid="kind">{({ rare: 'Rare find', match: 'Good match', safe: 'Safe pick', wildcard: 'Wildcard' } as any)[c.kind] ?? 'Fusion'}</span></div>{c.product ? <img className="prodimg" src={c.product.photoUrl} alt={c.product.name} data-testid="cand-photo" /> : <GiftArt traits={c.traits} />}<h3>{c.title}</h3>{c.products?.length > 0 && <div className="cprice" data-testid="cand-price">{$(c.products[0].priceCents)} to start{c.products.length > 1 ? ` · ${$(c.products.reduce((t: number, p: any) => t + (p?.priceCents ?? 0), 0))} for everything` : ''}</div>}
        {c.product ? <a className="prodlink" href={c.product.url} target="_blank" rel="noreferrer" title={`${c.product.name} on ${c.product.store}`}>{c.product.label ?? c.product.name}{c.products?.length > 1 ? ` + ${c.products.length - 1} more` : ''}</a> : <span className="prodlink none">Group-curated box · no catalog product yet</span>}
        <div className="cited" data-testid="cited">{c.citedCardIds.map((cid: string) => { const k = s.cards.find((x: any) => x.id === cid); return k ? <span key={cid} className="citecard" title={`${k.memberName}: ${k.title}`}>
          <svg className="citeline" viewBox="0 0 20 30" aria-hidden><path d="M10 0 V30" stroke="#e2588f" strokeDasharray="3 3" /></svg>
          <span className="citeface"><Flower fb={s.members.find((m: any) => m.id === k.memberId)?.flowerBack ?? traitFlower(k.title)} size={26} /></span><small>{k.memberName}</small></span> : null; })}</div>
        <p className="muted" style={{ margin: 0 }}>{c.description}</p><div className="muted" style={{ fontSize: 13 }}>From the cards of {c.citedFriends.join(', ')}</div>
        <div className="row"><div className="grow"><b data-testid="votes">{c.votes} vote{c.votes === 1 ? '' : 's'}</b><div className="tally"><div style={{ width: `${(c.votes / Math.max(1, s.members.length)) * 100}%` }} /></div></div><button className="sm btn" onClick={() => act('/vote', { candidateId: c.id })} data-testid="vote">{s.me.vote === c.id ? 'Voted ✓' : 'Vote'}</button></div></div>)}</div></>}
    {s.bouquet.isOrganizer && <div style={{ marginTop: 20 }}><button onClick={() => act('/choose')} disabled={!revealed} title={revealed ? undefined : 'Make the first gift in the deck to turn the ideas over'} data-testid="choose">Go with the top pick →</button>{!revealed && <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>Make the first gift in the deck first</span>}</div>}
  </div>;
}
