import Link from 'next/link';
import { Bloom, TraitCard } from '../components/Art';
import HeroGift from '../components/HeroGift';
const fb = { petals: 8, petalColor: '#f7a1c4', bgColor: '#ffd6e7', centerColor: '#f6c34a', rotation: 10, layers: 2, petalShape: 'round' };
const HOW = [
  ['Start a gift', 'Say who it’s for and when it needs to arrive. Share one link with friends.'],
  ['Friends chip in', 'Everyone gives what they can. Amounts stay private, and it’s a hold until the gift is bought.'],
  ['The gift grows', 'More friends, better gift. If it isn’t funded in time, nobody pays.'],
];
export default function Home() {
  return <>
    <section className="hero">
      <div>
        <h1>Chip in on a gift together.</h1>
        <p className="lead">Say what you can give. Everyone’s amount stays private, and nobody’s charged unless the gift is fully funded.</p>
        <div className="row"><Link className="btn" href="/signup" data-testid="cta">Start a gift</Link><Link href="/login" className="ghost btn">Log in</Link></div>
      </div>
      <div className="panel" style={{ textAlign: 'center' }}><Bloom progress={0.8} stems={7} />
        <div className="herogift"><div><TraitCard card={{ title: 'The Sunrise Hiker', traits: ['Sunrise Hiker', 'Coffee Snob'], story: 'She made pour-over at the summit.', memberName: 'Jon', flowerBack: fb }} /></div>
          <HeroGift /></div></div>
    </section>
    <section className="steps" id="how" data-testid="how">
      {HOW.map(([t, d]) => <div className="step" key={t}><b>{t}</b><span className="muted">{d}</span></div>)}
    </section>
  </>;
}
