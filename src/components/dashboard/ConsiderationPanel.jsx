import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarHeart,
  Check,
  Clock,
  Trash2,
  X,
  ShieldCheck,
} from "lucide-react";
import {
  format,
  parseISO,
  eachDayOfInterval,
  startOfDay,
  isBefore,
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

// Consideration ("התחשבות") tab. Users mark up to K dates to be treated as
// protected in shift distribution (a range is allowed but every day in it
// counts toward K); they are limited to K PENDING requests at a time. Managers
// see all pending requests and accept/reject them — accepted dates are honored
// by the distribution algorithm (see shiftDistributionAlgorithm's protectedDates).
export default function ConsiderationPanel({ currentUser, isAdmin }) {
  const queryClient = useQueryClient();
  const maxDates = useConsiderationMaxDates();

  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState("");

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["consideration-requests"],
    queryFn: () => base44.entities.ConsiderationRequest.list(),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["consideration-requests"] });

  const mySerial = currentUser?.serial_id;

  const { myRequests, myPending, myDates } = useMemo(() => {
    const mine = requests
      .filter((r) => Number(r.serial_id) === Number(mySerial))
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const pending = mine.filter((r) => r.status === "pending");
    // Dates already requested (pending or accepted) — can't be re-requested.
    const dates = new Set(
      mine.filter((r) => r.status !== "rejected").map((r) => r.date),
    );
    return { myRequests: mine, myPending: pending, myDates: dates };
  }, [requests, mySerial]);

  const remaining = Math.max(maxDates - myPending.length, 0);

  const sortByDateThenName = (a, b) =>
    (a.date || "").localeCompare(b.date || "") ||
    (a.user_name || "").localeCompare(b.user_name || "", "he");

  const pendingForManager = useMemo(
    () => requests.filter((r) => r.status === "pending").sort(sortByDateThenName),
    [requests],
  );

  // Already-approved requests a manager may still revert to "pending" (unapprove)
  // — e.g. plans changed and the date can no longer be protected.
  const acceptedForManager = useMemo(
    () => requests.filter((r) => r.status === "accepted").sort(sortByDateThenName),
    [requests],
  );

  const createMutation = useMutation({
    mutationFn: async (dates) => {
      for (const date of dates) {
        // Sequential (not Promise.all) to stay gentle on the rate limiter.
        // eslint-disable-next-line no-await-in-loop
        await base44.entities.ConsiderationRequest.create({
          serial_id: Number(mySerial),
          user_name: currentUser?.full_name || "",
          date,
          status: "pending",
          note: note?.trim() || undefined,
        });
      }
    },
    onSuccess: (_data, dates) => {
      logActivity({
        action: `בקשת התחשבות ל-${dates.length} תאריכים`,
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

  const decideMutation = useMutation({
    mutationFn: ({ req, status }) =>
      base44.entities.ConsiderationRequest.update(req.id, {
        status,
        decided_by: currentUser?.full_name || "",
      }),
    onSuccess: (_data, { req, status }) => {
      const labels = {
        accepted: { verb: "אישור", log: "אושר", noun: "אושרה" },
        rejected: { verb: "דחיית", log: "נדחה", noun: "נדחתה" },
        pending: { verb: "ביטול אישור", log: "בוטל", noun: "הוחזרה להמתנה" },
      };
      const l = labels[status] || labels.pending;
      logActivity({
        action: `${l.verb} בקשת התחשבות (${fmtHe(req.date)})`,
        type: "בקשת התחשבות",
        actor: currentUser,
        status: l.log,
        entity: "ConsiderationRequest",
        entityId: req.id,
        details: {
          requester: req.user_name,
          date: req.date,
          new_status: l.noun,
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
      setFormError("לא נותרו תאריכים חדשים לבקשה בטווח שנבחר");
      return;
    }
    if (days.length > remaining) {
      setFormError(
        `אפשר לבקש עוד ${remaining} תאריכים בלבד (מכסה: ${maxDates} בקשות ממתינות)`,
      );
      return;
    }
    createMutation.mutate(days);
  };

  const statusBadge = (status) => {
    if (status === "accepted")
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 bg-green-100 rounded-full px-2 py-0.5">
          <Check className="w-3 h-3" /> אושרה
        </span>
      );
    if (status === "rejected")
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-100 rounded-full px-2 py-0.5">
          <X className="w-3 h-3" /> נדחתה
        </span>
      );
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">
        <Clock className="w-3 h-3" /> ממתינה
      </span>
    );
  };

  if (isLoading) {
    return (
      <div className="text-center py-10 text-gray-500">טוען בקשות...</div>
    );
  }

  return (
    <div className="space-y-5" dir="rtl">
      {/* Submit form */}
      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarHeart className="w-5 h-5 text-indigo-500" />
          <h3 className="font-bold text-gray-800 text-sm">
            בקשת התחשבות בתאריכים
          </h3>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">
          סמנו תאריכים שתרצו שיישמרו עבורכם בחלוקת המשמרות. אפשר לבחור טווח —
          כל יום בטווח נספר בנפרד. אתם מוגבלים ל-{maxDates} בקשות ממתינות. נותרו:{" "}
          <span className="font-bold text-gray-800">{remaining}</span>
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
              placeholder="סיבת הבקשה"
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white"
            />
          </div>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending || remaining === 0}
            className="rounded-xl h-10 bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {createMutation.isPending ? "שולח..." : "שליחת בקשה"}
          </Button>
        </div>
        {(formError || createMutation.isError || remaining === 0) && (
          <p className="text-xs font-medium text-red-600">
            {formError ||
              (createMutation.isError
                ? "אירעה שגיאה בשליחת הבקשה"
                : "הגעת למכסת הבקשות הממתינות")}
          </p>
        )}
      </div>

      {/* My requests */}
      <div className="space-y-2">
        <h3 className="font-bold text-gray-800 text-sm">הבקשות שלי</h3>
        {myRequests.length === 0 ? (
          <div className="text-center py-6 bg-gray-50 rounded-2xl border border-dashed border-gray-200 text-gray-500 text-sm">
            טרם ביקשת התחשבות בתאריכים
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
                  {statusBadge(r.status)}
                  {r.note && (
                    <span className="text-[11px] text-gray-400 truncate">
                      {r.note}
                    </span>
                  )}
                </div>
                {r.status === "pending" && (
                  <button
                    onClick={() => cancelMutation.mutate(r.id)}
                    disabled={cancelMutation.isPending}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                    title="ביטול הבקשה"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Manager: pending requests to decide */}
      {isAdmin && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-indigo-500" />
            <h3 className="font-bold text-gray-800 text-sm">
              בקשות ממתינות לאישור ({pendingForManager.length})
            </h3>
          </div>
          {pendingForManager.length === 0 ? (
            <div className="text-center py-6 bg-gray-50 rounded-2xl border border-dashed border-gray-200 text-gray-500 text-sm">
              אין בקשות ממתינות
            </div>
          ) : (
            <div className="space-y-1.5">
              {pendingForManager.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="font-semibold text-gray-800 text-sm">
                      {r.user_name || "לא ידוע"}
                    </span>
                    <span className="text-gray-500 text-sm">
                      {fmtHe(r.date)}
                    </span>
                    {r.note && (
                      <span className="text-[11px] text-gray-400 truncate">
                        {r.note}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() =>
                        decideMutation.mutate({ req: r, status: "accepted" })
                      }
                      disabled={decideMutation.isPending}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-green-700 bg-green-100 hover:bg-green-200 transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" /> אישור
                    </button>
                    <button
                      onClick={() =>
                        decideMutation.mutate({ req: r, status: "rejected" })
                      }
                      disabled={decideMutation.isPending}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-700 bg-red-100 hover:bg-red-200 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" /> דחייה
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Approved requests — still revertible: a manager can unapprove one
              (send it back to "ממתינה") if plans changed. */}
          {acceptedForManager.length > 0 && (
            <div className="space-y-1.5 pt-2">
              <h4 className="font-bold text-gray-800 text-sm">
                בקשות שאושרו ({acceptedForManager.length})
              </h4>
              {acceptedForManager.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="font-semibold text-gray-800 text-sm">
                      {r.user_name || "לא ידוע"}
                    </span>
                    <span className="text-gray-500 text-sm">
                      {fmtHe(r.date)}
                    </span>
                    {r.note && (
                      <span className="text-[11px] text-gray-400 truncate">
                        {r.note}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() =>
                      decideMutation.mutate({ req: r, status: "pending" })
                    }
                    disabled={decideMutation.isPending}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-amber-700 bg-amber-100 hover:bg-amber-200 transition-colors shrink-0"
                  >
                    <X className="w-3.5 h-3.5" /> ביטול אישור
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
