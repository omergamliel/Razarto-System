import React, { useMemo, useRef, useState } from "react";
import { addDays, format } from "date-fns";
import { splitHolidayDays } from "@/lib/holidayDivisions";

// One colour per division (one person's share of the chag); cycles if a holiday
// is divided between more people than there are colours here.
const DIVISION_COLORS = [
  "bg-sky-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-cyan-600",
  "bg-lime-600",
  "bg-fuchsia-500",
  "bg-orange-500",
  "bg-teal-600",
];

const WEEKDAY_LETTERS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];

const dayKey = (date) => format(date, "yyyy-MM-dd");

// The chag, cell by cell: one cell per shift day, every division (one person's
// share) in its own colour, so the split is visible at a glance. The grip
// between two neighbouring shares is draggable — moving it moves the partition,
// which moves a day from one person to the other. Whatever is shown here is
// exactly what the distribution hands out (see planHolidayParts below).
export default function HolidayDivisionsStrip({
  startDate,
  endDate,
  divisions = 1,
  breaks = [],
  onBreaksChange,
}) {
  const days = useMemo(() => {
    if (!startDate) return [];
    const first = new Date(`${startDate}T00:00:00`);
    const last = new Date(`${(endDate || startDate)}T00:00:00`);
    if (
      Number.isNaN(first.getTime()) ||
      Number.isNaN(last.getTime()) ||
      last < first
    ) {
      return [];
    }
    const list = [];
    for (let day = first; day <= last; day = addDays(day, 1)) list.push(day);
    return list;
  }, [startDate, endDate]);

  const cellRefs = useRef({});
  const [dragging, setDragging] = useState(null);

  const keys = useMemo(() => days.map(dayKey), [days]);
  const parts = useMemo(
    () => splitHolidayDays(keys, { divisions, breaks }),
    [keys, divisions, breaks],
  );

  if (days.length === 0) return null;

  const dayByKey = new Map(days.map((day) => [dayKey(day), day]));
  // Every internal boundary is the first day of one share — the day a new
  // division starts on.
  const breakDates = parts.slice(1).map((part) => part[0]);

  // The cell the pointer is over (nearest cell centre, so a drag that runs off
  // the edge still lands on the closest day).
  const keyAtX = (clientX) => {
    let closest = null;
    let distance = Infinity;
    keys.forEach((key) => {
      const el = cellRefs.current[key];
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const current = Math.abs(clientX - (rect.left + rect.right) / 2);
      if (current < distance) {
        distance = current;
        closest = key;
      }
    });
    return closest;
  };

  const moveBoundary = (boundary, key) => {
    const index = keys.indexOf(key);
    if (index < 0) return;
    // Both neighbours keep at least one day, so a share never disappears.
    const lower = keys.indexOf(parts[boundary][0]) + 1;
    const next = parts[boundary + 1];
    const upper = keys.indexOf(next[next.length - 1]);
    const target = keys[Math.min(Math.max(index, lower), upper)];
    const updated = [...breakDates];
    updated[boundary] = target;
    if (updated.join("|") === breakDates.join("|")) return;
    onBreaksChange(updated);
  };

  const startDrag = (boundary) => (event) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(boundary);
  };

  const onDrag = (event) => {
    if (dragging == null) return;
    const key = keyAtX(event.clientX);
    if (key) moveBoundary(dragging, key);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-0.5 overflow-x-auto py-0.5">
        {parts.map((part, partIndex) => (
          <React.Fragment key={part[0]}>
            {partIndex > 0 && (
              <button
                type="button"
                title="גררו כדי להזיז את הגבול בין החלוקות"
                onPointerDown={startDrag(partIndex - 1)}
                onPointerMove={onDrag}
                onPointerUp={() => setDragging(null)}
                onPointerCancel={() => setDragging(null)}
                className={`h-9 w-2.5 shrink-0 cursor-col-resize touch-none rounded-full transition-colors ${
                  dragging === partIndex - 1
                    ? "bg-blue-500"
                    : "bg-gray-300 hover:bg-blue-400"
                }`}
              />
            )}
            <div className="flex overflow-hidden rounded-lg shadow-sm">
              {part.map((key) => {
                const day = dayByKey.get(key);
                return (
                  <div
                    key={key}
                    ref={(el) => {
                      cellRefs.current[key] = el;
                    }}
                    className={`${DIVISION_COLORS[partIndex % DIVISION_COLORS.length]} min-w-[34px] px-1.5 py-1 text-center text-[10px] leading-tight text-white`}
                  >
                    <div className="font-semibold">
                      {WEEKDAY_LETTERS[day.getDay()]}
                    </div>
                    <div>{format(day, "d.M")}</div>
                  </div>
                );
              })}
            </div>
          </React.Fragment>
        ))}
      </div>
      <span className="text-[11px] text-gray-500">
        {days.length} משמרות · {parts.length} חלוקות
      </span>
    </div>
  );
}