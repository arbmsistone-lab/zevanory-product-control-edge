import { useLayoutEffect, useRef, useState } from 'react';

// Measured pagination for screens that must never scroll, clip or overlap (owner rule).
// Renders as many items as fit: starting from all of them, it drops one item per layout pass
// while the list overflows its own box or ends below the workspace (<main>). Re-measures when
// the item count changes or the container is resized. Never goes below one item per page.
export function useFit<T extends HTMLElement = HTMLDivElement>(total: number, max = total) {
  const ref = useRef<T | null>(null);
  const start = Math.max(1, Math.min(total, max));
  const [fit, setFit] = useState(start);
  const [epoch, setEpoch] = useState(0);
  const reset = useRef(false);
  useLayoutEffect(() => { if (fit !== start) { reset.current = true; setFit(start); } }, [start, epoch]);
  useLayoutEffect(() => {
    if (reset.current) { reset.current = false; return; }
    const el = ref.current;
    if (!el || fit <= 1) return;
    const main = el.closest('main');
    const ownOverflow = el.scrollHeight > el.clientHeight + 1;
    const last = el.lastElementChild as HTMLElement | null;
    const limit = main ? main.getBoundingClientRect().bottom - parseFloat(getComputedStyle(main).paddingBottom || '0') : Infinity;
    const pastMain = Boolean(last && last.getBoundingClientRect().bottom > limit + 1) || el.getBoundingClientRect().bottom > limit + 1;
    if (ownOverflow || pastMain) setFit(f => Math.max(1, f - 1));
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let last = '';
    const target = el.closest('main') || el;
    const observer = new ResizeObserver(() => {
      const size = target.clientWidth + 'x' + target.clientHeight;
      if (size !== last) { last = size; setEpoch(e => e + 1); }
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  return { ref, fit };
}
