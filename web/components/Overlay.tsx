'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
/** Full-screen modal layer rendered into <body>. Panels use backdrop-filter, which makes them the containing block for
 *  position:fixed children, so an overlay rendered inside a panel would be trapped (and partly off-screen) in that panel.
 *  The dim fades in by animating background-color only, never `opacity`: opacity on this layer would be inherited by the
 *  sheet inside it and wash it out. Sheets animate transform only, so they are fully opaque from the first frame.
 *  While open, the body behind it is scroll-locked (restored on close). */
export default function Overlay({ children, onClick, testId }: { children: React.ReactNode; onClick?: () => void; testId?: string }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => setEl(document.body), []);
  // Lock the page behind the modal so wheel/touch scrolls the sheet, not the room. Pad by the scrollbar width so nothing jumps.
  useEffect(() => { const b = document.body, prev = { overflow: b.style.overflow, pad: b.style.paddingRight };
    const bar = window.innerWidth - document.documentElement.clientWidth;
    b.style.overflow = 'hidden'; if (bar > 0) b.style.paddingRight = `${bar}px`; b.dataset.modalOpen = '1';
    return () => { b.style.overflow = prev.overflow; b.style.paddingRight = prev.pad; delete b.dataset.modalOpen; }; }, []);
  if (!el) return null;
  return createPortal(<div className="fuse-overlay" onClick={onClick} data-testid={testId}>{children}</div>, el);
}
