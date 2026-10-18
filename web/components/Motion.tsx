'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

const PETALS = ['#f7a1c4', '#e2588f', '#c3a6ff', '#f6c34a', '#9fd3ae'];
const calm = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** One global layer for tap feedback, scroll reveals and parallax. Pure CSS animations; nothing runs when reduced motion is on. */
export default function Motion() {
  const path = usePathname();
  useEffect(() => {
    let layer = document.getElementById('fx-layer');
    if (!layer) { layer = document.createElement('div'); layer.id = 'fx-layer'; layer.setAttribute('aria-hidden', 'true'); document.body.appendChild(layer); }
    const fx = layer;
    const spawn = (cls: string, x: number, y: number, style: Record<string, string> = {}) => {
      const el = document.createElement('i'); el.className = cls; el.style.left = x + 'px'; el.style.top = y + 'px';
      for (const k in style) el.style.setProperty(k, style[k]);
      fx.appendChild(el); setTimeout(() => el.remove(), 900);
    };
    const onDown = (e: PointerEvent) => {
      if (calm() || navigator.webdriver) return; // no tap effects in automated runs (keeps screenshots clean)
      const t = (e.target as HTMLElement)?.closest?.('button, .btn') as HTMLElement | null;
      if (!t || (t as HTMLButtonElement).disabled || t.closest('[data-nofx]')) return;
      const primary = !t.classList.contains('ghost') && !t.classList.contains('opt') && !t.classList.contains('stack') && !t.classList.contains('link');
      if (primary) {
        for (let i = 0; i < 9; i++) {
          const a = (Math.PI * 2 * i) / 9 + Math.random() * .5, d = 34 + Math.random() * 30;
          spawn('fx-petal', e.clientX, e.clientY, { '--dx': `${Math.cos(a) * d}px`, '--dy': `${Math.sin(a) * d - 10}px`, '--r': `${Math.random() * 360}deg`, '--c': PETALS[i % PETALS.length] });
        }
      } else {
        const r = t.getBoundingClientRect();
        spawn('fx-ripple', e.clientX, e.clientY, { '--s': `${Math.max(r.width, r.height) * 1.6}px` });
      }
    };
    document.addEventListener('pointerdown', onDown, { passive: true });
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (calm() || !('IntersectionObserver' in window)) { els.forEach(el => el.classList.add('in')); return; }
    const io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { threshold: .15 });
    els.forEach(el => io.observe(el));
    const par = Array.from(document.querySelectorAll<HTMLElement>('[data-parallax]'));
    let raf = 0;
    const onScroll = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; const y = window.scrollY; par.forEach(el => el.style.setProperty('--py', `${(y * Number(el.dataset.parallax || .2)).toFixed(1)}px`)); }); };
    if (par.length && !calm()) { window.addEventListener('scroll', onScroll, { passive: true }); onScroll(); }
    return () => { io.disconnect(); window.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [path]);
  return null;
}

/** Counts money up from the last shown value. Shows the final value immediately when motion is reduced. */
export function useCountUp(target: number, ms = 700) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (calm() || from.current === target) { from.current = target; setV(target); return; }
    const a = from.current, t0 = performance.now(); let raf = 0;
    const step = (t: number) => { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3); setV(Math.round(a + (target - a) * e)); if (k < 1) raf = requestAnimationFrame(step); else from.current = target; };
    raf = requestAnimationFrame(step); return () => { cancelAnimationFrame(raf); from.current = target; };
  }, [target, ms]);
  return v;
}
