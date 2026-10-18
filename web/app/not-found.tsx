import Link from 'next/link';
export default function NotFound() {
  return <div className="panel narrow" style={{ textAlign: 'center' }} data-testid="not-found">
    <div style={{ fontSize: 64 }}>🥀</div><h1>Page not found</h1>
    <p className="muted">This link doesn’t go anywhere. It may be old or mistyped.</p>
    <div className="row" style={{ justifyContent: 'center' }}><Link className="btn" href="/">Back home</Link><Link className="ghost btn" href="/dashboard">My gifts</Link></div></div>;
}
