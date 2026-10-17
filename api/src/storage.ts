import fs from 'node:fs/promises';
import path from 'node:path';
/** Card-art storage. Cloudflare R2 via its S3-compatible API when R2_* env is set; local filesystem otherwise. */
export interface Storage { put(key: string, body: Buffer, type: string): Promise<void>; get(key: string): Promise<{ body: Buffer; type: string } | null>; provider: string }
const TYPES: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wav': 'audio/wav' };
export class FsStorage implements Storage {
  provider = 'filesystem';
  constructor(private dir = process.env.STORAGE_DIR ?? path.resolve('data/media')) {}
  private p(key: string) { const f = path.resolve(this.dir, key); if (!f.startsWith(path.resolve(this.dir))) throw new Error('bad key'); return f; }
  async put(key: string, body: Buffer) { const f = this.p(key); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, body); }
  async get(key: string) { try { return { body: await fs.readFile(this.p(key)), type: TYPES[path.extname(key)] ?? 'application/octet-stream' }; } catch { return null; } }
}
export class R2Storage implements Storage {
  provider = 'cloudflare-r2'; private client: any; private bucket = process.env.R2_BUCKET ?? 'bouquet-art';
  constructor(private fallback: Storage = new FsStorage()) {}
  private async c() {
    if (!this.client) { const { S3Client } = await import('@aws-sdk/client-s3');
      this.client = new S3Client({ region: 'auto', endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! } }); }
    return this.client;
  }
  async put(key: string, body: Buffer, type: string) {
    try { const { PutObjectCommand } = await import('@aws-sdk/client-s3'); await (await this.c()).send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: type })); }
    catch (e) { console.warn('R2 put failed, using local fallback', (e as Error).message); await this.fallback.put(key, body, type); }
  }
  async get(key: string) {
    try { const { GetObjectCommand } = await import('@aws-sdk/client-s3'); const r = await (await this.c()).send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return { body: Buffer.from(await r.Body.transformToByteArray()), type: r.ContentType ?? 'application/octet-stream' }; }
    catch { return this.fallback.get(key); }
  }
}
export const makeStorage = (): Storage => process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID ? new R2Storage() : new FsStorage();

/** Server-rendered SVG card art (shown instantly, and kept when Gemini image generation is off or fails). */
export function cardSvg(fb: any, title: string, traits: string[]) {
  const petals: string[] = [];
  for (let l = 0; l < fb.layers; l++) { const r = 70 - l * 18, n = fb.petals + l * 2;
    for (let i = 0; i < n; i++) petals.push(`<ellipse cx="150" cy="${150 - r / 1.6}" rx="${r / 3.2}" ry="${r / 1.7}" fill="${fb.petalColor}" opacity="${0.55 + l * 0.2}" transform="rotate(${(360 / n) * i + fb.rotation + l * 13} 150 150)"/>`); }
  const esc = (x: string) => x.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));
  const stars = Array.from({ length: 14 }, (_, i) => `<circle cx="${(i * 67 + fb.rotation) % 300}" cy="${(i * 41 + fb.petals * 13) % 200}" r="${1 + (i % 3)}" fill="#fff" opacity=".8"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><radialGradient id="g" cx="50%" cy="40%"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="${fb.bgColor}"/></radialGradient>
<linearGradient id="h" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${fb.petalColor}" stop-opacity=".35"/><stop offset="1" stop-color="#c3a6ff" stop-opacity=".35"/></linearGradient></defs>
<rect width="300" height="300" fill="url(#g)"/><path d="M0 230 Q75 190 150 225 T300 215 V300 H0Z" fill="url(#h)"/>${stars}${petals.join('')}<circle cx="150" cy="150" r="16" fill="${fb.centerColor}" stroke="#fff" stroke-width="4"/>
<text x="150" y="282" text-anchor="middle" font-family="Georgia,serif" font-size="15" fill="#3b2a3f">${esc(traits.join(' · '))}</text><title>${esc(title)}</title></svg>`;
}
