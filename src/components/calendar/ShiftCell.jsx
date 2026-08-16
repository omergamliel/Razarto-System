import React from "react";
import { format, isToday, isSameMonth, startOfDay } from "date-fns";
import { motion } from "framer-motion";
import { Clock, CheckCircle2, AlertCircle, ArrowLeftRight } from "lucide-react";

// #rrggbb -> rgba() with the given alpha, for a light tint of the configurable
// "assigned to inactive member" color (used as the cell background).
const hexToRgba = (hex, alpha) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  if (!m) return hex;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export default function ShiftCell({
  date,
  shift,
  onClick,
  currentMonth,
  isWeekView = false,
  currentUserEmail,
  isAdmin = false,
  holidayName,
  switchFlow = null,
  inactiveGroupColor = "#f97316",
}) {
  const handleClick = () => {
    onClick(date, shift);
  };

  const isCurrentMonth = isSameMonth(date, currentMonth);
  const today = isToday(date);

  const isPastDate = startOfDay(date) < startOfDay(new Date());
  // "Active"/"regular" both mean a plain, unswapped shift (see HeadToHeadSelectorModal's isWhiteShift check).
  const isPlainShiftStatus =
    !!shift &&
    ["active", "regular"].includes(
      String(shift.status || "Active").toLowerCase(),
    );
  const isSwitchEligible =
    !!switchFlow &&
    isPlainShiftStatus &&
    !isPastDate &&
    (switchFlow.step === "own" ? shift.isMine : !shift.isMine);
  const switchSelectedIds =
    switchFlow?.step === "own"
      ? switchFlow.ownShiftIds
      : switchFlow?.targetShiftIds;
  const isSwitchSelected =
    isSwitchEligible && switchSelectedIds?.includes(shift.id);
  const isSwitchDimmed = !!switchFlow && !!shift && !isSwitchEligible;

  const getStatusStyles = () => {
    if (!shift) return {};

    const status = shift.status || "regular";
    const coverageType = shift.coverageType || shift.swap_type;

    if (status === "requested" || status === "Swap_Requested") {
      return {
        bg: "bg-red-50",
        border: "border-red-300",
        badge: "bg-red-500",
        icon: ArrowLeftRight,
      };
    }

    if (
      status === "partial" ||
      (status === "requested" && coverageType === "partial")
    ) {
      return {
        bg: "bg-yellow-50",
        border: "border-yellow-300",
        badge: "bg-yellow-500",
        icon: AlertCircle,
      };
    }

    if (status === "covered") {
      return {
        bg: "bg-green-50",
        border: "border-green-300",
        badge: "bg-green-500",
        icon: CheckCircle2,
      };
    }

    // Assigned to someone who is NOT the active member of a group — an
    // out-of-policy assignment (distribution only gives shifts to active
    // members). Colored via the admin-configurable inactiveGroupColor (applied
    // inline below), ahead of the normal "mine"/regular colors. Managers/admins
    // only — regular users fall through to the usual "mine"/regular styling.
    if (isAdmin && shift.assignedToInactiveMember) {
      return { inactive: true, icon: AlertCircle };
    }

    if (shift.isMine) {
      return {
        bg: "bg-blue-50",
        border: "border-blue-300",
        badge: "bg-blue-500",
        icon: Clock,
      };
    }

    return {
      bg: "bg-white",
      border: "border-gray-200",
      badge: "bg-gray-400",
      icon: Clock,
    };
  };

  const styles = getStatusStyles();
  const isInactiveStyle = !!styles.inactive && !isSwitchSelected;
  const nameTextClass = isSwitchSelected ? "text-white" : "text-gray-800";
  const bgBorderClass = isSwitchSelected
    ? "bg-blue-600 border-2 border-blue-700"
    : isInactiveStyle
      ? "border-2"
      : `${styles.bg} ${styles.border ? `border-2 ${styles.border}` : "border border-gray-100"}`;
  // Inline colors for the configurable "assigned to inactive member" state.
  const inactiveInlineStyle = isInactiveStyle
    ? {
        backgroundColor: hexToRgba(inactiveGroupColor, 0.12),
        borderColor: inactiveGroupColor,
      }
    : undefined;

  const nameLines = React.useMemo(() => {
    if (!shift) return [];
    const fallbackOwner = shift.user_name || shift.role || "לא ידוע";
    const coverageNames = (shift.coverages || [])
      .filter((cov) => cov.status !== "Cancelled")
      .map((cov) => cov.covering_name || cov.covering_user_name)
      .filter(Boolean);
    const participants = shift.coverage_participants?.length
      ? shift.coverage_participants
      : [fallbackOwner, ...coverageNames];
    const uniqueNames = [];
    participants.forEach((name) => {
      if (name && !uniqueNames.includes(name)) {
        uniqueNames.push(name);
      }
    });
    return uniqueNames;
  }, [shift]);

  const mobileNames = nameLines.slice(0, 2);
  const hiddenCount = Math.max(nameLines.length - mobileNames.length, 0);

  return (
    <motion.div
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={handleClick}
      style={inactiveInlineStyle}
      className={`
        relative cursor-pointer rounded-lg md:rounded-xl transition-all duration-200
        min-h-[85px] md:min-h-[110px] p-1 md:p-3
        ${bgBorderClass}
        ${!isCurrentMonth ? "opacity-40" : ""}
        ${today ? "ring-2 ring-[#64B5F6] ring-offset-2" : ""}
        ${isSwitchDimmed ? "opacity-30 grayscale pointer-events-none" : ""}
        hover:shadow-lg
        group
      `}
    >
      <div
        className={`
        absolute top-1 right-1 md:top-2 md:right-2 w-6 h-6 md:w-8 md:h-8 rounded-lg flex items-center justify-center
        ${today ? "bg-[#64B5F6] text-white" : holidayName ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600"}
        font-semibold text-xs md:text-sm
      `}
      >
        {format(date, "d")}
      </div>

      {holidayName && (
        <div
          className="hidden md:block absolute top-2 left-2 max-w-[58%] truncate rounded-md bg-purple-100 text-purple-700 text-[10px] font-semibold px-1 py-0.5"
          title={holidayName}
        >
          {holidayName}
        </div>
      )}

      {shift && (
        <div className="mt-6 md:mt-10 space-y-1 md:space-y-1.5">
          {holidayName && (
            <p className="md:hidden text-center text-[9px] font-semibold text-purple-700 truncate px-0.5 leading-tight">
              {holidayName}
            </p>
          )}
          {/* Assignees / Covering Users */}
          <div className="space-y-0.5">
            <div className="md:hidden space-y-0.5">
              {mobileNames.map((name) => (
                <p
                  key={name}
                  className={`text-center font-normal text-[10px] leading-tight break-words px-0.5 ${nameTextClass}`}
                >
                  {name}
                </p>
              ))}
              {hiddenCount > 0 && (
                <p
                  className={`text-center text-[9px] font-medium ${isSwitchSelected ? "text-blue-100" : "text-gray-500"}`}
                >{`+${hiddenCount} נוספים`}</p>
              )}
            </div>
            <div className="hidden md:block space-y-0.5">
              {nameLines.map((name) => (
                <p
                  key={name}
                  className={`text-center font-semibold text-base break-words px-0.5 ${nameTextClass}`}
                >
                  {name}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {!shift && isCurrentMonth && isAdmin && (
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="text-xs text-gray-400">לחץ להוספה</span>
        </div>
      )}

      {!shift && holidayName && (
        <p className="md:hidden absolute bottom-1 left-1 right-1 text-center text-[9px] font-semibold text-purple-700 truncate px-1">
          {holidayName}
        </p>
      )}
    </motion.div>
  );
}
