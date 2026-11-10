import React from "react";
import { format } from "date-fns";

const WEEKDAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const MONTHS = [
  "ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני",
  "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳",
];

// One day of a holiday group: its date, its weekday and the chag it belongs to.
// `shareIndex` colours the day by the share it landed in.
export default function HolidayDayChip({ dayKey, label, shareCount = 0, shareIndex = -1 }) {
  const date = new Date(`${dayKey}T00:00:00`);
  const weekend = date.getDay() === 5 || date.getDay() === 6;
  const shade = shareIndex < 0 || shareCount <= 1 ? 0 : shareIndex % 4;
  const tones = [
    "bg-slate-50 border-slate-200",
    "bg-sky-50 border-sky-200",
    "bg-emerald-50 border-emerald-200",
    "bg-amber-50 border-amber-200",
  ];
  return (
    <div
      className={`flex flex-col gap-0.5 rounded-lg border px-2 py-1.5 min-w-[86px] ${
        shareCount > 1 ? tones[shade] : tones[0]
      }`}
      title={`${format(date, "dd/MM/yyyy")} · ${label || ""}`}
    >
      <span className="text-[11px] font-semibold text-gray-700 tabular-nums" dir="ltr">
        {date.getDate()} {MONTHS[date.getMonth()]}{" "}
        <span className={weekend ? "font-bold text-gray-900" : "text-gray-400"}>
          {WEEKDAYS[date.getDay()]}
        </span>
      </span>
      <span className="text-[11px] leading-tight text-gray-600">{label || "—"}</span>
    </div>
  );
}