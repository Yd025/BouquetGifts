/**
 * Bouquet live room: one Durable Object per bouquet fans out votes, funding and reveal events over WebSocket.
 *  GET  /room/:id/ws?ticket=…   browser joins (ticket = HMAC-signed by the API, 2-minute expiry)
 *  POST /room/:id/publish       API publishes an event (header x-realtime-secret)
 *  GET  /health
 * Uses the WebSocket Hibernation API so idle rooms cost nothing.
 */
export interface Env { ROOMS: DurableObjectNamespace; REALTIME_SECRET: string }

const enc = new TextEncoder();
const b64u = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

export async function verifyTicket(ticket: string, secret: string, bouquetId: string, now = Date.now()) {
  const [body, sig] = ticket.split('.'); if (!body || !sig) return null;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  if (!(await crypto.subtle.verify('HMAC', key, unb64u(sig), enc.encode(body)))) return null;
  const claims = JSON.parse(new TextDecoder().decode(unb64u(body))) as { b: string; m: string; n: string; exp: number };
  if (claims.b !== bouquetId || claims.exp < now) return null;
  return claims;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/health') return Response.json({ ok: true, service: 'bouquet-realtime' });
    const m = url.pathname.match(/^\/room\/([\w-]+)\/(ws|publish)$/);
    if (!m) return new Response('Not found', { status: 404 });
    const [, id, action] = m;
    if (action === 'publish') {
      if (req.method !== 'POST' || req.headers.get('x-realtime-secret') !== env.REALTIME_SECRET) return new Response('Forbidden', { status: 403 });
    } else {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      const claims = await verifyTicket(url.searchParams.get('ticket') ?? '', env.REALTIME_SECRET, id);
      if (!claims) return new Response('Invalid ticket', { status: 401 });
      url.searchParams.set('member', claims.m); url.searchParams.set('name', claims.n);
    }
    return env.ROOMS.get(env.ROOMS.idFromName(id)).fetch(new Request(url.toString(), req));
  },
};

export class BouquetRoom {
  constructor(private state: DurableObjectState, private env: Env) {}
  private broadcast(msg: unknown) {
    const data = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) { try { ws.send(data); } catch { /* closed */ } }
  }
  private presence() { return this.state.getWebSockets().map(ws => (ws.deserializeAttachment() as any)?.name).filter(Boolean); }
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.endsWith('/publish')) {
      const event = await req.json(); this.broadcast({ ...(event as object), via: 'durable-object' });
      return Response.json({ delivered: this.state.getWebSockets().length });
    }
    const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ member: url.searchParams.get('member'), name: url.searchParams.get('name') });
    server.send(JSON.stringify({ type: 'hello', online: this.presence() }));
    this.broadcast({ type: 'presence', online: this.presence() });
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) { if (msg === 'ping') ws.send('pong'); }
  async webSocketClose(ws: WebSocket) { ws.close(); this.broadcast({ type: 'presence', online: this.presence() }); }
}
