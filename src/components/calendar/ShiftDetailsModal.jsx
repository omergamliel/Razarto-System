import React, { useEffect, useMemo, useState } from "react";
import { format, addDays, differenceInMinutes } from "date-fns";
import { he } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Calendar,
  Clock,
  User,
  Trash2,
  CheckCircle,
  AlertCircle,
  CalendarPlus,
  Send,
  UserRoundPen,
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import {
  buildShiftDeepLink,
  buildSwapTemplate,
  calculateMissingSegments,
  resolveSwapType,
  buildDateTime,
  computeCoverageSummary,
  getCoverageColor,
  subtractSegments,
} from "./whatsappTemplates";
import { useHolidays } from "./useHolidays";
import LoadingSkeleton from "../LoadingSkeleton";

export default function ShiftDetailsModal({
  isOpen,
  onClose,
  shift,
  date,
  onOfferCover,
  onHeadToHead,
  onCancelRequest,
  onCancelCoverage,
  onDelete,
  onApprove,
  onRequestSwap,
  currentUser,
  isAdmin,
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCancelRequestConfirm, setShowCancelRequestConfirm] =
    useState(false);
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");

  const queryClient = useQueryClient();

  // --- Fetch Active Request Info ---
  const { data: activeRequest, isLoading: isActiveRequestLoading } = useQuery({
    queryKey: ["shift-active-request-details", shift?.id],
    queryFn: async () => {
      if (!shift?.id) return null;
      // Fetch all requests and filter client-side (not just "Open") — once
      // someone partially covers this shift, the request's status flips to
      // "Partially_Covered" and a server-side status:"Open" filter would
      // miss it entirely, hiding the still-active request from this modal.
      const reqs = await base44.entities.SwapRequest.list();
      const match = reqs.find(
        (r) => r.shift_ids?.includes(shift.id) && r.status !== "Cancelled",
      );
      return match || null;
    },
    enabled: !!shift?.id && isOpen,
  });

  // --- Fetch Coverages (by shift to respect coverage ownership) ---
  const { data: coverages = [], isLoading: isCoveragesLoading } = useQuery({
    queryKey: ["shift-coverages-details", shift?.id],
    queryFn: async () => {
      if (!shift?.id) return [];
      return await base44.entities.ShiftCoverage.filter({ shift_id: shift.id });
    },
    enabled: !!shift?.id && isOpen,
  });

  const { data: authorizedUsers = [] } = useQuery({
    queryKey: ["authorized-users"],
    queryFn: () => base44.entities.AuthorizedPerson.list(),
    enabled: showReassignModal,
  });

  const reassignMutation = useMutation({
    mutationFn: async (newUserId) => {
      // Reassigning hands the WHOLE shift to the new person — so any
      // in-progress (or already fully-covered) partial swap request and the
      // coverage grants tied to it no longer apply. Cancel it regardless of
      // its status (Open/Partially_Covered/Closed) — leaving a "Closed"
      // request in place would keep being found as this shift's active
      // request by this modal's own query (which, unlike
      // normalizeShiftContext's lookup, doesn't check whether the request
      // still belongs to the shift's current owner), permanently showing
      // stale partial-shift UI after the reassignment.
      if (
        resolvedActiveRequest &&
        resolvedActiveRequest.status !== "Cancelled"
      ) {
        await base44.entities.SwapRequest.update(resolvedActiveRequest.id, {
          status: "Cancelled",
        });
      }
      await Promise.all(
        coverages
          .filter((c) => c.status === "Approved" || !c.status)
          .map((c) =>
            base44.entities.ShiftCoverage.update(c.id, {
              status: "Cancelled",
            }),
          ),
      );
      return base44.entities.Shift.update(shift.id, {
        original_user_id: parseInt(newUserId, 10),
        status: "Active",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);
      queryClient.invalidateQueries(["coverages"]);
      // This modal keeps its own local queries (unlike cancelSwapMutation's
      // callers, it doesn't close afterwards), keyed separately from the
      // app-wide ["swap-requests"]/["coverages"] lists above — those must be
      // invalidated too, or this modal keeps showing the pre-reassignment
      // partial-shift UI even though the underlying request was cancelled.
      queryClient.invalidateQueries(["shift-active-request-details"]);
      queryClient.invalidateQueries(["shift-coverages-details"]);
      toast.success("המשמרת הועברה למשתמש החדש");
      setShowReassignModal(false);
      setSelectedUserId("");
    },
    onError: () => {
      toast.error("אירעה שגיאה בעת עדכון המשמרת");
    },
  });

  useEffect(() => {
    if (isOpen && shift) {
      setSelectedDepartment(shift.department || "");
      setSelectedUserId("");
    }
  }, [isOpen, shift]);

  const resolvedActiveRequest = useMemo(
    () =>
      isActiveRequestLoading
        ? (shift?.active_request ?? null)
        : (activeRequest ?? null),
    [activeRequest, isActiveRequestLoading, shift],
  );
  const resolvedSwapType = useMemo(
    () =>
      resolvedActiveRequest
        ? resolveSwapType(shift, resolvedActiveRequest)
        : "full",
    [resolvedActiveRequest, shift],
  );
  const coverageSummary = useMemo(
    () =>
      computeCoverageSummary({
        shift,
        activeRequest: resolvedActiveRequest,
        coverages,
      }),
    [coverages, resolvedActiveRequest, shift],
  );
  const requestWindow = coverageSummary.requestWindow;
  const shiftWindow = coverageSummary.shiftWindow;

  const departments = useMemo(() => {
    return [...new Set(authorizedUsers.map((u) => u.department))]
      .filter(Boolean)
      .sort();
  }, [authorizedUsers]);

  const departmentUsers = useMemo(() => {
    return selectedDepartment
      ? authorizedUsers.filter((u) => u.department === selectedDepartment)
      : [];
  }, [authorizedUsers, selectedDepartment]);

  // --- Fetch Covering Users Info (to show names) ---
  const { data: coveringUsers = [] } = useQuery({
    queryKey: ["covering-users-info", coverages],
    queryFn: async () => {
      if (coverages.length === 0) return [];
      const userIds = coverages.map((c) => c.covering_user_id);
      // Assuming we can fetch multiple or fetch all and filter
      // Optimized: Fetch all authorized (cached)
      const allAuth = await base44.entities.AuthorizedPerson.list();
      return allAuth.filter((u) => userIds.includes(u.serial_id));
    },
    enabled: coverages.length > 0,
  });

  const handleDelete = () => {
    if (!shift?.id) return;
    onDelete(shift.id);
    setShowDeleteConfirm(false);
  };

  const handleCancelRequestConfirm = () => {
    onCancelRequest?.(shift);
    setShowCancelRequestConfirm(false);
  };

  const shiftStartDate = shiftWindow?.startDate || shift?.start_date || date;
  const shiftEndDate =
    shiftWindow?.endDate || shift?.end_date || shiftStartDate;

  // Determine State
  const isSwapMode = !!resolvedActiveRequest;
  const isPartial = resolvedSwapType === "partial";
  const isFull = resolvedSwapType === "full";
  const isPartialLike =
    isSwapMode &&
    (isPartial ||
      shift?.status === "partial" ||
      shift?.coverageType === "partial");
  const isDetailsLoading = isActiveRequestLoading || isCoveragesLoading;

  const userEmail = currentUser?.email || currentUser?.Email;
  const isOwnShift = Boolean(
    currentUser?.serial_id
      ? // Number() guards against original_user_id occasionally being stored
        // as a string on older/imported Shift records, which would silently
        // break this comparison (and every button gated on it) for a real
        // owner viewing their own shift.
        Number(shift?.original_user_id) === Number(currentUser.serial_id)
      : (userEmail && shift?.assigned_email === userEmail) ||
          (currentUser?.full_name &&
            shift?.user_name === currentUser.full_name),
  );
  const ownerDisplayName =
    shift?.original_user_name ||
    shift?.user_name ||
    shift?.assigned_person ||
    "לא ידוע";

  const startTime = shiftWindow?.startTime || shift?.start_time || "09:00";
  const endTime = shiftWindow?.endTime || shift?.end_time || "09:00";
  const startDateObj = shiftStartDate
    ? new Date(shiftStartDate)
    : new Date(date || new Date());

  let endDateObj;
  if (shiftEndDate) {
    endDateObj = new Date(shiftEndDate);
  } else {
    const sH = parseInt(startTime.split(":")[0]);
    const eH = parseInt(endTime.split(":")[0]);
    if (eH < sH || (sH === 9 && eH === 9)) {
      endDateObj = addDays(startDateObj, 1);
    } else {
      endDateObj = startDateObj;
    }
  }

  // Holiday label for this shift's date (shown in purple, matching the
  // calendar cell), so a holiday shift is still identifiable inside the
  // details modal.
  const holidayYears = useMemo(() => {
    const years = new Set();
    if (shiftStartDate) years.add(new Date(shiftStartDate).getFullYear());
    if (shiftEndDate) years.add(new Date(shiftEndDate).getFullYear());
    return Array.from(years);
  }, [shiftStartDate, shiftEndDate]);
  const { data: holidaysData } = useHolidays(holidayYears);
  const shiftHolidayName = useMemo(() => {
    const labels = holidaysData?.labels || {};
    return labels[shiftStartDate] || labels[shiftEndDate] || null;
  }, [holidaysData, shiftStartDate, shiftEndDate]);

  // Same staleness guard as resolvedSwapType/isPartialLike: only trust the
  // shift's own coverageType/swap_type fields while there's an actual
  // backing request. Without one, it's unambiguously a full shift.
  const coverageType = isSwapMode
    ? shift?.coverageType || shift?.swap_type || resolvedSwapType
    : "full";
  const approvedCoverages = coverageSummary.approvedCoverages;
  const hasCoverages = approvedCoverages.length > 0;
  const isCoveredSwap =
    (shift?.status === "covered" || shift?.status === "Covered") &&
    hasCoverages;
  const statusLabelClasses = isPartial
    ? "bg-yellow-100 text-yellow-900 border border-yellow-200"
    : "bg-red-100 text-red-900 border border-red-200";

  const requestStartStr = requestWindow.startTime;
  const requestEndStr = requestWindow.endTime;
  const requestStartDate = requestWindow.startDate || shiftStartDate;
  const requestEndDate =
    requestWindow.endDate || shiftEndDate || requestStartDate;

  const coverageRows = useMemo(() => {
    return approvedCoverages
      .map((cov, idx) => {
        const user = coveringUsers.find(
          (u) => u.serial_id === cov.covering_user_id,
        );
        const start = buildDateTime(
          cov.cover_start_date || requestStartDate,
          cov.cover_start_time || requestStartStr,
        );
        let end = buildDateTime(
          cov.cover_end_date || requestEndDate,
          cov.cover_end_time || requestEndStr,
        );
        if (!start || !end) return null;
        if (end <= start) end = addDays(end, 1);
        return {
          id: cov.id || idx,
          name: user?.full_name || cov.covering_name || "מתנדב",
          start,
          end,
          department: user?.department || cov.covering_department,
          createdAt: cov.created_at || cov.created_date || null,
        };
      })
      .filter(Boolean);
  }, [
    approvedCoverages,
    coveringUsers,
    requestEndDate,
    requestEndStr,
    requestStartDate,
    requestStartStr,
  ]);

  // FIXED: Identify covering user for full swap view
  const primaryCoverage = useMemo(() => {
    return (
      approvedCoverages.find((cov) => cov.type === "Full") ||
      approvedCoverages[0]
    );
  }, [approvedCoverages]);

  const coveringUserName = useMemo(() => {
    if (!primaryCoverage) return shift?.user_name;
    const user = coveringUsers.find(
      (u) => u.serial_id === primaryCoverage.covering_user_id,
    );
    return user?.full_name || shift?.user_name;
  }, [coveringUsers, primaryCoverage, shift?.user_name]);

  const coveringDepartment = useMemo(() => {
    if (!primaryCoverage) return shift?.department;
    const user = coveringUsers.find(
      (u) => u.serial_id === primaryCoverage.covering_user_id,
    );
    return user?.department || shift?.department;
  }, [coveringUsers, primaryCoverage, shift?.department]);
  const ownerDepartment =
    shift?.department || shift?.original_user_data?.department || "";
  const assignedDisplayName =
    resolvedSwapType === "full" && primaryCoverage
      ? coveringUserName
      : ownerDisplayName;
  const assignedDepartment =
    resolvedSwapType === "full" && primaryCoverage
      ? coveringDepartment
      : ownerDepartment;

  const missingSegments = useMemo(() => {
    if (!isPartialLike) return [];
    return coverageSummary.missingSegments;
  }, [coverageSummary.missingSegments, isPartialLike]);

  const isRequestFullyCovered =
    isPartialLike &&
    approvedCoverages.length > 0 &&
    missingSegments.length === 0;
  const derivedStatus = useMemo(() => {
    const rawStatus = String(shift?.status || "").toLowerCase();
    if (isCoveredSwap || rawStatus === "covered" || isRequestFullyCovered)
      return "covered";
    if (coverageType === "partial") return "partial";
    if (rawStatus === "requested" || rawStatus === "swap_requested")
      return "requested";
    return shift?.status || "regular";
  }, [
    coverageType,
    isCoveredSwap,
    isRequestFullyCovered,
    missingSegments.length,
    shift?.status,
  ]);

  const isFullyCovered = derivedStatus === "covered";
  const requestStatus = resolvedActiveRequest?.status;
  const hasAnyRequest = Boolean(resolvedActiveRequest);
  // "Partially_Covered" is still an active, offer-able request — only
  // "Closed"/"Cancelled" (excluded via isCoveredOrClosed below) truly stop it.
  const hasActiveRequest = ["Open", "Partially_Covered"].includes(
    requestStatus,
  );
  const isPartialRequest = hasAnyRequest && resolvedSwapType === "partial";
  const isFullRequest = hasAnyRequest && resolvedSwapType === "full";
  const isRequestOwner =
    Boolean(
      resolvedActiveRequest?.requesting_user_id &&
      currentUser?.serial_id &&
      resolvedActiveRequest.requesting_user_id === currentUser.serial_id,
    ) ||
    (hasAnyRequest && !resolvedActiveRequest?.requesting_user_id && isOwnShift);
  const isWhiteShift = !hasAnyRequest;
  const isCoveredOrClosed =
    isFullyCovered ||
    requestStatus === "Closed" ||
    String(shift?.status || "").toLowerCase() === "covered";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isPastShift = startDateObj < today;

  // The current user's own approved coverage on this shift, if they joined
  // a partial swap — lets them back out and hand their window back to the
  // original owner, regardless of whether the shift has since become fully
  // covered (backing out should reopen that gap, not be blocked by it).
  const myCoverageEntry = useMemo(
    () =>
      coverages.find(
        (c) =>
          Number(c.covering_user_id) === Number(currentUser?.serial_id) &&
          (c.status === "Approved" || !c.status),
      ) || null,
    [coverages, currentUser?.serial_id],
  );
  // Once someone has committed to helping with a partial gap, they can no
  // longer back out via self-service (only the shift owner can undo the
  // whole request via "ביטול בקשת החלפה") — backing out of a full swap
  // takeover is still allowed.
  const canCancelCoverage =
    Boolean(myCoverageEntry) && !isPastShift && !isPartialLike;
  // The owner can undo their own swap/partial-coverage request even after it
  // was fully accepted by one or more helpers — cancelling reclaims the
  // whole shift back as a normal full shift for them, voiding whatever
  // coverage was granted. Unlike canOfferCover/canHeadToHead this must NOT
  // be blocked by isCoveredOrClosed, since "already fully covered" is
  // precisely the state this needs to be able to undo.
  const canCancelOwnSwap = isOwnShift && hasAnyRequest;

  const canOfferCover = hasActiveRequest && !isOwnShift && !isCoveredOrClosed;
  const canHeadToHead =
    !isOwnShift &&
    !isCoveredOrClosed &&
    !isPartialRequest &&
    !isPastShift &&
    (isWhiteShift || isFullRequest);
  // Missing !isPastShift here let an owner request a swap on their own
  // already-past shift via this modal, even though the ShiftActionModal
  // route (opened directly from the calendar cell) already correctly
  // blocks that — this closes that side door. Gated on !hasAnyRequest (not
  // just !hasActiveRequest) so a request that's already Closed (e.g. a
  // partial gap that got fully covered) still blocks creating a redundant
  // new one — undoing it goes through "ביטול בקשת החלפה" instead.
  const canRequestSwap = isOwnShift && !hasAnyRequest && !isPastShift;
  const canWhatsappShare = hasActiveRequest && isRequestOwner;
  const canAddToCalendarOrEmail = isOwnShift;

  const statusIndicator = useMemo(() => {
    if (derivedStatus === "covered")
      return { color: "bg-green-400", text: "מאוישת" };
    if (coverageType === "partial")
      return { color: "bg-yellow-400", text: "דורשת החלפה חלקית" };
    if (derivedStatus === "requested")
      return { color: "bg-red-500", text: "דורשת החלפה" };
    return { color: "bg-gray-400", text: "פתוחה" };
  }, [coverageType, derivedStatus]);

  const shiftStartDateTime = useMemo(
    () => buildDateTime(shiftStartDate, startTime),
    [shiftStartDate, startTime],
  );

  const shiftEndDateTime = useMemo(() => {
    const end = buildDateTime(shiftEndDate, endTime);
    if (!end || !shiftStartDateTime) return end;
    return end <= shiftStartDateTime ? addDays(end, 1) : end;
  }, [endTime, shiftEndDate, shiftStartDateTime]);

  const ownerSegments = useMemo(() => {
    if (!shiftStartDateTime || !shiftEndDateTime) return [];
    return calculateMissingSegments(
      shiftStartDateTime,
      shiftEndDateTime,
      approvedCoverages,
    );
  }, [approvedCoverages, shiftEndDateTime, shiftStartDateTime]);

  // Read-only visual track spanning the full shift — replaces the plain
  // grey "owner" card with the same at-a-glance slider used in the cover
  // flow, so it's immediately clear which windows are covered vs. still
  // with the original owner.
  const trackTotalMinutes =
    shiftStartDateTime && shiftEndDateTime
      ? differenceInMinutes(shiftEndDateTime, shiftStartDateTime)
      : 0;
  const toTrackPercent = (date) => {
    if (!shiftStartDateTime || trackTotalMinutes <= 0 || !date) return 0;
    return Math.max(
      0,
      Math.min(
        100,
        (differenceInMinutes(date, shiftStartDateTime) / trackTotalMinutes) *
          100,
      ),
    );
  };
  const trackBands = useMemo(() => {
    const covered = coverageRows.map((row) => ({
      start: row.start,
      end: row.end,
      label: row.name,
      variant: "covered",
    }));
    const remaining = ownerSegments.map((seg) => ({
      start: seg.start,
      end: seg.end,
      label: ownerDisplayName,
      variant: "original",
    }));
    return [...covered, ...remaining].sort((a, b) => a.start - b.start);
  }, [coverageRows, ownerSegments, ownerDisplayName]);

  // Assigns each distinct helper a stable, distinguishable color (by order
  // of first appearance) so multiple people covering different windows of
  // the same shift can be told apart on the track and in the legend.
  const coveringColorMap = useMemo(() => {
    const map = new Map();
    coverageRows.forEach((row) => {
      if (!map.has(row.name)) map.set(row.name, map.size);
    });
    return map;
  }, [coverageRows]);

  // Faithful history: who covered what, in the order they actually claimed
  // it (by creation time, falling back to segment start when unavailable),
  // and whether each step still left part of the shift uncovered or was the
  // one that finally completed it — instead of a hardcoded "X requested a
  // full swap, Y fully covered it" narrative that doesn't fit multi-person
  // partial coverage.
  const coverageHistory = useMemo(() => {
    if (!shiftStartDateTime || !shiftEndDateTime) return [];
    const sorted = [...coverageRows].sort((a, b) => {
      const aTime = a.createdAt
        ? new Date(a.createdAt).getTime()
        : a.start.getTime();
      const bTime = b.createdAt
        ? new Date(b.createdAt).getTime()
        : b.start.getTime();
      return aTime - bTime;
    });
    const appliedSoFar = [];
    return sorted.map((row) => {
      appliedSoFar.push(row);
      const remainingGaps = subtractSegments(
        shiftStartDateTime,
        shiftEndDateTime,
        appliedSoFar,
      );
      return { ...row, completesShift: remainingGaps.length === 0 };
    });
  }, [coverageRows, shiftEndDateTime, shiftStartDateTime]);

  const formatSegment = (start, end) => {
    const sameDay = format(start, "dd/MM") === format(end, "dd/MM");
    const datePart = sameDay
      ? format(start, "dd/MM")
      : `${format(start, "dd/MM")} → ${format(end, "dd/MM")}`;
    return `${format(start, "HH:mm")} – ${format(end, "HH:mm")} (${datePart})`;
  };

  const handleAddToCalendar = () => {
    // Google Calendar Logic... (Same as before)
    const title = `משמרת - ${shift.user_name}`;
    const gCalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}`;
    window.open(gCalUrl, "_blank");
  };

  const handleWhatsAppShare = () => {
    const approvalUrl = buildShiftDeepLink(shift.id);
    const originalOwnerName =
      shift?.original_user_data?.full_name ||
      shift?.original_user_name ||
      shift?.assigned_person ||
      shift?.user_name;
    const message = buildSwapTemplate({
      originalOwnerName,
      startDate: requestStartDate,
      startTime: requestStartStr,
      endDate: requestEndDate,
      endTime: requestEndStr,
      approvalUrl,
      shiftId: shift.id,
    });
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank");
  };

  if (!isOpen || !shift) return null;

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        dir="rtl"
      >
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
          className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div
            className={`${isFullyCovered ? "bg-green-600" : "bg-gradient-to-r from-gray-800 to-gray-900"} p-6 text-white flex-shrink-0 relative`}
          >
            <div className="absolute top-4 left-4 flex gap-2">
              {isAdmin && (
                <>
                  <button
                    onClick={() => setShowReassignModal(true)}
                    className="p-2 rounded-full hover:bg-white/20 transition-colors"
                    aria-label="החלפת משתמש"
                  >
                    <UserRoundPen className="w-5 h-5 text-blue-200" />
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="p-2 rounded-full hover:bg-white/20 transition-colors"
                  >
                    <Trash2 className="w-5 h-5 text-red-400" />
                  </button>
                </>
              )}
              <button
                onClick={onClose}
                className="p-2 rounded-full hover:bg-white/20"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="p-3 bg-white/20 rounded-xl">
                <Calendar className="w-6 h-6" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-bold">פרטי משמרת</h2>
                  <span
                    className={`w-3 h-3 rounded-full ${statusIndicator.color}`}
                    title={`סטטוס המשמרת: ${statusIndicator.text}`}
                    aria-label={`סטטוס המשמרת: ${statusIndicator.text}`}
                  />
                </div>
                {isSwapMode && (
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-tight backdrop-blur-sm ${statusLabelClasses}`}
                  >
                    {isPartial ? "בקשה לכיסוי חלקי" : "בקשה לכיסוי מלא"}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {isDetailsLoading ? (
              <div className="space-y-4" aria-label="טעינת נתוני משמרת">
                <LoadingSkeleton className="h-28 w-full" />
                <LoadingSkeleton className="h-16 w-full" />
                <LoadingSkeleton className="h-20 w-full" />
              </div>
            ) : (
              <>
                {/* Status Card + Timing */}
                <div className="text-center space-y-3">
                  <p className="text-sm text-gray-500 font-medium">
                    משובץ כרגע למשמרת
                  </p>
                  <h2 className="text-2xl font-semibold text-gray-900 leading-none">
                    {assignedDisplayName}
                  </h2>
                  {assignedDepartment && (
                    <span className="inline-flex items-center justify-center rounded-full bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-700 border border-gray-200">
                      {`מחלקה ${assignedDepartment}`}
                    </span>
                  )}
                </div>

                {shiftHolidayName && (
                  <div className="flex justify-center">
                    <span className="inline-flex items-center rounded-full bg-purple-100 text-purple-700 px-3 py-1 text-xs font-semibold border border-purple-200">
                      {shiftHolidayName}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between bg-gray-50 rounded-2xl p-1 border border-gray-100 shadow-sm">
                  {/* Start */}
                  <div className="flex-1 text-center py-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                      {format(startDateObj, "EEEE", { locale: he })}
                    </p>
                    <p className="text-xl font-bold text-gray-800 leading-none mb-1 font-mono">
                      {startTime}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {format(startDateObj, "dd/MM/yyyy")}
                    </p>
                  </div>

                  {/* Divider */}
                  <div className="flex flex-col items-center justify-center px-2 text-gray-400">
                    <Clock className="w-5 h-5" />
                  </div>

                  {/* End */}
                  <div className="flex-1 text-center py-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                      {format(endDateObj, "EEEE", { locale: he })}
                    </p>
                    <p className="text-xl font-bold text-gray-800 leading-none mb-1 font-mono">
                      {endTime}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {format(endDateObj, "dd/MM/yyyy")}
                    </p>
                  </div>
                </div>

                {isPartialLike && (
                  <div className="space-y-3">
                    <div className="rounded-2xl bg-yellow-50 border border-yellow-200 p-4 text-sm text-yellow-900 leading-relaxed shadow-sm">
                      <p>
                        המשתמש {ownerDisplayName} ביקש סיוע בהחלפה חלקית בטווח
                        השעות{" "}
                        <span dir="ltr">
                          {requestStartStr}–{requestEndStr}
                        </span>{" "}
                        בתאריך{" "}
                        {format(new Date(requestStartDate), "dd.MM.yyyy")}
                      </p>
                    </div>

                    <div className="space-y-3">
                      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 shadow-sm">
                        <p className="text-xs font-semibold text-gray-600">
                          תצוגת המשמרת המלאה
                        </p>
                        {/* Track wrapper: generous top clearance so the stacked
                            band labels never collide with the header text above */}
                        <div className="relative mx-6 mt-14 mb-8">
                          <div className="relative h-3 bg-gray-200 rounded-full">
                            {trackBands.map((band, idx) => {
                              const right = toTrackPercent(band.start);
                              const width = Math.max(
                                0,
                                toTrackPercent(band.end) - right,
                              );
                              const isOriginal = band.variant === "original";
                              const bandColors = isOriginal
                                ? { bg: "bg-blue-200", text: "text-blue-700" }
                                : getCoverageColor(
                                    coveringColorMap.get(band.label) ?? 0,
                                  );
                              return (
                                <div
                                  key={idx}
                                  className={`absolute h-full rounded-full ${bandColors.bg}`}
                                  style={{
                                    right: `${right}%`,
                                    width: `${width}%`,
                                  }}
                                  title={`${band.label}: ${format(band.start, "HH:mm")}–${format(band.end, "HH:mm")}`}
                                >
                                  {width > 8 && (
                                    <span
                                      className={`absolute right-1/2 translate-x-1/2 text-[10px] font-semibold whitespace-nowrap ${idx % 2 === 0 ? "-top-6" : "-top-11"} ${bandColors.text}`}
                                    >
                                      {band.label}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <div className="flex items-center justify-center flex-wrap gap-3 text-[11px] text-gray-500">
                          <span className="flex items-center gap-1">
                            <span className="w-3 h-3 rounded-full bg-blue-200 inline-block" />{" "}
                            נשאר אצל {ownerDisplayName}
                          </span>
                          {Array.from(coveringColorMap.entries()).map(
                            ([name, colorIdx]) => (
                              <span
                                key={name}
                                className="flex items-center gap-1"
                              >
                                <span
                                  className={`w-3 h-3 rounded-full inline-block ${getCoverageColor(colorIdx).dot}`}
                                />{" "}
                                {name}
                              </span>
                            ),
                          )}
                        </div>
                      </div>

                      {hasCoverages && (
                        <div className="rounded-2xl border border-green-200 bg-green-50 p-4 shadow-sm space-y-2">
                          <div className="flex items-center gap-2 text-green-800">
                            <CheckCircle className="w-4 h-4" />
                            <p className="text-sm font-semibold">מי מכסה?</p>
                          </div>
                          <div className="space-y-2">
                            {coverageRows.map((row) => {
                              const rowColors = getCoverageColor(
                                coveringColorMap.get(row.name) ?? 0,
                              );
                              return (
                                <div
                                  key={row.id}
                                  className="flex gap-3 rounded-xl bg-white border border-green-200 p-3 shadow-sm"
                                >
                                  <div
                                    className={`h-10 w-10 rounded-full ${rowColors.bg} ${rowColors.text} font-bold flex items-center justify-center`}
                                  >
                                    {row.name?.slice(0, 2) || "מת"}
                                  </div>
                                  <div className="flex-1 space-y-1">
                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                      <p
                                        className={`text-sm font-semibold ${rowColors.text}`}
                                      >
                                        {row.name}
                                      </p>
                                      <span
                                        className={`text-xs font-mono ${rowColors.text}`}
                                        dir="ltr"
                                      >
                                        {format(row.start, "HH:mm")} -{" "}
                                        {format(row.end, "HH:mm")}
                                      </span>
                                    </div>
                                    {row.department && (
                                      <p className="text-[11px] text-gray-500">
                                        מחלקה {row.department}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {isRequestFullyCovered && (
                        <div className="flex items-start gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-2xl text-green-800 shadow-sm">
                          <CheckCircle className="w-5 h-5" />
                          <div className="space-y-1 text-sm">
                            <p className="font-semibold">הבקשה מאוישת במלואה</p>
                            <p className="text-xs">
                              כל חלון ההחלפה כוסה בהצלחה על ידי המתנדבים.
                            </p>
                          </div>
                        </div>
                      )}

                      {missingSegments.map((seg, idx) => (
                        <div
                          key={`${seg.start}-${idx}`}
                          className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-2xl shadow-sm"
                        >
                          <AlertCircle className="w-4 h-4 text-red-600" />
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-red-700">
                              שעות חסרות
                            </p>
                            <p className="text-xs text-red-700" dir="ltr">
                              {formatSegment(seg.start, seg.end)}
                            </p>
                            <p className="text-[11px] text-red-600">
                              בעל המשמרת המקורי ({ownerDisplayName}) יישאר משויך
                              עד שיושלם כיסוי
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* History log — built from the actual request + coverage
                    records (in the order they were claimed), instead of a
                    fixed "requested full / covered full" narrative, so it
                    stays accurate for multi-person partial coverage too. */}
                {isCoveredSwap && (
                  <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 space-y-3 shadow-sm">
                    <div className="flex items-center gap-2">
                      <img
                        src="https://cdn-icons-png.flaticon.com/128/4305/4305578.png"
                        alt="תיעוד"
                        className="w-5 h-5"
                      />
                      <h4 className="text-sm font-bold text-gray-800">
                        תיעוד החלפות
                      </h4>
                    </div>
                    <div className="space-y-2 text-sm text-gray-700">
                      <div className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
                        עבור המשמרת של{" "}
                        <span className="font-bold">{ownerDisplayName}</span>{" "}
                        התבקשה {isPartial ? "החלפה חלקית" : "החלפה מלאה"}
                      </div>
                      {coverageHistory.map((row) => (
                        <div
                          key={row.id}
                          className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm"
                        >
                          {row.completesShift
                            ? "כיסוי המשמרת הושלם על ידי "
                            : "חלק מהמשמרת כוסה על ידי "}
                          <span className="font-bold">{row.name}</span> בטווח{" "}
                          <span dir="ltr" className="font-mono text-xs">
                            {format(row.start, "HH:mm")}–
                            {format(row.end, "HH:mm")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-3 justify-center">
                  {canCancelOwnSwap && (
                    <Button
                      onClick={() => setShowCancelRequestConfirm(true)}
                      className="min-w-[160px] flex-1 sm:flex-none h-12 bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-lg"
                    >
                      <Trash2 className="w-5 h-5 ml-2" />
                      ביטול בקשת החלפה
                    </Button>
                  )}

                  {canOfferCover && (
                    <Button
                      onClick={() => {
                        onClose();
                        onOfferCover(shift);
                      }}
                      className="min-w-[160px] flex-1 sm:flex-none h-12 bg-[#22c55e] hover:bg-[#16a34a] focus-visible:ring focus-visible:ring-offset-2 focus-visible:ring-[#15803d] text-white rounded-xl shadow-md flex flex-row-reverse items-center justify-center gap-2"
                    >
                      <img
                        src="https://cdn-icons-png.flaticon.com/128/9363/9363987.png"
                        alt="עזרה"
                        className="w-5 h-5"
                      />
                      אני רוצה לעזור!
                    </Button>
                  )}

                  {canCancelCoverage && (
                    <Button
                      onClick={() => onCancelCoverage?.(shift)}
                      variant="outline"
                      className="min-w-[160px] flex-1 sm:flex-none h-12 rounded-xl border-2 border-orange-300 text-orange-600 hover:bg-orange-50"
                    >
                      <Trash2 className="w-4 h-4 ml-2" />
                      בטל השתתפות במשמרת
                    </Button>
                  )}

                  {canHeadToHead && (
                    <Button
                      onClick={() => {
                        onClose();
                        onHeadToHead?.(shift);
                      }}
                      className="min-w-[140px] flex-1 sm:flex-none h-12 bg-[#3b82f6] hover:bg-[#2563eb] focus-visible:ring focus-visible:ring-offset-2 focus-visible:ring-[#1d4ed8] text-white rounded-xl shadow-md flex flex-row-reverse items-center justify-center gap-2"
                    >
                      <img
                        src="https://cdn-icons-png.flaticon.com/128/1969/1969142.png"
                        alt="ראש בראש"
                        className="w-5 h-5"
                      />
                      ראש בראש
                    </Button>
                  )}

                  {canAddToCalendarOrEmail && !isAdmin && (
                    <Button
                      onClick={handleAddToCalendar}
                      variant="outline"
                      className="min-w-[140px] flex-1 sm:flex-none h-12 rounded-xl"
                    >
                      <CalendarPlus className="w-4 h-4 ml-2" />
                      הוסף ליומן
                    </Button>
                  )}

                  {canRequestSwap && isOwnShift && (
                    <>
                      <Button
                        onClick={() => onRequestSwap?.("full")}
                        className="min-w-[160px] flex-1 sm:flex-none h-12 bg-[#0ea5e9] hover:bg-[#0284c7] text-white rounded-xl shadow-lg"
                      >
                        <Send className="w-4 h-4 ml-2" />
                        בקשת החלפה מלאה או חלקית
                      </Button>
                    </>
                  )}

                  {canWhatsappShare && !isAdmin && (
                    <Button
                      onClick={handleWhatsAppShare}
                      className="min-w-[140px] flex-1 sm:flex-none h-12 bg-[#25D366] hover:bg-[#128C7E] text-white rounded-xl shadow-lg"
                    >
                      <Send className="w-4 h-4 ml-2" />
                      שתף בווצאפ
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </motion.div>

        {/* Cancel Swap Request Confirmation */}
        <Dialog
          open={showCancelRequestConfirm}
          onOpenChange={setShowCancelRequestConfirm}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>ביטול בקשת החלפה</DialogTitle>
              <DialogDescription>
                לבטל את בקשת ההחלפה? המשמרת תחזור לסטטוס רגיל. הפעולה לא ניתנת
                לביטול.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowCancelRequestConfirm(false)}
              >
                ביטול
              </Button>
              <Button
                variant="destructive"
                onClick={handleCancelRequestConfirm}
              >
                כן, בטל בקשה
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Modal */}
        <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>מחיקת משמרת</DialogTitle>
              <DialogDescription>
                האם למחוק את המשמרת? הפעולה לא ניתנת לביטול.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
              >
                ביטול
              </Button>
              <Button variant="destructive" onClick={handleDelete}>
                מחק
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Reassign Modal */}
        <Dialog open={showReassignModal} onOpenChange={setShowReassignModal}>
          <DialogContent className="sm:max-w-lg">
            <div className="rounded-2xl overflow-hidden shadow-lg">
              <div className="bg-gradient-to-r from-[#64B5F6] to-[#42A5F5] p-4 text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/20 rounded-xl">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">החלפת משתמש למשמרת</h3>
                    <p className="text-white/80 text-xs">
                      בחר מחלקה ואז את המשתמש החדש
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowReassignModal(false)}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="space-y-2">
                  <Label className="text-gray-700 font-medium flex items-center gap-2">
                    <User className="w-4 h-4 text-[#64B5F6]" />
                    בחר מחלקה
                  </Label>
                  <Select
                    value={selectedDepartment}
                    onValueChange={(val) => {
                      setSelectedDepartment(val);
                      setSelectedUserId("");
                    }}
                  >
                    <SelectTrigger className="h-12 rounded-xl border-2 border-gray-200 focus:border-[#64B5F6]">
                      <SelectValue placeholder="בחר מחלקה..." />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((dept) => (
                        <SelectItem key={dept} value={dept}>
                          {dept}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <AnimatePresence>
                  {selectedDepartment && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-2 overflow-hidden"
                    >
                      <Label className="text-gray-700 font-medium flex items-center gap-2">
                        <UserRoundPen className="w-4 h-4 text-[#64B5F6]" />
                        בחר משתמש
                      </Label>
                      <Select
                        value={selectedUserId?.toString()}
                        onValueChange={(val) => setSelectedUserId(val)}
                      >
                        <SelectTrigger className="h-12 rounded-xl border-2 border-gray-200 focus:border-[#64B5F6]">
                          <SelectValue placeholder="בחר משתמש..." />
                        </SelectTrigger>
                        <SelectContent>
                          {departmentUsers.map((user) => (
                            <SelectItem
                              key={user.serial_id}
                              value={user.serial_id.toString()}
                            >
                              {user.full_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </motion.div>
                  )}
                </AnimatePresence>

                <Button
                  onClick={() => reassignMutation.mutate(selectedUserId)}
                  disabled={!selectedUserId || reassignMutation.isPending}
                  className="w-full bg-gradient-to-r from-[#64B5F6] to-[#42A5F5] hover:from-[#42A5F5] hover:to-[#2196F3] text-white py-3 rounded-xl text-base font-semibold disabled:opacity-60"
                >
                  {reassignMutation.isPending ? "מעדכן..." : "שמור והחלף משתמש"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AnimatePresence>
  );
}
