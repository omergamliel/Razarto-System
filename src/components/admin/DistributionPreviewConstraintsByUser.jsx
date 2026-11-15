import React, { useMemo, useState } from "react";
import { differenceInCalendarDays } from "date-fns";
import { Ban, Loader2, RotateCcw, Users } from "lucide-react";
import { useConsiderationMaxDates } from "@/hooks/useAuthorizedPerson";

/**
 * The constraints (אילוצים) behind a distribution run, shown the way a manager
 * sees "אילוצים של משתמשים אחרים": one card per USER (every month that user
 * has constraints in sits inside the card), the dates collapsed into ranges, an
 * amber mark for a month that crossed the monthly threshold, and the most
 * constrained users first. Each range can be switched off and back on for THIS
 * run only — the requests themselves are never deleted here.
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

const noteOf = (row) => String(row.constraint?.note || "").trim();

// Consecutive calendar days with the same note collapse into one range, so a
// manager reads "05/03 – 08/03 (4 ימים)" with its comment, and switches the run
// off in one action.
const collapseRanges = (rows) => {
  const sorted = [...rows].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const ranges = [];
  sorted.forEach((row) => {
    const last = ranges[ranges.length - 1];
    if (
      last &&
      dayGap(last.endDate, row.date) === 1 &&
      last.note === noteOf(row)
    ) {
      last.endDate = row.date;
      last.rows.push(row);
    } else {
      ranges.push({
        startDate: row.date,
        endDate: row.date,
        note: noteOf(row),
        rows: [row],
      });
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
  onRestore,
  deletingId,
  isRunning,
}) {
  const monthlyThreshold = useConsiderationMaxDates();
  const [sortMode, setSortMode] = useState("count");

  const groups = useMemo(() => {
    const byUser = new Map();
    const add = (item, isIgnored) => {
      if (!item?.date || item.serial_id == null) return;
      const key = String(item.serial_id);
      if (!byUser.has(key)) {
        byUser.set(key, {
          serial_id: item.serial_id,
          user_name: item.user_name || `#${item.serial_id}`,
          rows: [],
        });
      }
      byUser.get(key).rows.push({
        id: item.id,
        date: String(item.date).slice(0, 10),
        ignored: isIgnored,
        constraint: item,
      });
    };
    constraints.forEach((c) => add(c, false));
    ignored.forEach((c) => add(c, true));

    const list = [...byUser.values()].map((user) => {
      const byMonth = new Map();
      user.rows.forEach((row) => {
        const key = monthKeyOf(row.date);
        if (!byMonth.has(key)) byMonth.set(key, []);
        byMonth.get(key).push(row);
      });

      const months = [...byMonth.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, rows]) => {
          rows.sort((a, b) => a.date.localeCompare(b.date));
          const active = rows.filter((row) => !row.ignored).length;
          return { month, rows, active, over: active > monthlyThreshold };
        });

      const active = months.reduce((sum, m) => sum + m.active, 0);
      const overMonths = months.filter((m) => m.over).length;
      const firstDate = user.rows.reduce(
        (min, row) => (!min || row.date < min ? row.date : min),
        "",
      );

      return { ...user, months, active, overMonths, firstDate };
    });

    const byName = (a, b) =>
      (a.user_name || "").localeCompare(b.user_name || "", "he");
    list.sort((a, b) => {
      if (sortMode === "user") return byName(a, b);
      if (sortMode === "date") {
        return a.firstDate.localeCompare(b.firstDate) || byName(a, b);
      }
      return b.active - a.active || byName(a, b);
    });
    return list;
  }, [constraints, ignored, monthlyThreshold, sortMode]);

  const overCount = groups.filter((group) => group.overMonths > 0).length;

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

      <div className="max-h-56 overflow-y-auto custom-scrollbar space-y-1.5">
        {groups.map((user) => (
          <div
            key={user.serial_id}
            className={`rounded-xl border px-2.5 py-2 ${
              user.overMonths > 0
                ? "border-amber-200 bg-amber-50"
                : "border-gray-200 bg-gray-50"
            }`}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
              <span className="font-semibold text-gray-800 text-[11px] truncate">
                {user.user_name}
              </span>
              <span className="flex items-center gap-1">
                {user.overMonths > 0 && (
                  <span
                    className="text-[10px] font-semibold rounded-full px-2 py-0.5 text-amber-800 bg-amber-100"
                    title={`מכסה חודשית: ${monthlyThreshold}`}
                  >
                    {user.overMonths} חודשים מעל המכסה
                  </span>
                )}
                <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 text-gray-600 bg-gray-100">
                  {user.active} אילוצים
                </span>
              </span>
            </div>

            <div className="space-y-1.5">
              {user.months.map((monthBlock) => (
                <div key={monthBlock.month} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium text-gray-500">
                      {fmtMonth(monthBlock.month)}
                    </span>
                    {monthBlock.over && (
                      <span className="text-[10px] font-semibold text-amber-700">
                        חריגה (מכסה: {monthlyThreshold})
                      </span>
                    )}
                  </div>

                  {collapseRanges(monthBlock.rows).map((range) => {
                    const activeRows = range.rows.filter((row) => !row.ignored);
                    const isOff = activeRows.length === 0;
                    const busy =
                      isRunning ||
                      (deletingId != null &&
                        activeRows.some((row) => row.id === deletingId));
                    const count = range.rows.length;
                    const rangeLabel =
                      range.startDate === range.endDate
                        ? fmtHe(range.startDate)
                        : `${fmtHe(range.startDate)} – ${fmtHe(range.endDate)} (${count} ימים)`;
                    return (
                      <div
                        key={`${range.startDate}-${range.endDate}`}
                        className={`rounded-lg bg-white border px-2 py-1 ${
                          monthBlock.over
                            ? "border-amber-100"
                            : "border-gray-100"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`text-[11px] ${
                              isOff
                                ? "text-gray-400 line-through"
                                : "text-gray-700"
                            }`}
                          >
                            {rangeLabel}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              isOff
                                ? onRestore(range.rows.map((row) => row.constraint))
                                : onDelete(activeRows.map((row) => row.constraint))
                            }
                            disabled={busy}
                            aria-pressed={!isOff}
                            className={`p-1 rounded-md transition-colors shrink-0 disabled:opacity-40 ${
                              isOff
                                ? "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                : "text-gray-400 hover:text-amber-600 hover:bg-amber-50"
                            }`}
                            title={
                              isOff
                                ? "הפעלה מחדש של האילוץ בחלוקה הזו"
                                : "כיבוי האילוץ בחלוקה הזו (האילוץ עצמו נשאר במערכת)"
                            }
                          >
                            {busy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : isOff ? (
                              <RotateCcw className="w-3.5 h-3.5" />
                            ) : (
                              <Ban className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                        {range.note && (
                          <p
                            title={range.note}
                            className={`mt-0.5 pr-1 text-[10px] leading-snug truncate ${
                              isOff
                                ? "text-gray-400 line-through"
                                : "text-gray-500"
                            }`}
                          >
                            {range.note}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}