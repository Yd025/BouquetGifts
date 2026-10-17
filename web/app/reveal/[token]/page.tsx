'use client';
import { useEffect, useRef, useState } from 'react';
import { api, ICON } from '../../../lib/api';
import { TraitCard, Garland, Flower } from '../../../components/Art';
import Turnstile from '../../../components/Turnstile';
const PACK = { petals: 10, petalColor: '#f7a1c4', bgColor: '#ffd6e7', centerColor: '#f6c34a', rotation: 0, layers: 3, petalShape: 'round' };
function speak(t: string) { if (typeof window !== 'undefined' && 'speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(t); u.rate = 0.95; speechSynthesis.cancel(); speechSynthesis.speak(u); } }
function Confetti() {
  const c = ['#f7a1c4', '#c3a6ff', '#f6c34a', '#8fd3c1', '#ffb38a', '#9ec5ff'];
  return <div className="confetti" aria-hidden data-testid="confetti">{Array.from({ length: 70 }).map((_, i) =>
    <i key={i} style={{ left: `${(i * 37) % 100}%`, background: c[i % c.length], animationDelay: `${(i % 14) * 0.08}s`, animationDuration: `${2.4 + (i % 5) * 0.35}s`, transform: `rotate(${i * 29}deg)` }} />)}</div>;
}
export default function Reveal({ params }: { params: { token: string } }) {
  const [p, setP] = useState<any>(null); const [i, setI] = useState(-1); const [err, setErr] = useState(''); const [tearing, setTearing] = useState(false);
  const [human, setHuman] = useState<string | null>(null); const startX = useRef<number | null>(null); const [voice, setVoice] = useState(true);
  useEffect(() => { api(`/reveal/${params.token}`).then(setP).catch(e => setErr(e.message)); }, []);
  if (!p) return <div className="panel narrow">{err || 'Loading…'}</div>;
  const n = p.cards.length; const done = i >= n;
  const go = async (k: number) => {
    if (k === 0) { try { await api(`/reveal/${params.token}/flip`, { body: { index: 0 }, human }); } catch (e: any) { setErr(e.message); return; } }
    else api(`/reveal/${params.token}/flip`, { body: { index: k } }).catch(() => {});
    setI(k); const c = p.cards[k];
    if (voice) { if (c) speak(`From ${c.friend}. ${c.story ?? c.compliments?.[0] ?? c.title}`); else if (k === n) speak(`And your gift: ${p.gift.title}. From ${p.from.join(', ')}. Happy ${p.occasion.toLowerCase()}!`); }
  };
  const open = () => { setTearing(true); setTimeout(() => go(0), 900); };
  const next = () => { if (i < n) go(i + 1); };
  const sx = (e: React.PointerEvent) => { startX.current = e.clientX; };
  const ex = (e: React.PointerEvent) => { if (startX.current !== null && Math.abs(e.clientX - startX.current) > 60) next(); startX.current = null; };
  return <div className="reveal-stage">
    <h1 style={{ textAlign: 'center' }}>{p.recipientName}, your bouquet has arrived</h1>
    <p className="muted">From {p.from.join(', ')} · {p.occasion} <button className="ghost sm" onClick={() => setVoice(!voice)} aria-pressed={voice}>{voice ? '🔊 Voice on' : '🔇 Voice off'}</button></p>
    <div className="dots">{Array.from({ length: n + 1 }).map((_, k) => <i key={k} className={k <= i ? 'on' : ''} />)}</div>
    {i === -1 && <>
      <button className={`bigpack ${tearing ? 'tear' : ''}`} onClick={open} data-testid="pack" disabled={tearing || human === null} aria-label="Tear open your pack">
        <div className="tearstrip"><span>✂ tear here</span></div>
        <div className="packface"><Flower fb={PACK} size={170} /><h2>bouquet</h2><p>{n} cards from friends · 1 legendary gift</p></div></button>
      <Turnstile onToken={setHuman} />{err && <div className="err">{err}</div>}</>}
    {i >= 0 && i < n && <div className="reveal-card" key={i} onPointerDown={sx} onPointerUp={ex} style={{ touchAction: 'pan-y' }}>
      <div className="dealin"><TraitCard card={p.cards[i]} flipped testId="reveal-card" compliments /></div></div>}
    {done && <div className="pop" data-testid="final-gift"><Confetti /><Garland>
      <div className="legend holo" data-testid="legendary">
        <div className="rar r-legendary" style={{ display: 'inline-block' }}>Legendary{p.gift.rare ? ' · rare fusion' : ''}</div>
        {p.gift.product ? <img className="revealimg" src={p.gift.product.photoUrl} alt={p.gift.product.name} data-testid="reveal-photo" />
          : <div className="product" aria-label="gift illustration">{p.gift.traits.map((t: string) => <span key={t}>{ICON[t] ?? '🎁'}</span>)}<span>🎁</span></div>}
        <h2 style={{ marginTop: 6 }}>{p.gift.title}</h2><p className="muted">{p.gift.description}</p>
        {p.gift.products?.length ? <div className="incl">{p.gift.products.map((x: any) => <a key={x.url} href={x.url} target="_blank" rel="noreferrer"><img src={x.photoUrl} alt="" /><span>{x.label ?? x.name}<small>{x.store}</small></span></a>)}</div>
          : <ul style={{ textAlign: 'left' }}>{p.gift.includes.map((x: string) => <li key={x}>{x.replace(/^\+ /, '')}</li>)}</ul>}
        <div className="compl">{p.gift.compliments.map((c: string) => <div key={c}>✿ {c}</div>)}</div>
        <p className="muted" style={{ fontSize: 13 }}>Chosen by {p.from.join(', ')}.</p>
        <div className="chip">Tracking {p.gift.tracking}</div></div></Garland></div>}
    {!done && i >= 0 && <button onClick={next} data-testid="next-card">{i === n - 1 ? 'Reveal the gift ✿' : 'Next card →'}</button>}
    {!done && i >= 0 && <p className="muted" style={{ fontSize: 12 }}>Tap, or swipe the card</p>}
  </div>;
}
