import React from "react";

// Per-group fairness list — the default presentation (הכל and every non-chag
// day type), since ordinary shifts are distributed between group slots.
export default function FairnessGroupList({
  groups = [],
  maxCount = 1,
  emptyText,
}) {
  if (groups.length === 0) {
    return (
      <div className="text-center py-10 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
        <p className="text-gray-500 font-medium">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {groups.map((g) => (
        <div
          key={g.symbol}
          className={`rounded-xl px-3 py-2 border transition-colors ${
            g.isMine
              ? "bg-blue-50 border-blue-300 ring-1 ring-blue-200"
              : "bg-gray-50 border-gray-100"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="font-semibold text-gray-800 text-sm shrink-0">
                {g.label}
              </span>
              {g.members.length > 0 && (
                <span className="text-[11px] text-gray-400 flex items-center gap-1 min-w-0">
                  {g.hasActive && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"
                      title="המשתמש הפעיל (ראשון ברשימה)"
                    />
                  )}
                  <span className="truncate">
                    {g.members.map((m) => m.name).join(" · ")}
                  </span>
                </span>
              )}
            </div>
            <span className="text-sm font-bold text-gray-700 shrink-0">
              {g.count}
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full bg-gradient-to-l from-blue-400 to-indigo-500 rounded-full transition-all"
              style={{ width: `${(g.count / maxCount) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}