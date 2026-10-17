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
    const render = () => window.turnstile?.render(el.current, { sitekey: key, appearance: 'interaction-only', callback: (t: string) => onToken(t), 'expired-callback': () => onToken(null) });
    if (window.turnstile) render(); else {
      window.onTurnstileLoad = render;
      const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad'; s.async = true; document.head.appendChild(s);
    }
  }, [key]);
  return key ? <div ref={el} className="turnstile" data-testid="turnstile" /> : null;
}
