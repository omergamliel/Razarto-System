import React, { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Calendar,
  ArrowRight,
  Clock,
  AlertCircle,
  CalendarPlus,
  ArrowLeftRight,
  ChevronDown,
  Send,
  MessageCircle,
  XCircle,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format, differenceInMinutes, addDays, parseISO } from "date-fns";
import { he } from "date-fns/locale";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import LoadingSkeleton from "../LoadingSkeleton";
import {
  buildSwapTemplate,
  mergeOverlappingSegments,
} from "../calendar/whatsappTemplates";
import SwapTransition from "./SwapTransition";

// --- Static Helper Functions (Outside Component) ---
const formatDateTimeForDisplay = (dateStr, timeStr) => {
  if (!dateStr) return null;
  try {
    const composed = new Date(`${dateStr}T${timeStr || "09:00"}`);
    if (isNaN(composed)) return null;
    return format(composed, "dd/MM/yy HH:mm", { locale: he });
  } catch (err) {
    console.error("Failed to format date time for display", err);
    return null;
  }
};

const isFullShift = (shift) => {
  const start = shift?.start_time || "09:00";
  const end = shift?.end_time || "09:00";
  return start === end;
};

const getShiftTimeDisplay = (shift) => {
  if (!shift?.start_date) return "זמן לא ידוע";
  if (isFullShift(shift)) return "משמרת מלאה";

  const startText = formatDateTimeForDisplay(
    shift.start_date,
    shift.start_time,
  );
  const endText = formatDateTimeForDisplay(
    shift.end_date || shift.start_date,
    shift.end_time || shift.start_time,
  );

  if (startText && endText) return `${startText} - ${endText}`;
  return startText || "זמן לא ידוע";
};

const computeMissingSegments = (windowStart, windowEnd, coverageSegments) => {
  let segments = [{ start: windowStart, end: windowEnd }];
  coverageSegments.forEach((cov) => {
    segments = segments.flatMap((seg) => {
      if (cov.end <= seg.start || cov.start >= seg.end) return [seg];
      const gaps = [];
      if (cov.start > seg.start)
        gaps.push({ start: seg.start, end: cov.start });
      if (cov.end < seg.end) gaps.push({ start: cov.end, end: seg.end });
      return gaps;
    });
  });
  return segments.filter((seg) => differenceInMinutes(seg.end, seg.start) > 0);
};

const getStartDateTime = (item) => {
  const dateStr = item.shift_date || item.start_date || item.req_start_date;
  const timeStr =
    item.start_time || item.req_start_time || item.req_end_time || "00:00";

  if (!dateStr) return null;

  const composed = new Date(`${dateStr}T${timeStr}`);
  if (!isNaN(composed)) return composed;

  const fallback = new Date(dateStr);
  return isNaN(fallback) ? null : fallback;
};

const getLatestActivityDate = (item) => {
  // base44 entities carry their system timestamps as *_date (created_date/
  // updated_date), not *_at — the *_at variants are kept as a fallback in
  // case a caller ever passes plain JS objects that use that convention.
  const candidates = [
    item.updated_date,
    item.updated_at,
    item.created_date,
    item.created_at,
    item.shift_date,
    item.req_start_date,
  ]
    .map((val) => (val ? new Date(val) : null))
    .filter((val) => val && !isNaN(val));

  return candidates[0] || null;
};

const getDisplayDay = (dateStr) => {
  if (!dateStr) return "";
  const parsed = parseISO(dateStr);
  if (isNaN(parsed)) return "";
  return format(parsed, "EEEE", { locale: he });
};

const isOpenStatus = (status) => ["Open", "Partially_Covered"].includes(status);

