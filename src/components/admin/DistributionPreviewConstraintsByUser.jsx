import React, { useMemo, useState } from "react";
import { differenceInCalendarDays } from "date-fns";
import { Loader2, Trash2, Users } from "lucide-react";
import { useConsiderationMaxDates } from "@/hooks/useAuthorizedPerson";

/**
 * The constraints (אילוצים) behind a distribution run, shown the way a manager
 * sees "אילוצים של משתמשים אחרים": one card per user + month, the dates
 * collapsed into ranges, an amber mark when that month crossed the monthly
 * threshold, and the most constrained users first. Removing a range takes it out
 * of THIS run only — the requests themselves are never deleted here.
 */

const fmtHe = (iso) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").slice(0, 10));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(iso || "");
};

const monthKeyOf = (dateStr) => String(dateStr || "").slice(0, 7);
const fmtMonth = (key) => `${String(key).slice(5, 7)}/${String(key).slice(0, 4)}`;

const dayGap = (a, b) => {
  const from = new Date(`${a}T00:00:00`);
  const to = new Date(`${b}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return Infinity;
  return differenceInCalendarDays(to, from);
};

// Consecutive calendar days collapse into one range, so a manager reads
// "05/03 – 08/03 (4 ימים)" and removes the run in one action.
const collapseRanges = (rows) => {
  const sorted = [...rows].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const ranges = [];
  sorted.forEach((row) => {
    const last = ranges[ranges.length - 1];
    if (last && dayGap(last.endDate, row.date) === 1) {
      last.endDate = row.date;
      last.rows.push(row);
    } else {
      ranges.push({ startDate: row.date, endDate: row.date, rows: [row] });
    }
  });
  return ranges;
};

const SORT_MODES = [
  { key: "count", label: "לפי מספר אילוצים" },
  { key: "user", label: "לפי משתמש" },
  { key: "date", label: "לפי תאריך" },
];

export default function DistributionPreviewConstraintsByUser({
  constraints = [],
  ignored = [],
  onDelete,
  deletingId,
  isRunning,
}) {
  const monthlyThreshold = useConsiderationMaxDates();
  const [sortMode, setSortMode] = useState("count");

  const groups = useMemo(() => {
    const byUserMonth = new Map();
    const add = (item, isIgnored) => {
      if (!item?.date || item.serial_id == null) return;
      const key = `${item.serial_id}|${monthKeyOf(item.date)}`;
      if (!byUserMonth.has(key)) {
        byUserMonth.set(key, {
          serial_id: item.serial_id,
          user_name: item.user_name || `#${item.serial_id}`,
          month: monthKeyOf(item.date),
          rows: [],
        });
      }
      byUserMonth.get(key).rows.push({
        id: item.id,
        date: String(item.date).slice(0, 10),
        ignored: isIgnored,
        constraint: item,
      });
    };
    constraints.forEach((c) => add(c, false));
    ignored.forEach((c) => add(c, true));

    const list = [...byUserMonth.values()].map((group) => {
      const active = group.rows.filter((row) => !row.ignored).length;
      return { ...group, active, over: active > monthlyThreshold };
    });

    const byName = (a, b) =>
      (a.user_name || "").localeCompare(b.user_name || "", "he");
    list.sort((a, b) => {
      if (sortMode === "user") {
        return byName(a, b) || b.month.localeCompare(a.month);
      }
      if (sortMode === "date") {
        return b.month.localeCompare(a.month) || byName(a, b);
      }
      return (
        b.active - a.active ||
        byName(a, b) ||
        b.month.localeCompare(a.month)
      );
    });
    return list;
  }, [constraints, ignored, monthlyThreshold, sortMode]);

  const overCount = groups.filter((group) => group.over).length;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-indigo-500" />
          <p className="text-xs font-semibold text-gray-700">
            אילוצים של משתמשים אחרים ({groups.length})
          </p>
          {overCount > 0 && (
            <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">
              {overCount} חריגות ממכסה
            </span>
          )}
        </div>
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5 text-[11px]">
          {SORT_MODES.map((mode) => (
            <button
              key={mode.key}
              type="button"
              onClick={() => setSortMode(mode.key)}
              className={`px-2 py-0.5 rounded-md font-medium transition-all ${
                sortMode === mode.key
                  ? "bg-white text-gray-800 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-1.5">
        {groups.map((group) => (
          <div
            key={`${group.serial_id}-${group.month}`}
            className={`rounded-xl border px-2.5 py-2 ${
              group.over
                ? "border-amber-200 bg-amber-50"
                : "border-gray-200 bg-gray-50"
            }`}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-gray-800 text-[11px] truncate">
                  {group.user_name}
                </span>
                <span className="text-gray-500 text-[10px]">
                  {fmtMonth(group.month)}
                </span>
              </div>
              <span
                className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${
                  group.over
                    ? "text-amber-800 bg-amber-100"
                    : "text-gray-600 bg-gray-100"
                }`}
              >
                {group.over
                  ? `${group.active} אילוצים — חריגה (מכסה: ${monthlyThreshold})`
                  : `${group.active} אילוצים`}
              </span>
            </div>
            <div className="space-y-1">
              {collapseRanges(group.rows).map((range) => {
                const activeRows = range.rows.filter((row) => !row.ignored);
                const busy =
                  isRunning ||
                  (deletingId != null &&
                    activeRows.some((row) => row.id === deletingId));
                const count = activeRows.length || range.rows.length;
                return (
                  <div
                    key={`${range.startDate}-${range.endDate}`}
                    className={`flex items-center justify-between gap-2 rounded-lg bg-white border px-2 py-1 ${
                      group.over ? "border-amber-100" : "border-gray-100"
                    }`}
                  >
                    <span
                      className={`text-[11px] ${
                        activeRows.length === 0
                          ? "text-gray-400 line-through"
                          : "text-gray-700"
                      }`}
                    >
                      {range.startDate === range.endDate
                        ? fmtHe(range.startDate)
                        : `${fmtHe(range.startDate)} – ${fmtHe(range.endDate)} (${count} ימים)`}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onDelete(activeRows.map((row) => row.constraint))
                      }
                      disabled={busy || activeRows.length === 0}
                      className="p-1 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0 disabled:opacity-40 disabled:hover:text-gray-400 disabled:hover:bg-transparent"
                      title={
                        activeRows.length === 0
                          ? "האילוץ כבר הוסר מהחלוקה הזו"
                          : "הסרה מהחלוקה הזו (האילוץ עצמו נשאר במערכת)"
                      }
                    >
                      {busy && activeRows.length > 0 ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}