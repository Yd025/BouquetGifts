import Link from 'next/link';
import { Bloom, TraitCard } from '../components/Art';
import HeroGift from '../components/HeroGift';
const fb = { petals: 8, petalColor: '#f7a1c4', bgColor: '#ffd6e7', centerColor: '#f6c34a', rotation: 10, layers: 2, petalShape: 'round' };
export default function Home() {
  return <>
    <section className="hero">
      <div>
        <h1>Gifts grown by everyone who loves them.</h1>
        <p className="lead">Group gifts are broken: one person guesses, fronts the money, and chases Venmo for weeks. <b>Bouquet</b> turns what friends know into the gift itself —
          each friend fills out a card, the cards fuse into the perfect present, everyone holds their own budget on their Visa, and the gift <i>blooms</i> bigger with every friend who joins.</p>
        <div className="row"><Link className="btn" href="/signup" data-testid="cta">Start a bouquet</Link><Link href="/login" className="ghost btn">I have an account</Link></div>
      </div>
      <div className="panel" style={{ textAlign: 'center' }}><Bloom progress={0.8} stems={7} />
        <div className="herogift"><div><TraitCard card={{ title: 'The Sunrise Hiker', traits: ['Sunrise Hiker', 'Coffee Snob'], story: 'She made pour-over at the summit.', memberName: 'Jon', flowerBack: fb }} /></div>
          <HeroGift /></div></div>
    </section>
    <section className="ba" data-testid="before-after">
      <div className="panel before"><h3>Before 😩</h3><ul><li>One friend guesses the gift alone</li><li>They front $200 on their own card</li><li>Weeks of “did you Venmo me?”</li><li>Everyone else’s knowledge goes unused</li></ul></div>
      <div className="panel after"><h3>With Bouquet ✿</h3><ul><li>Every friend fills out a card. The group’s knowledge picks the gift</li><li>Everyone holds only what <i>they</i> choose to give</li><li>Charged only if the gift is fully funded before the deadline</li><li>The recipient opens a pack of memories, plus the gift</li></ul></div>
    </section>
    <section className="steps" id="how">
      {[['Plant', 'Create a bouquet with a buy-by deadline that leaves time for shipping.'], ['Invite', 'Friends join by link + phone, verified by the T-Mobile network.'], ['Card', 'Each friend answers a questionnaire card — shared and random questions.'],
        ['Fuse', 'Traits fuse into gift ideas. Rare fusions need 2+ friends to agree.'], ['Bloom', 'Everyone holds their own budget. Charged only at the highest fully funded tier.']]
        .map(([t, d], i) => <div className="step" key={t}><b>{i + 1}. {t}</b><span className="muted">{d}</span></div>)}
    </section>
  </>;
}
