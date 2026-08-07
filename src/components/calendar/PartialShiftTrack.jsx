import { useMemo, useRef } from "react";
import { format } from "date-fns";
import { useOverlappingLabels } from "./useOverlappingLabels";
import { getCoverageColor } from "./whatsappTemplates";

// Compact read-only slider for visualising how a shift's time span is split
// across the original owner, covering users, and any still-uncovered gap —
// the same visual language as the live "פרטי משמרת" track, reused wherever a
// partial shift's state needs to be shown at a glance (e.g. the "אחרי" side
// of a completed/in-progress swap in the history list).
export default function PartialShiftTrack({ bands, windowStart, windowEnd }) {
  const trackRef = useRef(null);
  const { registerLabel, raisedIndices } = useOverlappingLabels(trackRef, [
    bands,
  ]);

  const totalMinutes =
    windowStart && windowEnd
      ? (windowEnd.getTime() - windowStart.getTime()) / 60000
      : 0;

  const toPercent = (date) => {
    if (!windowStart || totalMinutes <= 0 || !date) return 0;
    return Math.max(
      0,
      Math.min(
        100,
        ((date.getTime() - windowStart.getTime()) / 60000 / totalMinutes) *
          100,
      ),
    );
  };

  // Distinct color per covering user, by order of first appearance, so the
  // same person keeps the same color across bands and the legend.
  const coveringColorMap = useMemo(() => {
    const map = new Map();
    bands.forEach((band) => {
      if (band.variant === "covered" && !map.has(band.label)) {
        map.set(band.label, map.size);
      }
    });
    return map;
  }, [bands]);

  if (!windowStart || !windowEnd || totalMinutes <= 0 || !bands.length)
    return null;

  return (
    <div className="relative mx-4 mt-8 mb-4">
      <div ref={trackRef} className="relative h-3 bg-gray-200 rounded-full">
        {bands.map((band, idx) => {
          const right = toPercent(band.start);
          const width = Math.max(0, toPercent(band.end) - right);
          const colors =
            band.variant === "original"
              ? { bg: "bg-blue-200", text: "text-blue-700" }
              : band.variant === "needsHelp"
                ? { bg: "bg-gray-300", text: "text-gray-600" }
                : getCoverageColor(coveringColorMap.get(band.label) ?? 0);
          return (
            <div
              key={idx}
              className={`absolute h-full rounded-full ${colors.bg}`}
              style={{ right: `${right}%`, width: `${width}%` }}
              title={`${band.label}: ${format(band.start, "HH:mm")}–${format(band.end, "HH:mm")}`}
            >
              {width > 8 && (
                <span
                  ref={registerLabel(idx)}
                  className={`absolute right-1/2 translate-x-1/2 text-[10px] font-semibold whitespace-nowrap ${raisedIndices.has(idx) ? "-top-11" : "-top-6"} ${colors.text}`}
                >
                  {band.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}