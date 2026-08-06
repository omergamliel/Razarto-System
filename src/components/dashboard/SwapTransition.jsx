import React from "react";
import { ArrowLeft, Clock, ArrowLeftRight } from "lucide-react";
import { format } from "date-fns";

/**
 * Visualises a completed swap as a "past state → current state" transition.
 *
 * - Full / Head2Head:  [לפני: יוזם]  ←  [אחרי: מי שקיבל]
 * - Partial:          [לפני: יוזם]  then one arrow row per covering window
 *
 * RTL aware: the arrow points left (←) which is the natural "forward" direction
 * in a right-to-left reading flow, so "לפני" sits on the right and "אחרי" on
 * the left — matching how the rest of the modal reads.
 */
export default function SwapTransition({ item, authorizedUsers = [] }) {
  if (!item) return null;

  const isPartial = (item.request_type || "").toLowerCase() === "partial";
  const isHeadToHead = item.request_type === "Head2Head";
  const beforeName = item.user_name || "—";

  const resolveUser = (id) =>
    authorizedUsers.find((u) => Number(u.serial_id) === Number(id));

  // --- Partial swap: original owner → each covering user (with time window) ---
  if (isPartial && item.coverageSegments?.length > 0) {
    return (
      <div className="mt-2 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-gray-500">לפני</span>
          <span className="text-sm font-semibold text-gray-800 bg-gray-100 px-2.5 py-1 rounded-lg border border-gray-200">
            {beforeName}
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
                  {format(seg.start, "HH:mm")} - {format(seg.end, "HH:mm")}
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
      </div>
      <Arrow className="w-5 h-5 text-gray-400 mb-1" />
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-gray-500">
          {afterLabel}
        </span>
        <span className="text-sm font-semibold text-green-800 bg-green-50 px-2.5 py-1 rounded-lg border border-green-200">
          {afterNames.length > 0 ? afterNames.join(", ") : "—"}
        </span>
      </div>
    </div>
  );
}
