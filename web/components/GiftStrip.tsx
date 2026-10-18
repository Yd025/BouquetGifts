// The gift as a whole: one tile per tier product. Unlocked tiles are lit, locked ones are dimmed, so the gift visibly grows as friends chip in.
export type StripItem = { photoUrl?: string | null; label: string; href?: string; title?: string; unlocked: boolean; note: string; price?: string };
export default function GiftStrip({ items, testId = 'gift-strip', layout = 'row' }: { items: StripItem[]; testId?: string; layout?: 'row' | 'col' }) {
  return <div className={`gstrip ${layout}`} style={{ ['--n' as any]: items.length }} data-testid={testId}>
    {items.map((it, i) => <div key={i} className={`gitem ${it.unlocked ? 'lit' : 'locked'}`} data-testid="strip-item" data-unlocked={it.unlocked ? '1' : '0'}>
      {it.photoUrl ? <img src={it.photoUrl} alt={it.label} data-testid="strip-photo" /> : <span className="gph">🎁</span>}
      <div className="gtext"><div className="glabel">{it.href ? <a href={it.href} title={it.title} target="_blank" rel="noreferrer">{it.label}</a> : it.label}</div>
        {it.price && <div className="gprice" data-testid="strip-price">{it.price}</div>}
        <div className="gnote">{it.unlocked ? '✿ ' : '🔒 '}{it.note}</div></div>
    </div>)}
  </div>;
}
