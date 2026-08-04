import { useEffect } from "react";

// Locks the document body from scrolling while `active` is true, so an open
// modal/menu can scroll independently without the page behind it moving.
// Restores the previous overflow value on cleanup.
export function useScrollLock(active) {
  useEffect(() => {
    if (!active) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [active]);
}