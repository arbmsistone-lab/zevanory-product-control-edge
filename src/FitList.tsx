import { useEffect, type ReactNode } from 'react';
import { useFit } from './useFit';

// A list box that tells its parent how many items fit without overflowing it or the workspace.
// The parent slices its items with that number and pages the rest (no scroll, no clipping).
export function FitList({ className, total, max, onFit, children, ariaLabel }: {
  className: string; total: number; max: number; onFit: (fit: number) => void; children: ReactNode; ariaLabel?: string;
}) {
  const { ref, fit } = useFit<HTMLDivElement>(total, max);
  useEffect(() => { onFit(fit); }, [fit]);
  return <div ref={ref} className={className} aria-label={ariaLabel} tabIndex={ariaLabel ? 0 : undefined}>{children}</div>;
}
