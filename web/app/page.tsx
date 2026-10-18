import Link from 'next/link';
import HeroGift from '../components/HeroGift';
import LandingBouquet from '../components/LandingBouquet';
const HOW: [string, string, string][] = [
  ['Start a gift', 'Say who it’s for and when it needs to arrive. Share one link with friends.', '#f7a1c4'],
  ['Friends chip in', 'Amounts stay private, and it’s only a hold until the gift is bought.', '#c3a6ff'],
  ['The gift grows', 'More friends, better gift. If it isn’t funded in time, nobody pays.', '#9fd3ae'],
];
const Petal = ({ c }: { c: string }) => <svg viewBox="0 0 40 40" className="lp-petal" aria-hidden><path d="M20 3 C33 10 35 26 20 37 C5 26 7 10 20 3Z" fill={c} /><path d="M20 8 C20 18 20 28 20 34" stroke="#fff" strokeOpacity=".6" strokeWidth="1.5" fill="none" /></svg>;
export default function Home() {
  return <div className="lp">
    <div className="lp-float" aria-hidden>{[0, 1, 2, 3, 4].map(i => <i key={i} data-parallax={(0.08 + i * 0.07).toFixed(2)} style={{ ['--i' as any]: i }} />)}</div>
    <section className="lp-hero">
      <div className="lp-copy">
        <h1 className="lp-title">Chip in on a gift <em>together.</em></h1>
        <p className="lead" data-testid="lead">Each friend fills out a card about the person. The cards pick the gift, and you just say what you can chip in, like “$30, or $40 if we get the Polaroid.” Nobody’s charged unless it’s fully funded.</p>
        <div className="row lp-ctas"><Link className="btn lg" href="/signup" data-testid="cta">Start a gift</Link><Link href="/login" className="ghost btn">Log in</Link></div>
      </div>
      <div className="lp-art">
        <div className="lp-blob" data-parallax="-0.06" />
        <LandingBouquet />
        <div className="lp-tag t1">4 friends in</div>
        <div className="lp-tag t2">✓ Fully funded</div>
      </div>
    </section>
    <section className="lp-how" id="how" data-testid="how">
      {HOW.map(([t, d, c], i) => <div className="lp-step" key={t} data-reveal style={{ ['--d' as any]: `${i * 0.12}s` }}><Petal c={c} /><b>{t}</b><span className="muted">{d}</span></div>)}
    </section>
    <section className="lp-example" data-reveal><HeroGift /></section>
  </div>;
}
