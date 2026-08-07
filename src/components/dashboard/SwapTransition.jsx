import React from "react";
import { ArrowLeft, Clock, ArrowLeftRight, Calendar } from "lucide-react";
import { format, parseISO } from "date-fns";
import { he } from "date-fns/locale";

/**
 * Visualises a completed swap as a "past state → current state" transition,
 * showing the date & time on both sides so it's clear what each person had
 * before and after the swap.
 *
 * - Full / Head2Head:  [לפני: יוזם · shift date/time]  ←  [אחרי: מי שקיבל · same date/time]
 * - Partial:          [לפני: יוזם · shift date/time]  then one arrow row per
 *                     covering window with its own date/time
 *
 * RTL aware: the arrow points left (←) which is the natural "forward" direction
 * in a right-to-left reading flow, so "לפני" sits on the right and "אחרי" on
 * the left — matching how the rest of the modal reads.
 */
const formatShiftDateTime = (shift) => {
  if (!shift?.start_date) return "—";
  try {
    const date = parseISO(shift.start_date);
    if (isNaN(date)) return "—";
    const time = shift.start_time || "09:00";
    const end = shift.end_time || time;
    return `${format(date, "dd/MM/yyyy", { locale: he })} · ${time}${end !== time ? `-${end}` : ""}`;
  } catch {
    return "—";
  }
};

const formatSegmentRange = (start, end) => {
  try {
    const sameDay = format(start, "dd/MM/yyyy") === format(end, "dd/MM/yyyy");
    if (sameDay) {
      return `${format(start, "dd/MM/yyyy", { locale: he })} · ${format(start, "HH:mm")}-${format(end, "HH:mm")}`;
    }
    return `${format(start, "dd/MM/yyyy HH:mm", { locale: he })} - ${format(end, "dd/MM/yyyy HH:mm", { locale: he })}`;
  } catch {
    return "—";
  }
};

export default function SwapTransition({ item, authorizedUsers = [] }) {
  if (!item) return null;

  const isPartial = (item.request_type || "").toLowerCase() === "partial";
  const isHeadToHead = item.request_type === "Head2Head";
  const beforeName = item.user_name || "—";
  const beforeDateTime = formatShiftDateTime(item.original_shift);

  const resolveUser = (id) =>
    authorizedUsers.find((u) => Number(u.serial_id) === Number(id));

  // --- Partial swap: original owner → each covering user (with time window) ---
  if (isPartial && item.coverageSegments?.length > 0) {
    return (
      <div className="mt-2 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium text-gray-500">לפני</span>
          <span className="text-sm font-semibold text-gray-800 bg-gray-100 px-2.5 py-1 rounded-lg border border-gray-200">
            {beforeName}
          </span>
          <span
            className="text-[11px] text-gray-500 flex items-center gap-1"
            dir="ltr"
          >
            <Calendar className="w-3 h-3" />
            {beforeDateTime}
          </span>
        </div>
        <div className="space-y-1.5">
          {item.coverageSegments.map((seg, idx) => {
            const coveringUser = resolveUser(seg.covering_user_id);
            return (
              <div
                key={`t-${idx}`}
                className="flex items-center gap-2 flex-wrap"
              >
                <ArrowLeft className="w-4 h-4 text-green-600 flex-shrink-0" />
                <span className="text-[11px] font-medium text-gray-500">
                  אחרי
                </span>
                <span className="text-sm font-semibold text-green-800 bg-green-50 px-2.5 py-1 rounded-lg border border-green-200">
                  {coveringUser?.full_name || "מחליף"}
                </span>
                <span
                  className="text-[11px] text-gray-500 flex items-center gap-1"
                  dir="ltr"
                >
                  <Clock className="w-3 h-3" />
                  {formatSegmentRange(seg.start, seg.end)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // --- Full / Head2Head swap: original owner → accepted by ---
  const afterNames =
    item.accepted_by_names?.length > 0 ? item.accepted_by_names : [];
  const afterLabel = isHeadToHead ? "הוחלף עם" : "אחרי";
  const Arrow = isHeadToHead ? ArrowLeftRight : ArrowLeft;

  return (
    <div className="mt-2 flex items-end gap-2 flex-wrap">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-gray-500">לפני</span>
        <span className="text-sm font-semibold text-gray-800 bg-gray-100 px-2.5 py-1 rounded-lg border border-gray-200">
          {beforeName}
        </span>
        <span
          className="text-[11px] text-gray-500 flex items-center gap-1"
          dir="ltr"
        >
          <Calendar className="w-3 h-3" />
          {beforeDateTime}
        </span>
      </div>
      <Arrow className="w-5 h-5 text-gray-400 mb-1" />
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-gray-500">
          {afterLabel}
        </span>
        <span className="text-sm font-semibold text-green-800 bg-green-50 px-2.5 py-1 rounded-lg border border-green-200">
          {afterNames.length > 0 ? afterNames.join(", ") : "—"}
        </span>
        <span
          className="text-[11px] text-gray-500 flex items-center gap-1"
          dir="ltr"
        >
          <Calendar className="w-3 h-3" />
          {beforeDateTime}
        </span>
      </div>
    </div>
  );
}