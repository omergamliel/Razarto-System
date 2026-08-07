import React from "react";
import { ArrowLeftRight, Calendar } from "lucide-react";
import { format, parseISO } from "date-fns";
import { he } from "date-fns/locale";

/**
 * Visualises a completed swap as a "לפני → אחרי" transition, listing each
 * shift with its owner and date/time so it's clear who had what before and
 * after the swap.
 *
 * - Head2Head:  לפני: requester→original shifts, accepter→offered shifts
 *               אחרי: accepter→original shifts, requester→offered shifts
 * - Full/General: לפני: requester→original shifts
 *               אחרי: accepter→original shifts
 * - Partial:    לפני: requester→original shift
 *               אחרי: each covering user→their coverage window
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

  const requestType = (item.request_type || "").toLowerCase();
  const isPartial = requestType === "partial";
  const isHeadToHead = item.request_type === "Head2Head";
  const requesterName = item.user_name || "—";
  const accepterNames = item.accepted_by_names || [];
  const accepterLabel =
    accepterNames.length > 0 ? accepterNames.join(", ") : "—";

  const resolveUser = (id) =>
    authorizedUsers.find((u) => Number(u.serial_id) === Number(id));

  const originalShifts = item.original_shifts?.length
    ? item.original_shifts
    : item.original_shift
      ? [item.original_shift]
      : [];
  const offeredShifts = item.offered_shifts || [];

  let beforeEntries = [];
  let afterEntries = [];

  if (isPartial) {
    beforeEntries = [
      {
        owner: requesterName,
        dateTime: formatShiftDateTime(item.original_shift),
      },
    ];
    afterEntries = (item.coverageSegments || []).map((seg) => ({
      owner: resolveUser(seg.covering_user_id)?.full_name || "מחליף",
      dateTime: formatSegmentRange(seg.start, seg.end),
    }));
  } else if (isHeadToHead) {
    beforeEntries = [
      ...originalShifts.map((s) => ({
        owner: requesterName,
        dateTime: formatShiftDateTime(s),
      })),
      ...offeredShifts.map((s) => ({
        owner: accepterLabel,
        dateTime: formatShiftDateTime(s),
      })),
    ];
    afterEntries = [
      ...originalShifts.map((s) => ({
        owner: accepterLabel,
        dateTime: formatShiftDateTime(s),
      })),
      ...offeredShifts.map((s) => ({
        owner: requesterName,
        dateTime: formatShiftDateTime(s),
      })),
    ];
  } else {
    beforeEntries = originalShifts.map((s) => ({
      owner: requesterName,
      dateTime: formatShiftDateTime(s),
    }));
    afterEntries = originalShifts.map((s) => ({
      owner: accepterLabel,
      dateTime: formatShiftDateTime(s),
    }));
  }

  const renderEntry = (entry, idx, isAfter) => (
    <div key={idx} className="flex items-center gap-2 flex-wrap">
      <span
        className={`text-sm font-semibold px-2.5 py-1 rounded-lg border ${
          isAfter
            ? "text-green-800 bg-green-50 border-green-200"
            : "text-gray-800 bg-gray-100 border-gray-200"
        }`}
      >
        {entry.owner}
      </span>
      <span
        className="text-xs text-gray-500 flex items-center gap-1"
        dir="ltr"
      >
        <Calendar className="w-3.5 h-3.5" />
        {entry.dateTime}
      </span>
    </div>
  );

  return (
    <div className="mt-3 space-y-3">
      <div className="space-y-2">
        <span className="text-sm font-semibold text-gray-500">לפני</span>
        {beforeEntries.map((e, i) => renderEntry(e, i, false))}
      </div>
      <div className="flex justify-center">
        <ArrowLeftRight className="w-5 h-5 text-gray-400" />
      </div>
      <div className="space-y-2">
        <span className="text-sm font-semibold text-gray-500">אחרי</span>
        {afterEntries.map((e, i) => renderEntry(e, i, true))}
      </div>
    </div>
  );
}