export default function KPIListModal({
  isOpen,
  onClose,
  type,
  currentUser,
  onOfferCover,
  onRequestSwap,
  actionsDisabled = false,
  onCancelRequest,
  onAcceptHeadToHead,
  onAcceptGeneralRequest,
  onStartCounterOffer,
}) {
  const [visibleCount, setVisibleCount] = useState(10);
  const isPartialGapsView = type === "partial_gaps";
  const [swapTab, setSwapTab] = useState("all");
  const [partialGapsTab, setPartialGapsTab] = useState("all");
  // Confirmation gate for onCancelRequest: { item, isDecline } | null.
  // isDecline only differentiates the dialog copy (incoming H2H "decline"
  // vs. every other "cancel my own request") — both paths call the same
  // onCancelRequest(item).
  const [pendingCancelAction, setPendingCancelAction] = useState(null);

  const requestCancelConfirm = (item, isDecline = false) =>
    setPendingCancelAction({ item, isDecline });

  const handleConfirmCancel = () => {
    if (pendingCancelAction?.item) {
      onCancelRequest && onCancelRequest(pendingCancelAction.item);
    }
    setPendingCancelAction(null);
  };

  useEffect(() => {
    if (isOpen) setVisibleCount(10);
  }, [isOpen, type]);

  // Shared cache keys with ShiftCalendar's own queries (['swap-requests'],
  // ['shifts'], ['coverages'], ['all-users']) so this modal reflects new/updated
  // requests immediately instead of only after its own separate cache entry
  // happens to refetch. ShiftCalendar keeps these keys populated and calls
  // queryClient.invalidateQueries on them after every mutation; using the same
  // keys here means those invalidations refresh this modal's data too.
  const { data: swapRequestsAll = [], isLoading: isSwapRequestsLoading } =
    useQuery({
      queryKey: ["swap-requests"],
      queryFn: () => base44.entities.SwapRequest.list(),
      enabled: isOpen,
    });

  const { data: shiftsAll = [], isLoading: isShiftsLoading } = useQuery({
    queryKey: ["shifts"],
    queryFn: () => base44.entities.Shift.list(),
    enabled: isOpen,
  });

  const { data: coveragesAll = [], isLoading: isCoveragesLoading } = useQuery({
    queryKey: ["coverages"],
    queryFn: () => base44.entities.ShiftCoverage.list(),
    // Keep this hook active for every type while the modal is mounted to avoid
    // changing the hook graph when switching KPI views mid-session.
    enabled: isOpen,
  });

  const { data: authorizedUsers = [], isLoading: isUsersLoading } = useQuery({
    queryKey: ["all-users"],
    queryFn: () => base44.entities.AuthorizedPerson.list(),
    enabled: isOpen,
  });

  const isLoading =
    isSwapRequestsLoading ||
    isShiftsLoading ||
    isUsersLoading ||
    ((isPartialGapsView || type === "approved") && isCoveragesLoading);

  // --- Helpers ---
  const enrichRequestsWithShiftInfo = useCallback(
    (requests) => {
      return requests.map((req) => {
        // A request can now bundle multiple of the requester's own shifts
        // (shift_ids is an array), so resolve every one of them rather
        // than just the first.
        const reqShiftIds = req.shift_ids || [];
        const reqShifts = shiftsAll.filter((s) => reqShiftIds.includes(s.id));
        const shift = reqShifts[0];
        const user =
          authorizedUsers.find(
            (u) => u?.serial_id === req.requesting_user_id,
          ) ||
          authorizedUsers.find((u) => u?.serial_id === shift?.original_user_id);
        // Head2Head requests also carry target shift(s) being asked for in
        // exchange (offered_shift_ids), which have their own owner.
        const offeredShiftIds = req.offered_shift_ids || [];
        const offeredShifts = shiftsAll.filter((s) =>
          offeredShiftIds.includes(s.id),
        );
        const offeredUsers = offeredShifts.map((s) =>
          authorizedUsers.find((u) => u?.serial_id === s.original_user_id),
        );
        const coverageSegments = mergeOverlappingSegments(
          coveragesAll
            .filter(
              (c) =>
                c.shift_id === shift?.id &&
                (c.status === "Approved" || !c.status),
            )
            .map((c, idx) => {
              const covShift =
                reqShifts.find((s) => s.id === c.shift_id) || shift;
              const covStart = new Date(
                `${c.cover_start_date || covShift?.start_date}T${c.cover_start_time || covShift?.start_time || "09:00"}`,
              );
              let covEnd = new Date(
                `${c.cover_end_date || covShift?.end_date || covShift?.start_date}T${c.cover_end_time || covShift?.end_time || "09:00"}`,
              );
              if (covEnd <= covStart) covEnd = addDays(covEnd, 1);
              return {
                key: c.id || idx,
                start: covStart,
                end: covEnd,
                covering_user_id: c.covering_user_id,
              };
            }),
          (seg) => seg.covering_user_id,
        );

        // Once a Head2Head request is closed, acceptHeadToHeadRequestMutation has
        // already reassigned these shifts to whoever accepted, so offeredUsers
        // (derived from the *offered* shifts' current owner) now points at the
        // requester instead. The accepter's identity is found the other way
        // round: they're whoever now owns the requester's original shift_ids.
        const isClosedRequest = ["Closed", "Completed"].includes(req.status);
        const acceptedByNames = isClosedRequest
          ? [
              ...new Set(
                reqShifts
                  .map(
                    (s) =>
                      authorizedUsers.find(
                        (u) => u?.serial_id === s.original_user_id,
                      )?.full_name,
                  )
                  .filter(Boolean),
              ),
            ]
          : [];

        return {
          ...req,
          shift_date: shift?.start_date,
          start_time: shift?.start_time,
          end_time: shift?.end_time,
          user_name: user?.full_name || "לא ידוע",
          department: user?.department,
          original_shift: shift,
          original_shifts: reqShifts,
          shift_count: reqShiftIds.length,
          offered_shifts: offeredShifts.map((s, idx) => ({
            ...s,
            owner_name: offeredUsers[idx]?.full_name || "לא ידוע",
          })),
          is_request_object: true,
          is_closed_request: isClosedRequest,
          accepted_by_names: acceptedByNames,
          original_user_id: shift?.original_user_id ?? req.requesting_user_id,
          covering_user_ids: coverageSegments
            .map((c) => c.covering_user_id)
            .filter(Boolean),
          coverageSegments,
        };
      });
    },
    [coveragesAll, shiftsAll, authorizedUsers],
  );

  const enrichShiftsWithUserInfo = useCallback(
    (shifts) => {
      return shifts.map((s) => {
        const activeRequest = swapRequestsAll.find(
          (r) => r.shift_ids?.includes(s.id) && isOpenStatus(r.status),
        );
        const coverageType =
          activeRequest?.request_type?.toLowerCase() ||
          s.coverageType ||
          s.swap_type;
        let displayStatus = "regular";

        if (
          s.status === "Covered" ||
          s.cover_status === "Approved" ||
          s.ownership === "covering"
        ) {
          displayStatus = "covered";
        } else if (activeRequest || s.status === "Swap_Requested") {
          displayStatus = coverageType === "partial" ? "partial" : "requested";
        } else if (s.coverageType === "partial") {
          displayStatus = "partial";
        }

        const typeRequest =
          activeRequest ||
          swapRequestsAll.find((r) => r.shift_ids?.includes(s.id));
        return {
          ...s,
          user_name:
            s.ownership === "covering"
              ? s.covering_name || currentUser?.full_name
              : currentUser?.full_name,
          shift_date: s.start_date,
          is_shift_object: true,
          status: displayStatus,
          coverageType,
          request_type: typeRequest?.request_type,
        };
      });
    },
    [currentUser, swapRequestsAll],
  );

  // Also needed (not just for the partial-gaps tab) by the "approved" KPI,
  // which surfaces in-progress partial swaps that already have some coverage
  // taken even though they aren't fully closed yet.
  const partialGapItems = useMemo(() => {
    if (!isOpen || !(isPartialGapsView || type === "approved")) return [];
    return shiftsAll
      .map((shift) => {
        if (shift.status === "Active") return null;

        const activeRequest = swapRequestsAll.find(
          (r) => r.shift_ids?.includes(shift.id) && isOpenStatus(r.status),
        );
        const user = authorizedUsers.find(
          (u) => u.serial_id === shift.original_user_id,
        );

        const startTime =
          activeRequest?.req_start_time ||
          shift.swap_start_time ||
          shift.start_time ||
          "09:00";
        const endTime =
          activeRequest?.req_end_time ||
          shift.swap_end_time ||
          shift.end_time ||
          startTime;
        const startDate = activeRequest?.req_start_date || shift.start_date;
        const endDate =
          activeRequest?.req_end_date || shift.end_date || startDate;
        const windowStart = new Date(`${startDate}T${startTime}`);
        let windowEnd = new Date(`${endDate}T${endTime}`);
        if (windowEnd <= windowStart) windowEnd = addDays(windowEnd, 1);

        const coverageSegments = mergeOverlappingSegments(
          coveragesAll
            .filter((c) => c.shift_id === shift.id)
            .map((c, idx) => {
              const covStart = new Date(
                `${c.cover_start_date || startDate}T${c.cover_start_time || startTime}`,
              );
              let covEnd = new Date(
                `${c.cover_end_date || endDate}T${c.cover_end_time || endTime}`,
              );
              if (covEnd <= covStart) covEnd = addDays(covEnd, 1);
              return {
                key: c.id || idx,
                start: covStart,
                end: covEnd,
                covering_user_id: c.covering_user_id,
              };
            }),
          (seg) => seg.covering_user_id,
        );

        const missing = computeMissingSegments(
          windowStart,
          windowEnd,
          coverageSegments,
        );
        const hasGap = missing.length > 0;
        const hasPartialAssignment = coverageSegments.length > 0 && hasGap;

        if (!hasGap || (!hasPartialAssignment && !activeRequest)) return null;

        return {
          ...activeRequest,
          id: activeRequest?.id || `partial-${shift.id}`,
          shift_id: shift.id,
          user_name: user?.full_name || shift.user_name || "לא ידוע",
          req_start_time: startTime,
          req_end_time: endTime,
          shift_date: startDate,
          request_type: "Partial",
          requesting_user_id:
            activeRequest?.requesting_user_id || shift.original_user_id,
          original_user_id: shift.original_user_id,
          covering_user_ids: coverageSegments
            .map((c) => c.covering_user_id)
            .filter(Boolean),
          missingSegments: missing,
          coverageSegments,
          original_shift: shift,
          is_request_object: true,
        };
      })
      .filter(Boolean);
  }, [
    authorizedUsers,
    coveragesAll,
    isOpen,
    isPartialGapsView,
    shiftsAll,
    swapRequestsAll,
    type,
  ]);

  const futureShifts = useMemo(() => {
    const todayStr = new Date().toISOString().split("T")[0];

    const owned = shiftsAll
      .filter(
        (s) =>
          s.original_user_id === currentUser?.serial_id &&
          s.start_date >= todayStr,
      )
      .map((s) => ({ ...s, ownership: "mine" }));

    const asCovering = coveragesAll
      .filter(
        (c) =>
          c.covering_user_id === currentUser?.serial_id &&
          c.status !== "Cancelled" &&
          c.cover_start_date >= todayStr,
      )
      .map((cov) => {
        const shift = shiftsAll.find((s) => s.id === cov.shift_id);
        if (!shift) return null;
        return {
          ...shift,
          start_date: cov.cover_start_date || shift.start_date,
          end_date:
            cov.cover_end_date || shift.end_date || cov.cover_start_date,
          start_time: cov.cover_start_time || shift.start_time,
          end_time: cov.cover_end_time || shift.end_time,
          ownership: "covering",
          covering_name: currentUser?.full_name,
          cover_status: cov.status,
        };
      })
      .filter(Boolean);

    return [...owned, ...asCovering];
  }, [coveragesAll, shiftsAll, currentUser]);

  const baseData = useMemo(() => {
    const openRequests = swapRequestsAll.filter((r) => isOpenStatus(r.status));
    // Head2Head requests are still full-shift swaps (just targeted at a
    // specific person's shift instead of open to anyone), so they belong
    // in the same "בקשות להחלפה מלאה" bucket as plain Full requests.
    const fullRequests = openRequests.filter((r) =>
      ["Full", "Head2Head", "General"].includes(r.request_type),
    );
    const partialRequests = openRequests.filter(
      (r) => r.request_type === "Partial",
    );
    const approvedReqs = swapRequestsAll.filter((r) =>
      ["Completed", "Closed"].includes(r.status),
    );

    switch (type) {
      case "swap_requests":
        return enrichRequestsWithShiftInfo(fullRequests);
      case "partial_gaps":
        return partialGapItems.length
          ? partialGapItems
          : enrichRequestsWithShiftInfo(partialRequests);
      case "approved": {
        // Partial swaps that already have at least one accepted coverage
        // window, even if the rest of the shift is still open — these are
        // real "swaps that happened" too, just not finished yet, and this
        // list stays live via the shared ['coverages']/['swap-requests']
        // query cache, so it updates as soon as someone else accepts more.
        const inProgressPartials = partialGapItems
          .filter((item) => item.coverageSegments?.length > 0)
          .map((item) => ({ ...item, is_partial_in_progress: true }));
        return [
          ...enrichRequestsWithShiftInfo(approvedReqs),
          ...inProgressPartials,
        ];
      }
      case "my_shifts":
        return enrichShiftsWithUserInfo(futureShifts);
      default:
        return [];
    }
  }, [
    enrichRequestsWithShiftInfo,
    enrichShiftsWithUserInfo,
    futureShifts,
    partialGapItems,
    swapRequestsAll,
    type,
  ]);

  const sortedData = useMemo(() => {
    const items = [...baseData];

    if (type === "approved") {
      items.sort((a, b) => {
        const bDate = getLatestActivityDate(b)?.getTime() || 0;
        const aDate = getLatestActivityDate(a)?.getTime() || 0;
        return bDate - aDate;
      });
      return items;
    }

    items.sort((a, b) => {
      const aTime = getStartDateTime(a)?.getTime() ?? Infinity;
      const bTime = getStartDateTime(b)?.getTime() ?? Infinity;
      return aTime - bTime;
    });

    return items;
  }, [baseData, type]);

  const handleAddToCalendar = (item) => {
    if (actionsDisabled) return;

    const title = "משמרת רז״ר תורן";
    const description = "משמרת נעימה 💪🏼";

    const startDateStr = item.start_date || item.shift_date;
    const endDateStr = item.end_date || startDateStr;
    const startTime = item.start_time || item.req_start_time || "09:00";
    const endTime = item.end_time || item.req_end_time || startTime;

    const startDateTime = new Date(`${startDateStr}T${startTime}`);
    const endDateTime = new Date(`${endDateStr}T${endTime}`);

    const formatForCalendar = (dateObj, fallbackDateStr) => {
      if (dateObj && !isNaN(dateObj))
        return format(dateObj, "yyyyMMdd'T'HHmmss");
      return fallbackDateStr ? fallbackDateStr.replace(/-/g, "") : "";
    };

    const startFormatted = formatForCalendar(startDateTime, startDateStr);
    const endFormatted = formatForCalendar(
      endDateTime,
      endDateStr || startDateStr,
    );

    const gCalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&details=${encodeURIComponent(description)}&dates=${startFormatted}/${endFormatted}`;
    window.open(gCalUrl, "_blank");
  };

  const handleRequestSwap = (item) => {
    if (actionsDisabled) return;
    onClose();
    if (onRequestSwap) {
      onRequestSwap(item);
    }
  };

  const getApprovalUrl = (item) => {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    return `${base}/approve/${item.shift_id || item.shift_ids?.[0] || item.id || ""}`;
  };

  const handleReshareWhatsapp = (item) => {
    const message = buildSwapTemplate({
      employeeName: item.user_name,
      startDate: item.start_date || item.shift_date,
      startTime: item.start_time || item.req_start_time || "09:00",
      endDate: item.end_date || item.shift_date,
      endTime:
        item.end_time || item.req_end_time || item.req_start_time || "09:00",
      approvalUrl: getApprovalUrl(item),
    });
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank");
  };

  // --- Render ---
  const getTitleAndColor = () => {
    switch (type) {
      case "swap_requests":
        return {
          title: "בקשות להחלפה",
          color: "from-red-500 to-red-600",
          textColor: "text-white",
        };
      case "partial_gaps":
        return {
          title: "משמרות בפער חלקי",
          color: "from-yellow-500 to-yellow-600",
          textColor: "text-white",
        };
      case "approved":
        return {
          title: "החלפות שבוצעו",
          color: "from-green-500 to-green-600",
          textColor: "text-white",
        };
      case "my_shifts":
        return {
          title: "המשמרות העתידיות שלי",
          color: "from-[#a9def9] to-[#a9def9]",
          textColor: "text-[#0b3a5e]",
        };
      default:
        return { title: "", color: "", textColor: "text-white" };
    }
  };

  const { title, color, textColor } = getTitleAndColor();
  const secondaryHeaderText =
    type === "my_shifts" ? "text-[#0b3a5e]/80" : "text-white/90";
  const isFutureShiftsView = type === "my_shifts";
  const filteredItems = useMemo(() => {
    if (type === "swap_requests") {
      if (swapTab === "mine")
        return sortedData.filter(
          (item) => item.requesting_user_id === currentUser?.serial_id,
        );
      if (swapTab === "incoming") {
        // Head2Head requests where one of the offered/target shifts is mine —
        // i.e. someone else is proposing to swap with me specifically.
        return sortedData.filter(
          (item) =>
            item.requesting_user_id !== currentUser?.serial_id &&
            item.offered_shifts?.some(
              (s) => s.original_user_id === currentUser?.serial_id,
            ),
        );
      }
      return sortedData;
    }

    if (type === "partial_gaps" && partialGapsTab === "mine") {
      // Shifts the user owns — covering someone else's gap belongs under the
      // separate "covering" tab instead.
      return sortedData.filter(
        (item) => item.original_user_id === currentUser?.serial_id,
      );
    }

    if (type === "partial_gaps" && partialGapsTab === "covering") {
      return sortedData.filter((item) =>
        item.covering_user_ids?.includes(currentUser?.serial_id),
      );
    }

    return sortedData;
  }, [currentUser?.serial_id, partialGapsTab, sortedData, swapTab, type]);

  const displayedItems = filteredItems.slice(0, visibleCount);
  const hasMore = filteredItems.length > visibleCount;

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
        >
          <div className={`bg-gradient-to-r ${color} p-6 ${textColor}`}>
            <button
              onClick={onClose}
              className="absolute top-4 left-4 p-2 rounded-full hover:bg-white/20 transition-colors text-current"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-2xl font-bold">{title}</h2>
            <p className={`${secondaryHeaderText} text-sm mt-1`}>
              {sortedData.length} רשומות
            </p>
          </div>

          <div className="flex-1 p-6 max-h-[60vh] overflow-y-auto">
            {type === "swap_requests" && (
              <div className="flex items-center gap-2 mb-4">
                <Button
                  variant={swapTab === "all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSwapTab("all")}
                  className="flex-1"
                >
                  כל הבקשות הפתוחות
                </Button>
                <Button
                  variant={swapTab === "mine" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSwapTab("mine")}
                  className="flex-1"
                >
                  הבקשות שלי
                </Button>
                <Button
                  variant={swapTab === "incoming" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSwapTab("incoming")}
                  className="flex-1"
                >
                  בקשות אליי
                </Button>
              </div>
            )}
            {type === "partial_gaps" && (
              <div className="flex items-center gap-2 mb-4">
                <Button
                  variant={partialGapsTab === "all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPartialGapsTab("all")}
                  className="flex-1"
                >
                  כל הפערים החלקיים
                </Button>
                <Button
                  variant={partialGapsTab === "mine" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPartialGapsTab("mine")}
                  className="flex-1"
                >
                  הפערים שלי
                </Button>
                <Button
                  variant={
                    partialGapsTab === "covering" ? "default" : "outline"
                  }
                  size="sm"
                  onClick={() => setPartialGapsTab("covering")}
                  className="flex-1"
                >
                  משמרות שאני מכסה
                </Button>
              </div>
            )}
            {isLoading ? (
              <div className="space-y-3" aria-label="טעינת נתונים">
                <LoadingSkeleton className="h-16 w-full" />
                <LoadingSkeleton className="h-16 w-full" />
                <LoadingSkeleton className="h-16 w-full" />
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <div className="mx-auto w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                  <AlertCircle className="w-6 h-6 text-gray-400" />
                </div>
                <p className="font-semibold">אין נתונים להצגה</p>
                <p className="text-sm text-gray-400">
                  המשימות יופיעו כאן ברגע שיהיו
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {displayedItems.map((item, idx) => {
                  const isMyRequest =
                    item.requesting_user_id === currentUser?.serial_id;
                  const isPartial =
                    (item.request_type || "").toLowerCase() === "partial";
                  // Head2Head request where one of the offered/target shifts belongs to me —
                  // i.e. someone is proposing to trade with me specifically, and I can accept/decline it.
                  const isIncomingHeadToHead =
                    item.request_type === "Head2Head" &&
                    !isMyRequest &&
                    item.offered_shifts?.some(
                      (s) => s.original_user_id === currentUser?.serial_id,
                    );
                  // Whether the viewer owns this partial-gap shift, or
                  // joined it as a covering user — each gets a different
                  // cancel action (give up the whole request vs. just their
                  // own claimed window). Compared via Number() because
                  // original_user_id can come from the raw Shift record
                  // (occasionally stored as a string) while
                  // currentUser.serial_id is numeric.
                  const currentUserIdNum = Number(currentUser?.serial_id);
                  // The info blocks (who's covering so far / what's still
                  // uncovered) are useful anywhere a partial-gap item shows
                  // up, including in-progress partials surfaced under the
                  // "approved" KPI.
                  const isPartialGapLike =
                    type === "partial_gaps" || item.is_partial_in_progress;
                  // Actions (cancel my request / cancel my coverage / offer
                  // to cover) are read-only history once an item is in the
                  // "approved" list — even an in-progress partial there is
                  // being shown for its record, not to be acted on, so this
                  // is intentionally NOT the same as isPartialGapLike above.
                  const isPartialGapActionable = type === "partial_gaps";
                  // Gated on requesting_user_id (whoever actually created the
                  // SwapRequest), not original_user_id (the shift's owner) —
                  // those can differ (e.g. an admin filing the request on the
                  // owner's behalf), and cancelling only makes sense for
                  // whoever actually filed it.
                  // Covering users can't self-cancel a partial pick — only
                  // the owner can undo the whole request (matches
                  // ShiftDetailsModal's canCancelCoverage/!isPartialLike
                  // rule).
                  const isPartialGapOwner =
                    isPartialGapActionable &&
                    Number(item.requesting_user_id) === currentUserIdNum;
                  // Real backing SwapRequest entities carry a status field;
                  // the synthetic partial-gap fallback item (built when there's
                  // no live request, just leftover coverage rows) doesn't.
                  const hasBackingRequest = Boolean(item.status);
                  // General/open swap request (request_type 'General') created
                  // via the switch flow's "send as general request" skip path —
                  // open to everyone: any other user can take the offered shifts
                  // outright ("accept without terms") or reply with a head-to-
                  // head counter-offer; the owner can cancel it.
                  const isGeneralRequestOpen =
                    item.request_type === "General" &&
                    isOpenStatus(item.status);
                  const isGeneralRequestForOthers =
                    isGeneralRequestOpen && !isMyRequest;
                  const isGeneralRequestMine =
                    isGeneralRequestOpen && isMyRequest;

                  const startDate =
                    item.start_date || item.shift_date || item.req_start_date;
                  const endDate =
                    item.end_date || item.req_end_date || startDate;
                  const startTime =
                    item.start_time || item.req_start_time || "09:00";
                  const endTime =
                    item.end_time || item.req_end_time || startTime;
                  const dayName = getDisplayDay(startDate);
                  const tone = (() => {
                    if (type !== "my_shifts") return { wrapper: "", label: "" };
                    const normalizedStatus = (item.status || "").toLowerCase();
                    const isPartialShift =
                      normalizedStatus === "partial" ||
                      item.coverageType === "partial" ||
                      item.swap_type === "partial";
                    const isRequested =
                      normalizedStatus === "swap_requested" ||
                      normalizedStatus === "requested";
                    const isCovered =
                      normalizedStatus === "covered" ||
                      item.ownership === "covering";

                    if (isRequested)
                      return {
                        wrapper: "bg-red-50 border-red-200",
                        label: "בקשת החלפה",
                      };
                    if (isPartialShift)
                      return {
                        wrapper: "bg-yellow-50 border-yellow-200",
                        label: "כיסוי חלקי",
                      };
                    if (isCovered)
                      return {
                        wrapper: "bg-green-50 border-green-200",
                        label: "כיסוי מלא",
                      };
                    if (item.ownership === "mine")
                      return {
                        wrapper: "bg-[#e6f4ff] border-[#a9def9]",
                        label: "המשמרת שלי",
                      };
                    return { wrapper: "bg-white", label: "" };
                  })();

                  return (
                    <div
                      key={item.id || idx}
                      className={`bg-gray-50 rounded-xl p-4 border border-gray-200 hover:shadow-md transition-all ${tone.wrapper}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Calendar className="w-4 h-4 text-gray-500" />
                            <span className="font-semibold text-gray-800">
                              {startDate
                                ? format(new Date(startDate), "dd/MM/yyyy")
                                : "תאריך לא ידוע"}
                            </span>
                            {dayName && (
                              <span className="text-sm text-gray-500">
                                ({dayName})
                              </span>
                            )}
                            {item.shift_count > 1 && (
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200">
                                {item.shift_count} משמרות
                              </span>
                            )}
                            {item.request_type === "Head2Head" && (
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200">
                                ראש בראש
                              </span>
                            )}
                            {item.request_type === "General" && (
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 border border-teal-200">
                                כללית
                              </span>
                            )}
                            {item.request_type === "Full" && (
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                                מלאה
                              </span>
                            )}
                            {item.request_type === "Partial" && (
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 border border-yellow-200">
                                חלקית
                              </span>
                            )}
                          </div>

                          <p className="text-sm text-gray-800 font-medium">
                            {item.user_name}
                          </p>

                          {item.shift_count > 1 &&
                            item.original_shifts?.length > 0 && (
                              <div className="mt-1 text-xs text-gray-500 space-y-0.5">
                                {item.original_shifts.map((s) => (
                                  <p key={s.id} dir="ltr">
                                    {s.start_date}
                                    {s.start_time
                                      ? ` ${s.start_time}-${s.end_time || ""}`
                                      : ""}
                                  </p>
                                ))}
                              </div>
                            )}

                          {item.request_type === "Head2Head" &&
                            item.is_closed_request &&
                            item.accepted_by_names?.length > 0 && (
                              <div className="mt-2 text-[11px] text-green-800 bg-green-50 border border-green-200 rounded-lg p-2">
                                <p className="font-semibold">
                                  ✓ ההחלפה אושרה — {item.user_name} ↔{" "}
                                  {item.accepted_by_names.join(", ")}
                                </p>
                              </div>
                            )}

                          {item.request_type === "Head2Head" &&
                            !item.is_closed_request &&
                            item.offered_shifts?.length > 0 && (
                              <div className="mt-2 text-[11px] text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-lg p-2 space-y-0.5">
                                <p className="font-semibold mb-1">
                                  מוצע בתמורה למשמרת של:
                                </p>
                                {item.offered_shifts.map((s) => (
                                  <p
                                    key={s.id}
                                    className="flex justify-between text-xs"
                                    dir="ltr"
                                  >
                                    <span>{s.owner_name}</span>
                                    <span>
                                      {s.start_date} {s.start_time}-
                                      {s.end_time || ""}
                                    </span>
                                  </p>
                                ))}
                              </div>
                            )}

                          {tone.label && (
                            <span className="inline-block mt-1 text-[11px] px-2 py-1 rounded-full bg-white/70 text-gray-700 border border-gray-200">
                              {tone.label}
                            </span>
                          )}

                          {(type !== "approved" ||
                            item.is_partial_in_progress) && (
                            <div className="mt-1 grid grid-cols-2 gap-1 text-sm text-gray-600">
                              <div className="flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" /> {startTime}
                              </div>
                              <div className="flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" /> {endTime}
                              </div>
                              <div className="text-sm text-gray-500">
                                התחלה: {startDate}
                              </div>
                              <div className="text-sm text-gray-500">
                                סיום: {endDate}
                              </div>
                            </div>
                          )}

                          {isPartialGapLike &&
                            item.coverageSegments?.length > 0 && (
                              <div className="mt-2 bg-green-50 border border-green-200 rounded-lg p-2">
                                <p className="font-semibold text-green-800 text-xs mb-1">
                                  מי מכסה עד כה
                                </p>
                                <div className="space-y-1">
                                  {item.coverageSegments.map((seg, segIdx) => {
                                    const coveringUser = authorizedUsers.find(
                                      (u) =>
                                        Number(u.serial_id) ===
                                        Number(seg.covering_user_id),
                                    );
                                    return (
                                      <p
                                        key={`partial-seg-${segIdx}`}
                                        className="flex justify-between text-xs text-green-700"
                                        dir="ltr"
                                      >
                                        <span>
                                          {coveringUser?.full_name || "מחליף"}
                                        </span>
                                        <span>
                                          {format(seg.start, "HH:mm")} -{" "}
                                          {format(seg.end, "HH:mm")}
                                        </span>
                                      </p>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                          {isPartialGapLike &&
                            item.missingSegments?.length > 0 && (
                              <div className="mt-2 text-xs text-yellow-800 bg-yellow-100 border border-yellow-200 rounded-lg p-2">
                                <p className="font-semibold mb-1">
                                  חלונות לא מכוסים
                                </p>
                                {item.missingSegments.map((seg, gapIdx) => (
                                  <p key={`gap-${gapIdx}`} dir="ltr">
                                    {format(seg.start, "HH:mm")} -{" "}
                                    {format(seg.end, "HH:mm")}
                                  </p>
                                ))}
                              </div>
                            )}

                          {type === "approved" && item.original_shift && (
                            <div className="mt-2 space-y-1.5">
                              <SwapTransition
                                item={item}
                                authorizedUsers={authorizedUsers}
                              />
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col gap-2 flex-shrink-0 items-end">
                          {type === "swap_requests" && isMyRequest && (
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="icon"
                                className="rounded-full"
                                onClick={() => requestCancelConfirm(item)}
                                disabled={actionsDisabled}
                                title="בטל בקשה"
                              >
                                <XCircle className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="icon"
                                className="rounded-full text-green-600 border-green-200"
                                onClick={() => handleReshareWhatsapp(item)}
                                disabled={actionsDisabled}
                                title="שלח בוואטסאפ"
                              >
                                <MessageCircle className="w-4 h-4" />
                              </Button>
                            </div>
                          )}

                          {isPartialGapOwner && hasBackingRequest && (
                            <Button
                              variant="outline"
                              size="icon"
                              className="rounded-full text-red-600 border-red-200"
                              onClick={() => requestCancelConfirm(item)}
                              disabled={actionsDisabled}
                              title="בטל בקשת החלפה"
                            >
                              <XCircle className="w-4 h-4" />
                            </Button>
                          )}

                          {isGeneralRequestForOthers && (
                            <div className="flex gap-2">
                              <Button
                                onClick={() => {
                                  if (actionsDisabled) return;
                                  onAcceptGeneralRequest &&
                                    onAcceptGeneralRequest(item);
                                }}
                                size="sm"
                                disabled={actionsDisabled}
                                className={`bg-green-500 text-white hover:bg-green-600 px-3 h-9 ${actionsDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
                              >
                                קח את המשמרות{" "}
                                <ArrowRight className="w-4 h-4 mr-1" />
                              </Button>
                              <Button
                                onClick={() => {
                                  if (actionsDisabled) return;
                                  onStartCounterOffer &&
                                    onStartCounterOffer(item);
                                }}
                                size="sm"
                                disabled={actionsDisabled}
                                className={`bg-indigo-500 text-white hover:bg-indigo-600 px-3 h-9 ${actionsDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
                              >
                                הצע ראש בראש{" "}
                                <ArrowLeftRight className="w-4 h-4 mr-1" />
                              </Button>
                            </div>
                          )}

                          {isGeneralRequestMine && (
                            <Button
                              variant="outline"
                              size="icon"
                              className="rounded-full text-red-600 border-red-200"
                              onClick={() => requestCancelConfirm(item)}
                              disabled={actionsDisabled}
                              title="בטל בקשת החלפה"
                            >
                              <XCircle className="w-4 h-4" />
                            </Button>
                          )}

                          {item.is_request_object &&
                            !isMyRequest &&
                            type !== "approved" &&
                            item.request_type !== "Head2Head" &&
                            item.request_type !== "General" &&
                            // Already covering part of this shift? Then this
                            // isn't the "offer to cover" flow for them anymore
                            // (that's handled from the shift details modal /
                            // cancel-my-coverage path instead).
                            !(item.covering_user_ids || [])
                              .map(Number)
                              .includes(currentUserIdNum) && (
                              <Button
                                onClick={() => {
                                  if (actionsDisabled) return;
                                  onClose();
                                  // Route through the actual Shift record (not
                                  // the enriched SwapRequest item) so this opens
                                  // the same AcceptSwapModal flow as clicking the
                                  // shift cell directly on the calendar.
                                  onOfferCover(item.original_shift || item);
                                }}
                                size="sm"
                                disabled={actionsDisabled}
                                className={`bg-blue-500 text-white hover:bg-blue-600 px-3 h-9 ${actionsDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
                              >
                                אחליף <ArrowRight className="w-4 h-4 mr-1" />
                              </Button>
                            )}

                          {isIncomingHeadToHead && (
                            <div className="flex gap-2">
                              <Button
                                onClick={() => {
                                  if (actionsDisabled) return;
                                  onAcceptHeadToHead &&
                                    onAcceptHeadToHead(item);
                                }}
                                size="sm"
                                disabled={actionsDisabled}
                                className={`bg-green-500 text-white hover:bg-green-600 px-3 h-9 ${actionsDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
                              >
                                קבל <CheckCircle2 className="w-4 h-4 mr-1" />
                              </Button>
                              <Button
                                variant="outline"
                                size="icon"
                                className="rounded-full text-red-600 border-red-200"
                                onClick={() => requestCancelConfirm(item, true)}
                                disabled={actionsDisabled}
                                title="דחה בקשה"
                              >
                                <XCircle className="w-4 h-4" />
                              </Button>
                            </div>
                          )}

                          {(item.is_shift_object || isMyRequest) && (
                            <div className="flex gap-2">
                              <Button
                                onClick={() => handleAddToCalendar(item)}
                                size="icon"
                                variant={
                                  isFutureShiftsView ? "default" : "outline"
                                }
                                disabled={actionsDisabled}
                                className={`rounded-full w-10 h-10 ${isFutureShiftsView ? "bg-[#a9def9] text-[#0b3a5e] hover:bg-[#8cd3f6]" : "border-blue-200 text-blue-600 hover:bg-blue-50"} transition-colors shadow-sm ${actionsDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
                              >
                                <CalendarPlus className="w-5 h-5" />
                              </Button>
                              {isFutureShiftsView && item.is_shift_object && (
                                <Button
                                  onClick={() => handleReshareWhatsapp(item)}
                                  size="icon"
                                  disabled={actionsDisabled}
                                  className={`rounded-full w-10 h-10 bg-[#25D366] hover:bg-[#128C7E] text-white shadow-sm ${actionsDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
                                  title="שיתוף הבקשה מחדש בוואטסאפ"
                                >
                                  <Send className="w-5 h-5" />
                                </Button>
                              )}
                              {item.is_shift_object && (
                                <Button
                                  onClick={() => handleRequestSwap(item)}
                                  size="icon"
                                  disabled={actionsDisabled}
                                  className={`rounded-full w-10 h-10 ${isFutureShiftsView ? "bg-[#a9def9] text-[#0b3a5e] hover:bg-[#8cd3f6]" : "bg-red-500 hover:bg-red-600 text-white"} shadow-sm ${actionsDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
                                >
                                  <ArrowLeftRight className="w-5 h-5" />
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {hasMore && (
                  <div className="pt-2 flex justify-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setVisibleCount((prev) => prev + 10)}
                      className="text-gray-500 hover:text-gray-800 hover:bg-gray-100 w-full"
                    >
                      <ChevronDown className="w-4 h-4 mr-2" /> הצג עוד
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Cancel/decline swap request confirmation */}
      <Dialog
        open={!!pendingCancelAction}
        onOpenChange={(open) => !open && setPendingCancelAction(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingCancelAction?.isDecline
                ? "דחיית בקשת החלפה"
                : "ביטול בקשת החלפה"}
            </DialogTitle>
            <DialogDescription>
              {pendingCancelAction?.isDecline
                ? "האם אתה בטוח שברצונך לדחות את בקשת ההחלפה? הפעולה לא ניתנת לביטול."
                : "האם אתה בטוח שברצונך לבטל את בקשת ההחלפה? הפעולה לא ניתנת לביטול."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingCancelAction(null)}
            >
              ביטול
            </Button>
            <Button variant="destructive" onClick={handleConfirmCancel}>
              {pendingCancelAction?.isDecline ? "כן, דחה בקשה" : "כן, בטל בקשה"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AnimatePresence>
  );
}