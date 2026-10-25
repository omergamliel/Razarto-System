import React, { useMemo } from "react";
import { addDays, format } from "date-fns";
import { planHolidayChunks } from "@/components/calendar/shiftDistributionAlgorithm";

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
const weekKeyOf = (date) => dayKey(addDays(date, -date.getDay()));

// Splits a holiday's days into the same parts the distribution algorithm will
// hand out: chunks of consecutive days (see planHolidayChunks), cut at every
// Sun-Sat week boundary because fairness is booked per week.
function planHolidayParts(days, divisions) {
  const parts = [];
  let segment = [];
  const flush = () => {
    if (segment.length === 0) return;
    let cursor = 0;
    planHolidayChunks(segment.length, divisions).forEach((size) => {
      parts.push(segment.slice(cursor, cursor + size));
      cursor += size;
    });
    segment = [];
  };

  days.forEach((day) => {
    if (segment.length > 0 && weekKeyOf(segment[0]) !== weekKeyOf(day)) flush();
    segment.push(day);
  });
  flush();
  return parts;
}

// Visual preview of a holiday's חלוקות: one cell per shift day, every division
// (one person's share) in its own colour, so changing the number of divisions
// immediately shows how the chag will be split between people.
export default function HolidayDivisionsStrip({
  startDate,
  endDate,
  divisions = 1,
}) {
  const days = useMemo(() => {
    if (!startDate) return [];
    const first = new Date(`${startDate}T00:00:00`);
    const last = new Date(`${(endDate || startDate)}T00:00:00`);
    if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime()) || last < first) {
      return [];
    }
    const list = [];
    for (let day = first; day <= last; day = addDays(day, 1)) list.push(day);
    return list;
  }, [startDate, endDate]);

  if (days.length === 0) return null;

  const parts = planHolidayParts(days, divisions);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1 overflow-x-auto">
        {parts.map((part, partIndex) => (
          <div
            key={dayKey(part[0])}
            className="flex overflow-hidden rounded-lg shadow-sm"
          >
            {part.map((day) => (
              <div
                key={dayKey(day)}
                className={`${DIVISION_COLORS[partIndex % DIVISION_COLORS.length]} px-1.5 py-1 text-center text-[10px] leading-tight text-white`}
              >
                <div className="font-semibold">{WEEKDAY_LETTERS[day.getDay()]}</div>
                <div>{format(day, "d.M")}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <span className="text-[11px] text-gray-500">
        {days.length} ימים · {parts.length} חלקים
      </span>
    </div>
  );
}