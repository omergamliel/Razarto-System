import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { addDays } from "date-fns";
import {
  AlertCircle,
  Clock,
  CheckCircle,
  Calendar,
  ArrowLeftRight,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { resolveOwnerId } from "@/components/calendar/whatsappTemplates";
import { useThemePalette } from "@/hooks/useAuthorizedPerson";

export default function KPIHeader({
  currentUser,
  onKPIClick,
  onStartSwitchFlow,
}) {
  // Admin-configurable KPI tile colors (ניהול מערכת ▸ ערכת נושא). Applied as
  // inline styles below so a saved palette actually renders instead of the
  // tiles always showing their hardcoded fallback colors.
  const themePalette = useThemePalette();
  // Shared cache key with ShiftCalendar's swap-requests query, so KPI counts
  // refresh the moment a request is created/updated anywhere in the app
  // instead of only after a full remount.
  const { data: swapRequests = [] } = useQuery({
    queryKey: ["swap-requests"],
    queryFn: () => base44.entities.SwapRequest.list(),
  });
  // Ownership/coverage source of truth (Phase 4). Loaded here (not only for the
  // green/blue tiles below) so the red count can resolve a Gift's recipient —
  // the gifted shift's current owner — to scope gifts to the current user.
  const { data: shiftsAll = [] } = useQuery({
    queryKey: ["shifts"],
    queryFn: () => base44.entities.Shift.list(),
  });
  const { data: coveragesAll = [] } = useQuery({
    queryKey: ["coverages"],
    queryFn: () => base44.entities.ShiftCoverage.list(),
  });

  // --- 1. Swap Requests Count (Red) ---
  // Count ALL open whole-shift SwapRequests — 'General' (open to anyone),
  // 'Head2Head' (a targeted trade), and 'Gift' (a one-directional handoff), to
  // match the "בקשות להחלפה" list in KPIListModal. Gifts are private to their
  // giver + recipient, so — exactly like the modal's default "all" tab
  // (filterRequestsForSwapTab) — only count a gift the current user is part of
  // (they sent it, or the gifted shift is theirs). Partial (windowed) requests
  // are counted separately below.
  const fullRequestsCount = useMemo(() => {
    const myId = Number(currentUser?.serial_id);
    return swapRequests.filter((r) => {
      if (r.status !== "Open") return false;
      if (["Head2Head", "General"].includes(r.request_type)) return true;
      if (r.request_type !== "Gift") return false;
      const giftShift = shiftsAll.find((s) =>
        (r.shift_ids || []).includes(s.id),
      );
      const recipientId = Number(resolveOwnerId(giftShift, coveragesAll));
      return Number(r.requesting_user_id) === myId || recipientId === myId;
    }).length;
  }, [swapRequests, shiftsAll, coveragesAll, currentUser?.serial_id]);

  // --- 2. Partial Gaps Count (Yellow) ---
  // Count ALL open SwapRequests that are of type 'Partial', plus any request
  // that's been partially covered
  const partialRequestsCount = useMemo(
    () =>
      swapRequests.filter(
        (r) =>
          (r.status === "Open" && r.request_type === "Partial") ||
          r.status === "Partially_Covered",
      ).length,
    [swapRequests],
  );

  // --- 3. History / Approved (Green) ---
  // Count closed/completed requests, plus partial shifts that already have
  // at least one accepted coverage window even though they're not fully
  // closed yet — same "in progress" swaps KPIListModal surfaces under this
  // tile, so the badge and the list it opens agree on the count.
  const inProgressPartialCount = useMemo(() => {
    return shiftsAll.filter((shift) => {
      // A shift is a live partial gap only while it has an active request
      // (Phase 4: status is derived, not stored). "cover" rows are the covers;
      // the base "assignment" row is ownership and must be excluded from the gap.
      const shiftCoverages = coveragesAll.filter(
        (c) => c.shift_id === shift.id && c.type !== "assignment",
      );
      if (shiftCoverages.length === 0) return false;

      const activeRequest = swapRequests.find(
        (r) =>
          r.shift_ids?.includes(shift.id) &&
          ["Open", "Partially_Covered"].includes(r.status),
      );
      if (!activeRequest) return false;

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

      let gaps = [{ start: windowStart, end: windowEnd }];
      shiftCoverages.forEach((c) => {
        const covStart = new Date(
          `${c.cover_start_date || startDate}T${c.cover_start_time || startTime}`,
        );
        let covEnd = new Date(
          `${c.cover_end_date || endDate}T${c.cover_end_time || endTime}`,
        );
        if (covEnd <= covStart) covEnd = addDays(covEnd, 1);
        gaps = gaps.flatMap((seg) => {
          if (covEnd <= seg.start || covStart >= seg.end) return [seg];
          const pieces = [];
          if (covStart > seg.start) pieces.push({ start: seg.start, end: covStart });
          if (covEnd < seg.end) pieces.push({ start: covEnd, end: seg.end });
          return pieces;
        });
      });
      const hasGap = gaps.some((seg) => seg.end - seg.start > 60000);

      return hasGap;
    }).length;
  }, [shiftsAll, coveragesAll, swapRequests]);

  const approvedCount = useMemo(
    () =>
      swapRequests.filter(
        (r) => r.status === "Closed" || r.status === "Completed",
      ).length + inProgressPartialCount,
    [swapRequests, inProgressPartialCount],
  );

  // --- 4. My Future Shifts (Blue) ---
  // Shifts I own (via the base "assignment" coverage row) OR future windows I'm
  // covering ("cover" rows). Ownership + coverage both come from ShiftCoverage
  // now (Phase 4), so derive from the already-loaded shifts/coverages lists.
  const myShiftsCount = useMemo(() => {
    if (!currentUser?.serial_id) return 0;
    const todayStr = new Date().toISOString().split("T")[0];
    const myId = Number(currentUser.serial_id);

    const futureOwned = shiftsAll.filter(
      (s) =>
        Number(resolveOwnerId(s, coveragesAll)) === myId &&
        s.start_date >= todayStr,
    ).length;

    const futureCovering = coveragesAll.filter(
      (c) =>
        c.type !== "assignment" &&
        Number(c.covering_user_id) === myId &&
        (c.cover_start_date || "") >= todayStr,
    ).length;

    return futureOwned + futureCovering;
  }, [shiftsAll, coveragesAll, currentUser?.serial_id]);

  const kpis = [
    {
      id: "swap_requests",
      mobileTitle: "בקשות למלאה",
      desktopTitle: "בקשות להחלפה מלאה",
      count: fullRequestsCount,
      icon: AlertCircle,
      gradient: "from-red-500 to-red-600",
      bgColor: "bg-red-50",
      textColor: "text-red-600",
      borderColor: "border-red-200",
      themeColor: themePalette.kpi.fullSwap,
    },
    {
      id: "partial_gaps",
      mobileTitle: "בקשות לחלקית",
      desktopTitle: "בקשות להחלפה חלקית",
      count: partialRequestsCount,
      icon: Clock,
      gradient: "from-yellow-500 to-yellow-600",
      bgColor: "bg-yellow-50",
      textColor: "text-yellow-600",
      borderColor: "border-yellow-200",
      themeColor: themePalette.kpi.partialSwap,
    },
    {
      id: "approved",
      mobileTitle: "היסטוריה",
      desktopTitle: "היסטוריית החלפות",
      count: approvedCount,
      icon: CheckCircle,
      gradient: "from-green-500 to-green-600",
      bgColor: "bg-green-50",
      textColor: "text-green-600",
      borderColor: "border-green-200",
      themeColor: themePalette.kpi.history,
    },
    {
      id: "my_shifts",
      mobileTitle: "המשמרות שלי",
      desktopTitle: "המשמרות העתידיות שלי",
      count: myShiftsCount,
      icon: Calendar,
      gradient: "from-blue-500 to-blue-600",
      bgColor: "bg-blue-50",
      textColor: "text-blue-600",
      borderColor: "border-blue-200",
      themeColor: themePalette.kpi.futureShifts,
    },
    {
      id: "switch_request",
      isAction: true,
      mobileTitle: "בקשת החלפה",
      desktopTitle: "התחל בקשת החלפה",
      icon: ArrowLeftRight,
      gradient: "from-purple-500 to-purple-600",
      bgColor: "bg-purple-50",
      textColor: "text-purple-600",
      borderColor: "border-purple-200",
    },
  ];

  return (
    <div
      className="grid grid-cols-5 gap-1 sm:gap-2 mb-3 md:mb-6"
      data-tour="kpi-band"
    >
      {kpis.map((kpi, index) => {
        // When a theme color is set, drive the tile from it via inline styles
        // (which override the Tailwind fallback classes): a light tint for the
        // card, a solid gradient for the icon chip, and the accent for the
        // count. 8-digit hex appends an alpha channel to the base color.
        const themed = kpi.themeColor;
        const cardStyle = themed
          ? { backgroundColor: `${themed}14`, borderColor: `${themed}55` }
          : undefined;
        const iconStyle = themed
          ? {
              backgroundImage: `linear-gradient(to bottom right, ${themed}, ${themed}cc)`,
            }
          : undefined;
        const countStyle =
          themed && !kpi.isAction ? { color: themed } : undefined;
        return (
        <motion.div
          key={kpi.id}
          data-tour={`kpi-${kpi.id}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
          style={cardStyle}
          onClick={() =>
            kpi.isAction
              ? onStartSwitchFlow && onStartSwitchFlow()
              : onKPIClick && onKPIClick(kpi.id)
          }
          className={`
            ${kpi.bgColor} border ${kpi.borderColor}
            rounded-xl cursor-pointer hover:shadow-md transition-all
            flex flex-col items-center justify-center text-center
            p-2 md:p-4 md:flex-row md:gap-3 md:items-center md:text-right
            h-full
          `}
        >
          <div
            style={iconStyle}
            className={`p-1.5 md:p-3 rounded-lg md:rounded-xl bg-gradient-to-br ${kpi.gradient} text-white shadow-sm mb-1 md:mb-0 shrink-0`}
          >
            <kpi.icon className="w-4 h-4 md:w-6 md:h-6" />
          </div>

          <div className="flex flex-col items-center md:items-start">
            <span
              style={countStyle}
              className={`text-xl md:text-3xl font-extrabold leading-none mb-1 md:mb-0 ${kpi.isAction ? "invisible" : kpi.textColor}`}
            >
              {kpi.isAction ? "0" : kpi.count}
            </span>

            <p className="text-[10px] md:text-xs font-bold text-gray-700 leading-tight min-h-[2.5em] flex items-center">
              <span className="md:hidden block px-1">{kpi.mobileTitle}</span>
              <span className="hidden md:block">{kpi.desktopTitle}</span>
            </p>
          </div>
        </motion.div>
        );
      })}
    </div>
  );
}