import { useLayoutEffect, useRef, useState } from 'react';

// Tracks which of a set of absolutely-positioned, horizontally-centered band
// labels actually collide with a neighbor, and returns the subset that
// should be nudged onto a second row. Positions are measured from the real
// rendered DOM (getBoundingClientRect), so a label is only raised when it
// would otherwise visually overlap another one — as opposed to a fixed
// even/odd alternation that raises a label regardless of whether it needs it.
export function useOverlappingLabels(containerRef, deps) {
  const labelElsRef = useRef(new Map());
  const [raisedIndices, setRaisedIndices] = useState(() => new Set());

  const registerLabel = (idx) => (el) => {
    if (el) labelElsRef.current.set(idx, el);
    else labelElsRef.current.delete(idx);
  };

  useLayoutEffect(() => {
    const recompute = () => {
      const entries = Array.from(labelElsRef.current.entries())
        .map(([idx, el]) => ({ idx, rect: el.getBoundingClientRect() }))
        .filter((e) => e.rect.width > 0)
        .sort((a, b) => a.rect.left - b.rect.left);

      const raised = new Set();
      let lastBase = null;
      let lastRaised = null;

      for (const { idx, rect } of entries) {
        const overlapsBase = lastBase && rect.left < lastBase.right;
        if (!overlapsBase) {
          lastBase = rect;
          continue;
        }
        const overlapsRaised = lastRaised && rect.left < lastRaised.right;
        if (!overlapsRaised) {
          raised.add(idx);
          lastRaised = rect;
        } else {
          // Both rows are already occupied by overlapping neighbors — leave
          // it on the base row rather than introducing an unstyled 3rd row.
          lastBase = rect;
        }
      }

      setRaisedIndices((prev) => {
        if (prev.size === raised.size && [...raised].every((i) => prev.has(i))) {
          return prev;
        }
        return raised;
      });
    };

    recompute();

    window.addEventListener('resize', recompute);
    let observer;
    if (containerRef?.current && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(recompute);
      observer.observe(containerRef.current);
    }
    return () => {
      window.removeEventListener('resize', recompute);
      if (observer) observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { registerLabel, raisedIndices };
}
