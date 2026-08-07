import { useLayoutEffect, useRef, useState, useCallback } from "react";

/**
 * Measures labels positioned above a horizontal track and determines which
 * ones overlap their neighbour and should be raised to a higher level to
 * avoid collision.
 *
 * @param {React.RefObject<HTMLElement>} containerRef - the track container
 * @param {Array} deps - dependency array (typically the bands array); re-measures when it changes
 * @returns {{ registerLabel: (idx: number) => (el: HTMLElement) => void, raisedIndices: Set<number> }}
 */
export function useOverlappingLabels(containerRef, deps) {
  const labelRefs = useRef(new Map());
  const [raisedIndices, setRaisedIndices] = useState(new Set());

  const registerLabel = useCallback((idx) => (el) => {
    if (el) {
      labelRefs.current.set(idx, el);
    } else {
      labelRefs.current.delete(idx);
    }
  }, []);

  useLayoutEffect(() => {
    const measure = () => {
      const entries = Array.from(labelRefs.current.entries());
      if (entries.length === 0) {
        setRaisedIndices(new Set());
        return;
      }

      const rects = entries
        .map(([idx, el]) => {
          const rect = el.getBoundingClientRect();
          return { idx, left: rect.left, right: rect.right };
        })
        .sort((a, b) => a.left - b.left);

      const raised = new Set();
      let lastRight = -Infinity;
      for (const r of rects) {
        if (r.left < lastRight) {
          raised.add(r.idx);
        } else {
          lastRight = r.right;
        }
      }

      setRaisedIndices(raised);
    };

    measure();

    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { registerLabel, raisedIndices };
}