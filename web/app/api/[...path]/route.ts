// Runtime proxy: browser -> Next (same origin, cookies work) -> API. API_URL is read at request time,
// so the same image works in Docker (http://api:4000) and locally (http://localhost:4000).
export const dynamic = 'force-dynamic';
const HOP = ['host', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding'];
async function proxy(req: Request, { params }: { params: { path: string[] } }) {
  const base = process.env.API_URL || 'http://localhost:4000';
  const src = new URL(req.url);
  const target = `${base}/api/${params.path.map(encodeURIComponent).join('/')}${src.search}`;
  const headers = new Headers(req.headers); HOP.forEach(h => headers.delete(h));
  try {
    const r = await fetch(target, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer(), redirect: 'manual', cache: 'no-store' });
    const out = new Headers(r.headers); ['content-encoding', 'content-length', 'transfer-encoding', 'connection'].forEach(h => out.delete(h));
    return new Response(r.body, { status: r.status, headers: out });
  } catch (e) {
    console.error('API proxy error', target, e);
    return Response.json({ error: 'The Bouquet API is unreachable' }, { status: 502 });
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };
