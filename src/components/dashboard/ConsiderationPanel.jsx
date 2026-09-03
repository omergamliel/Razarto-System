import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Trash2, AlertTriangle } from "lucide-react";
import {
  format,
  parseISO,
  eachDayOfInterval,
  startOfDay,
  isBefore,
  differenceInCalendarDays,
} from "date-fns";
import { Button } from "@/components/ui/button";
import { base44, logActivity } from "@/api/base44Client";
import { useConsiderationMaxDates } from "@/hooks/useAuthorizedPerson";

const fmtHe = (dateStr) => {
  try {
    return format(parseISO(dateStr), "dd/MM/yyyy");
  } catch {
    return dateStr;
  }
};

// A month key 'yyyy-MM' -> a readable 'MM/yyyy' label.
const monthKeyOf = (dateStr) => (dateStr || "").slice(0, 7);
const fmtMonth = (monthKey) => {
  try {
    return format(parseISO(`${monthKey}-01`), "MM/yyyy");
  } catch {
    return monthKey;
  }
};

// Collapse a sorted list of request rows ({ id, date }) into consecutive
// calendar-day ranges (like the fairness table's counted ranges): each range is
// { startDate, endDate, ids } so a manager can see "05/03–08/03 (4 ימים)" and
// delete the whole run at once.
const collapseRanges = (rows) => {
  const sorted = [...rows].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const ranges = [];
  sorted.forEach((row) => {
    const last = ranges[ranges.length - 1];
    if (
      last &&
      differenceInCalendarDays(parseISO(row.date), parseISO(last.endDate)) === 1
    ) {
      last.endDate = row.date;
      last.ids.push(row.id);
    } else {
      ranges.push({ startDate: row.date, endDate: row.date, ids: [row.id] });
    }
  });
  return ranges;
};

// Constraints ("אילוצים") tab. Users mark dates they DON'T want to be scheduled
// for; the shift-distribution algorithm never assigns them a shift on those
// dates (see shiftDistributionAlgorithm's protectedDates). Constraints take
// effect immediately — no manager approval. There is no hard limit on how many a
// user may set, but when a user crosses K constraints in a single month the
// managers are signaled (here and in their sidebar) so they can review and, if
// they choose, delete some. K is the monthly threshold set in
// AdminSettingsModal ▸ אילוצים.
export default function ConsiderationPanel({ currentUser, isAdmin }) {
  const queryClient = useQueryClient();
  const monthlyThreshold = useConsiderationMaxDates();

  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState("");
  const [sortMode, setSortMode] = useState("user"); // "user" | "date"

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["consideration-requests"],
    queryFn: () => base44.entities.ConsiderationRequest.list(),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["consideration-requests"] });

  const mySerial = currentUser?.serial_id;

  const { myRequests, myDates } = useMemo(() => {
    const mine = requests
      .filter((r) => Number(r.serial_id) === Number(mySerial))
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    // Dates already requested — can't be re-requested.
    const dates = new Set(mine.map((r) => r.date));
    return { myRequests: mine, myDates: dates };
  }, [requests, mySerial]);

  // Manager signal: users who set MORE THAN the monthly threshold of
  // constraints in a single calendar month. Grouped by user+month, each group
  // carrying its own constraint rows so ranges/counts can be shown and deleted.
  const flaggedGroups = useMemo(() => {
    if (!isAdmin) return [];
    const byUserMonth = new Map();
    requests.forEach((r) => {
      if (!r.date || r.serial_id == null) return;
      const key = `${r.serial_id}|${monthKeyOf(r.date)}`;
      if (!byUserMonth.has(key)) {
        byUserMonth.set(key, {
          serial_id: r.serial_id,
          user_name: r.user_name || "לא ידוע",
          month: monthKeyOf(r.date),
          rows: [],
        });
      }
      byUserMonth.get(key).rows.push({ id: r.id, date: r.date });
    });
    const flagged = Array.from(byUserMonth.values()).filter(
      (g) => g.rows.length > monthlyThreshold,
    );
    flagged.sort((a, b) => {
      if (sortMode === "date") {
        return (
          b.month.localeCompare(a.month) ||
          a.user_name.localeCompare(b.user_name, "he")
        );
      }
      return (
        a.user_name.localeCompare(b.user_name, "he") ||
        b.month.localeCompare(a.month)
      );
    });
    return flagged;
  }, [requests, isAdmin, monthlyThreshold, sortMode]);

  const createMutation = useMutation({
    mutationFn: async (dates) => {
      for (const date of dates) {
        // Sequential (not Promise.all) to stay gentle on the rate limiter.
        // eslint-disable-next-line no-await-in-loop
        await base44.entities.ConsiderationRequest.create({
          serial_id: Number(mySerial),
          user_name: currentUser?.full_name || "",
          date,
          // Constraints are honored immediately — created already "accepted",
          // no manager approval step.
          status: "accepted",
          note: note?.trim() || undefined,
        });
      }
    },
    onSuccess: (_data, dates) => {
      logActivity({
        action: `הוספת ${dates.length} אילוצים`,
        type: "בקשת התחשבות",
        actor: currentUser,
        entity: "ConsiderationRequest",
        details: {
          requester: currentUser?.full_name,
          dates,
          count: dates.length,
        },
      });
      setRangeStart("");
      setRangeEnd("");
      setNote("");
      setFormError("");
      invalidate();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id) => base44.entities.ConsiderationRequest.delete(id),
    onSuccess: invalidate,
  });

  // Manager: delete every constraint in a collapsed range at once.
  const deleteRangeMutation = useMutation({
    mutationFn: async (ids) => {
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        await base44.entities.ConsiderationRequest.delete(id);
      }
      return ids.length;
    },
    onSuccess: (count, _ids) => {
      logActivity({
        action: `מחיקת ${count} אילוצים (חריגה ממכסה)`,
        type: "בקשת התחשבות",
        actor: currentUser,
        entity: "ConsiderationRequest",
        details: {
          requester: currentUser?.full_name,
          count,
        },
      });
      invalidate();
    },
  });

  const handleSubmit = () => {
    setFormError("");
    if (!rangeStart) {
      setFormError("בחרו תאריך");
      return;
    }
    const start = parseISO(rangeStart);
    const end = rangeEnd ? parseISO(rangeEnd) : start;
    if (isBefore(end, start)) {
      setFormError("תאריך הסיום מוקדם מתאריך ההתחלה");
      return;
    }
    const today = startOfDay(new Date());
    const days = eachDayOfInterval({ start, end })
      .filter((d) => !isBefore(startOfDay(d), today)) // no past dates
      .map((d) => format(d, "yyyy-MM-dd"))
      .filter((key) => !myDates.has(key)); // skip already-requested dates

    if (days.length === 0) {
      setFormError("לא נותרו תאריכים חדשים לאילוץ בטווח שנבחר");
      return;
    }
    createMutation.mutate(days);
  };

  if (isLoading) {
    return (
      <div className="text-center py-10 text-gray-500">טוען אילוצים...</div>
    );
  }

  return (
    <div className="space-y-5" dir="rtl">
      {/* Submit form */}
      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Ban className="w-5 h-5 text-indigo-500" />
          <h3 className="font-bold text-gray-800 text-sm">הוספת אילוץ בתאריכים</h3>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">
          סמנו תאריכים שבהם אינכם רוצים להיות משובצים למשמרת. בחלוקת המשמרות לא
          תשובצו בתאריכים שסימנתם — האילוץ נכנס לתוקף מיד וללא צורך באישור. אפשר
          לבחור טווח, וכל יום בטווח נספר בנפרד. אין הגבלה על כמות האילוצים, אך אם
          תעברו {monthlyThreshold} אילוצים בחודש בודד המנהלים יקבלו על כך התראה.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">מתאריך</label>
            <input
              type="date"
              value={rangeStart}
              onChange={(e) => setRangeStart(e.target.value)}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white"
              dir="ltr"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">עד תאריך (אופציונלי)</label>
            <input
              type="date"
              value={rangeEnd}
              onChange={(e) => setRangeEnd(e.target.value)}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white"
              dir="ltr"
            />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <label className="text-xs text-gray-500">הערה (אופציונלי)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="סיבת האילוץ"
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white"
            />
          </div>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="rounded-xl h-10 bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {createMutation.isPending ? "שולח..." : "הוספת אילוץ"}
          </Button>
        </div>
        {(formError || createMutation.isError) && (
          <p className="text-xs font-medium text-red-600">
            {formError || "אירעה שגיאה בהוספת האילוץ"}
          </p>
        )}
      </div>

      {/* My constraints */}
      <div className="space-y-2">
        <h3 className="font-bold text-gray-800 text-sm">האילוצים שלי</h3>
        {myRequests.length === 0 ? (
          <div className="text-center py-6 bg-gray-50 rounded-2xl border border-dashed border-gray-200 text-gray-500 text-sm">
            טרם הוספת אילוצים בתאריכים
          </div>
        ) : (
          <div className="space-y-1.5">
            {myRequests.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 bg-white px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold text-gray-800 text-sm">
                    {fmtHe(r.date)}
                  </span>
                  {r.note && (
                    <span className="text-[11px] text-gray-400 truncate">
                      {r.note}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => cancelMutation.mutate(r.id)}
                  disabled={cancelMutation.isPending}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                  title="הסרת האילוץ"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Manager: users who crossed the monthly threshold */}
      {isAdmin && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <h3 className="font-bold text-gray-800 text-sm">
                חריגות ממכסת האילוצים ({flaggedGroups.length})
              </h3>
            </div>
            {flaggedGroups.length > 0 && (
              <div className="flex items-center bg-gray-100 rounded-lg p-0.5 text-xs">
                <button
                  onClick={() => setSortMode("user")}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    sortMode === "user"
                      ? "bg-white text-gray-800 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  לפי משתמש
                </button>
                <button
                  onClick={() => setSortMode("date")}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    sortMode === "date"
                      ? "bg-white text-gray-800 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  לפי תאריך
                </button>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            משתמשים שהגדירו יותר מ-{monthlyThreshold} אילוצים בחודש בודד. האילוצים
            תקפים ונלקחים בחשבון בחלוקה — זהו סימון בלבד; אפשר למחוק אילוצים כאן אם
            תרצו.
          </p>
          {flaggedGroups.length === 0 ? (
            <div className="text-center py-6 bg-gray-50 rounded-2xl border border-dashed border-gray-200 text-gray-500 text-sm">
              אין חריגות ממכסת האילוצים
            </div>
          ) : (
            <div className="space-y-2">
              {flaggedGroups.map((g) => (
                <div
                  key={`${g.serial_id}-${g.month}`}
                  className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-gray-800 text-sm">
                        {g.user_name}
                      </span>
                      <span className="text-gray-500 text-xs">
                        {fmtMonth(g.month)}
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">
                      {g.rows.length} אילוצים (מכסה: {monthlyThreshold})
                    </span>
                  </div>
                  <div className="space-y-1">
                    {collapseRanges(g.rows).map((range) => (
                      <div
                        key={`${range.startDate}-${range.endDate}`}
                        className="flex items-center justify-between gap-2 rounded-lg bg-white/70 border border-amber-100 px-2.5 py-1.5"
                      >
                        <span className="text-xs text-gray-700">
                          {range.startDate === range.endDate
                            ? fmtHe(range.startDate)
                            : `${fmtHe(range.startDate)} – ${fmtHe(range.endDate)} (${range.ids.length} ימים)`}
                        </span>
                        <button
                          onClick={() => deleteRangeMutation.mutate(range.ids)}
                          disabled={deleteRangeMutation.isPending}
                          className="p-1 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                          title="מחיקת האילוצים בטווח"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
