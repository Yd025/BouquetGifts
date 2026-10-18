'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
declare global { interface Window { turnstile?: any; onTurnstileLoad?: () => void } }
let siteKeyP: Promise<string | null> | null = null;
export const getSiteKey = () => (siteKeyP ??= api('/health').then(h => h.turnstileSiteKey ?? null).catch(() => null));
/** Cloudflare Turnstile widget. Renders nothing (and reports ready) when the server has no Turnstile keys configured.
 *  `interaction-only`: the widget stays invisible unless Cloudflare actually needs the person to click something. */
export default function Turnstile({ onToken }: { onToken: (t: string | null) => void }) {
  const el = useRef<HTMLDivElement>(null); const [key, setKey] = useState<string | null | undefined>(undefined);
  useEffect(() => { getSiteKey().then(k => { setKey(k); if (!k) onToken(''); }); }, []);
  useEffect(() => {
    if (!key || !el.current) return;
    // Guarded: the container can unmount (e.g. a returning guest is redirected) before the script loads, and a widget must render only once.
    let id: string | undefined; let gone = false;
    const render = () => { const c = el.current; if (gone || !c || !c.isConnected || !window.turnstile || c.childElementCount) return;
      try { id = window.turnstile.render(c, { sitekey: key, appearance: 'interaction-only', callback: (t: string) => onToken(t), 'expired-callback': () => onToken(null) }); } catch (e) { console.warn('turnstile render skipped', e); } };
    const cleanup = () => { gone = true; try { if (id !== undefined) window.turnstile?.remove(id); } catch { /* already gone */ } };
    if (window.turnstile) { render(); return cleanup; }
    if (document.querySelector('script[data-turnstile]')) { window.onTurnstileLoad = render; return cleanup; } {
      window.onTurnstileLoad = render;
      const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad'; s.async = true; s.dataset.turnstile = '1'; document.head.appendChild(s);
    }
    return cleanup;
  }, [key]);
  return key ? <div ref={el} className="turnstile" data-testid="turnstile" /> : null;
}
