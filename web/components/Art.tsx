'use client';
import React from 'react';
export type FB = { petals: number; petalColor: string; bgColor: string; centerColor: string; rotation: number; layers: number; petalShape: string };

export function Flower({ fb, size = 120 }: { fb: FB; size?: number }) {
  const petals = [];
  for (let l = 0; l < fb.layers; l++) {
    const r = 34 - l * 9, n = fb.petals + l * 2;
    for (let i = 0; i < n; i++) {
      const a = (360 / n) * i + fb.rotation + l * 13;
      petals.push(fb.petalShape === 'round'
        ? <ellipse key={`${l}-${i}`} cx="60" cy={60 - r / 1.6} rx={r / 3.2} ry={r / 1.7} fill={fb.petalColor} opacity={0.55 + l * 0.2} transform={`rotate(${a} 60 60)`} />
        : <path key={`${l}-${i}`} d={`M60 60 Q${60 - r / 3} ${60 - r / 1.4} 60 ${60 - r * 1.15} Q${60 + r / 3} ${60 - r / 1.4} 60 60Z`} fill={fb.petalColor} opacity={0.55 + l * 0.2} transform={`rotate(${a} 60 60)`} />);
    }
  }
  return <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden>{petals}<circle cx="60" cy="60" r="9" fill={fb.centerColor} stroke="#fff" strokeWidth="2" /></svg>;
}

export function CardBack({ fb }: { fb: FB }) {
  return <div className="cardface back" style={{ background: `radial-gradient(circle at 50% 45%, #fff 0, ${fb.bgColor} 70%)` }}>
    <div className="backframe"><Flower fb={fb} size={130} /><div className="backlogo">bouquet</div></div></div>;
}

export function TraitCard({ card, flipped = true, onClick, testId, compliments = false }: { card: { title: string; traits: string[]; story?: string; memberName?: string; friend?: string; flowerBack: FB; artUrl?: string | null; stats?: { label: string; count: number }[]; compliments?: string[] }; flipped?: boolean; onClick?: () => void; testId?: string; compliments?: boolean }) {
  const stats = card.stats ?? card.traits.map(l => ({ label: l, count: 1 }));
  return <div className={`flip ${flipped ? 'flipped' : ''}`} onClick={onClick} data-testid={testId}>
    <div className="flipinner">
      <CardBack fb={card.flowerBack} />
      <div className="cardface front">
        <div className="cardtop"><Flower fb={card.flowerBack} size={44} /><span className="from">from {card.memberName ?? card.friend}</span></div>
        {card.artUrl && <img className="cardart" src={card.artUrl} alt="" />}
        <h3>{card.title}</h3>
        {compliments && card.compliments ? <div className="compl">{card.compliments.map(c => <div key={c}>✿ {c}</div>)}</div>
          : <div className="chips" data-testid="stat-chips">{stats.map(t => <span key={t.label} className="chip stat">{t.label} <b>×{t.count}</b></span>)}</div>}
        {card.story && <p className="story">“{card.story}”</p>}
      </div>
    </div>
  </div>;
}

/** Bouquet that blooms as the funded total climbs through the tiers. */
export function Bloom({ progress, stems }: { progress: number; stems: number }) {
  const p = Math.max(0, Math.min(1, progress));
  const colors = ['#f7a1c4', '#c3a6ff', '#ffb38a', '#8fd3c1', '#f5d06f', '#9ec5ff', '#ff8f8f'];
  const n = Math.max(3, Math.min(9, stems));
  return <svg viewBox="0 30 240 190" className="bloom" aria-label={`bloom ${Math.round(p * 100)}%`}>
    {Array.from({ length: n }).map((_, i) => {
      const x = 40 + (160 / (n - 1)) * i, top = 70 + Math.abs(i - (n - 1) / 2) * 12, s = 0.25 + p * 0.85 * (0.8 + ((i * 7) % 5) / 12), c = colors[i % colors.length];
      return <g key={i}>
        <path d={`M120 205 Q${(x + 120) / 2} 150 ${x} ${top}`} stroke="#7fb58b" strokeWidth="3" fill="none" />
        <g transform={`translate(${x} ${top}) scale(${s})`} style={{ transition: 'transform .8s cubic-bezier(.3,1.6,.5,1)' }}>
          {Array.from({ length: 6 }).map((_, k) => <ellipse key={k} cx="0" cy="-14" rx="9" ry="15" fill={c} opacity=".85" transform={`rotate(${k * 60})`} />)}
          <circle r="7" fill="#f6c34a" />
        </g></g>;
    })}
    <path d="M85 185 L120 215 L155 185 Z" fill="#f3d9e4" stroke="#e8b4c8" strokeWidth="2" />
  </svg>;
}

export function Garland({ children }: { children: React.ReactNode }) {
  const leaves = Array.from({ length: 56 });
  return <div className="garland" data-testid="garland">
    <svg className="garland-svg" viewBox="0 0 300 400" preserveAspectRatio="none" aria-hidden>
      {leaves.map((_, i) => { const t = i / leaves.length, per = 2 * (300 + 400);
        let d = t * per, x, y; if (d < 300) { x = d; y = 0; } else if ((d -= 300) < 400) { x = 300; y = d; } else if ((d -= 400) < 300) { x = 300 - d; y = 400; } else { x = 0; y = 400 - (d - 300); }
        const c = ['#f7a1c4', '#ffffff', '#c3a6ff', '#ffb38a'][i % 4];
        return <g key={i} transform={`translate(${x} ${y})`}>
          <ellipse rx="14" ry="6" fill="#8cc79b" transform={`rotate(${i * 47})`} /><ellipse rx="12" ry="5" fill="#6fae7f" transform={`rotate(${i * 47 + 90})`} />
          <circle r="7" fill={c} stroke="#fff" strokeWidth="1.5" /><circle r="2.5" fill="#f6c34a" /></g>; })}
    </svg>
    <div className="garland-inner">{children}</div>
  </div>;
}
