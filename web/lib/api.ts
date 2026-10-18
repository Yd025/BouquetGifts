export async function api<T = any>(path: string, opts: { method?: string; body?: any; human?: string | null } = {}): Promise<T> {
  const headers: Record<string, string> = opts.body ? { 'content-type': 'application/json' } : {};
  if (opts.human) headers['x-turnstile-token'] = opts.human;
  const r = await fetch('/api' + path, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'include', cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? 'Request failed'), { status: r.status });
  return j;
}
export const $ = (c: number) => '$' + (c / 100).toFixed(c % 100 ? 2 : 0);
export function countdown(iso: string, nowIso?: string) {
  const ms = new Date(iso).getTime() - (nowIso ? new Date(nowIso).getTime() : Date.now());
  if (ms <= 0) return 'Deadline passed';
  const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60;
  return d ? `${d}d ${h}h left` : `${h}h ${m}m left`;
}

export const ICON: Record<string, string> = { 'Sunrise Hiker': '⛰️', 'Coffee Snob': '☕', 'Brunch Royalty': '🥐', Maker: '🛠️', 'Film Shooter': '📷', 'Music Head': '🎧', 'Plant Parent': '🪴', Bookworm: '📚', 'Hates Clutter': '✨', 'Cozy Nester': '🧶', 'Tea Lover': '🍵', 'Home Chef': '🍳', Baker: '🧁', 'Sweet Tooth': '🍫', 'Spice Chaser': '🌶️', 'Stationery Nerd': '✒️', 'Puzzle Solver': '🧩', 'Game Night Host': '🎲', 'Candle Collector': '🕯️', 'Spa Devotee': '🛁', Yogi: '🧘', 'Happy Camper': '🏕️', Globetrotter: '✈️', 'Dog Person': '🐕', 'Cat Person': '🐈', Gardener: '🌻', 'Bird Watcher': '🐦', Mixologist: '🍸', Artist: '🎨', 'Tech Lover': '🔌' };
