import React from "react";
import { personColor } from "./previewModel";

// Colour legend that doubles as a filter: clicking a person dims everyone else
// in the calendar so their year is easy to follow.
export default function DistributionPreviewPeopleBar({
  rows,
  highlight,
  onHighlight,
}) {
  if (rows.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-2.5 flex flex-wrap gap-1.5 items-center">
      <span className="text-[11px] text-gray-400 ml-1">
        לחיצה על שם מדגישה את השנה שלו:
      </span>
      {rows.map((row) => {
        const active = highlight === row.personId;
        return (
          <button
            key={row.personId}
            type="button"
            onClick={() => onHighlight(active ? null : row.personId)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] transition-colors ${
              active
                ? "border-gray-800 bg-gray-800 text-white"
                : "border-gray-200 bg-white text-gray-700 hover:border-blue-300"
            }`}
          >
            <span
              className="w-3 h-3 rounded-full border border-black/20 shrink-0"
              style={{ background: personColor(row.hue) }}
            />
            <span className="font-medium">{row.name}</span>
            <span
              className={`font-mono text-[10px] ${
                active ? "text-white/70" : "text-gray-400"
              }`}
            >
              {row.total}
            </span>
          </button>
        );
      })}
      {highlight != null && (
        <button
          type="button"
          onClick={() => onHighlight(null)}
          className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 mr-auto"
        >
          הצג את כולם
        </button>
      )}
    </div>
  );
}