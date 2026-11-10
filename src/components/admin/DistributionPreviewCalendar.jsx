import React from "react";
import {
  MARK_COLORS,
  WEEKDAY_LABELS,
  personColor,
} from "./previewModel";

// One cell of the yearly calendar: the day number, who works it, and a marker
// for a chag day, an unfilled day or a second shift in the same week.
function DayCell({ cell, dimmed }) {
  if (cell.blank) return <span className="aspect-square" />;

  const style = {};
  if (cell.hue != null) style.background = personColor(cell.hue);
  if (cell.category === "holidays") {
    style.boxShadow = `inset 0 0 0 1.5px ${MARK_COLORS.holiday}`;
  }
  if (cell.unfilled) {
    style.border = `1px dashed ${MARK_COLORS.warning}`;
  }

  return (
    <div
      title={cell.title}
      style={style}
      className={`relative aspect-square rounded flex flex-col items-center justify-center overflow-hidden leading-none transition-opacity ${
        dimmed ? "opacity-15" : ""
      }`}
    >
      <span className="text-[8px] text-gray-500">{cell.day}</span>
      <span className="text-[9px] font-bold text-gray-800">{cell.short}</span>
      {cell.overflow && (
        <span
          className="absolute bottom-0 left-0 right-0 h-[3px]"
          style={{ background: MARK_COLORS.warning }}
        />
      )}
    </div>
  );
}

export default function DistributionPreviewCalendar({ months, highlight }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {months.map((month) => (
        <div
          key={month.key}
          className="bg-white rounded-xl border border-gray-100 shadow-sm p-2.5"
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-gray-700">{month.label}</span>
            <span className="text-[10px] text-gray-400">{month.count} משמרות</span>
          </div>
          <div className="grid grid-cols-7 gap-[3px]">
            {WEEKDAY_LABELS.map((label, index) => (
              <span
                key={label}
                className={`text-[9px] text-center ${
                  index >= 5 ? "text-gray-700 font-semibold" : "text-gray-400"
                }`}
              >
                {label}
              </span>
            ))}
            {month.cells.map((cell) => (
              <DayCell
                key={cell.id}
                cell={cell}
                dimmed={highlight != null && cell.owner !== highlight}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}