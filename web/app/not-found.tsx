import Link from 'next/link';
export default function NotFound() {
  return <div className="panel narrow" style={{ textAlign: 'center' }} data-testid="not-found">
    <div style={{ fontSize: 64 }}>🥀</div><h1>This flower wandered off</h1>
    <p className="muted">The page you’re looking for doesn’t exist, or the link has wilted.</p>
    <div className="row" style={{ justifyContent: 'center' }}><Link className="btn" href="/">Back home</Link><Link className="ghost btn" href="/dashboard">My bouquets</Link></div></div>;
}
