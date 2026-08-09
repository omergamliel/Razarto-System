import { format, addDays } from "date-fns";
import { he } from "date-fns/locale";

// Distinct colors for each person helping cover a shift, so multiple
// simultaneous helpers can be told apart at a glance on the coverage
// sliders. Full class names are spelled out (not built from a template
// string) so Tailwind's JIT scanner can find and keep them.
export const COVERAGE_COLOR_PALETTE = [
  { bg: "bg-purple-200", text: "text-purple-700", dot: "bg-purple-200" },
  { bg: "bg-orange-200", text: "text-orange-700", dot: "bg-orange-200" },
  { bg: "bg-teal-200", text: "text-teal-700", dot: "bg-teal-200" },
  { bg: "bg-pink-200", text: "text-pink-700", dot: "bg-pink-200" },
  { bg: "bg-amber-200", text: "text-amber-700", dot: "bg-amber-200" },
  { bg: "bg-cyan-200", text: "text-cyan-700", dot: "bg-cyan-200" },
  { bg: "bg-lime-200", text: "text-lime-700", dot: "bg-lime-200" },
  { bg: "bg-fuchsia-200", text: "text-fuchsia-700", dot: "bg-fuchsia-200" },
];
export const getCoverageColor = (index) =>
  COVERAGE_COLOR_PALETTE[index % COVERAGE_COLOR_PALETTE.length];

// Some flows end up with more than one ShiftCoverage record for the same
// person on overlapping/nested time windows (e.g. re-picking a slightly
// different range on the same shift). Displaying each raw record as its own
// band/row makes that same person show up several times over what's really
// one continuous window, so every place that lists or draws "who covers
// what" first collapses same-person overlapping (or touching) ranges into a
// single merged one. Only merges within the same key — different people's
// windows are left untouched even if they overlap.
export const mergeOverlappingSegments = (items, keyFn) => {
  const groups = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  const merged = [];
  groups.forEach((group) => {
    const sorted = [...group].sort((a, b) => a.start - b.start);
    let current = null;
    sorted.forEach((item) => {
      if (!current) {
        current = { ...item };
      } else if (item.start <= current.end) {
        if (item.end > current.end) current.end = item.end;
      } else {
        merged.push(current);
        current = { ...item };
      }
    });
    if (current) merged.push(current);
  });

  return merged.sort((a, b) => a.start - b.start);
};

// Subtracts a set of {start,end} Date-object segments from a [rangeStart,
// rangeEnd] range, returning the gaps left over. Unlike calculateMissingSegments
// (which reads raw cover_start_date/cover_start_time string fields), this works
// directly on already-resolved Date objects.
export const subtractSegments = (rangeStart, rangeEnd, segments = []) => {
  if (!rangeStart || !rangeEnd) return [];
  let gaps = [{ start: rangeStart, end: rangeEnd }];
  [...segments]
    .sort((a, b) => a.start - b.start)
    .forEach((seg) => {
      gaps = gaps.flatMap((g) => {
        if (seg.end <= g.start || seg.start >= g.end) return [g];
        const pieces = [];
        if (seg.start > g.start) pieces.push({ start: g.start, end: seg.start });
        if (seg.end < g.end) pieces.push({ start: seg.end, end: g.end });
        return pieces;
      });
    });
  return gaps.filter((g) => g.end > g.start);
};

// --- Shared swap helpers (centralized to avoid duplication across modals) ---
export const resolveSwapType = (shift, activeRequest) => {
  const explicit =
    activeRequest?.request_type ||
    shift?.request_type ||
    shift?.coverageType ||
    shift?.swap_type;
  if (explicit && String(explicit).toLowerCase() === "partial")
    return "partial";
  if (explicit && String(explicit).toLowerCase() === "full") return "full";

  const start =
    activeRequest?.req_start_time || shift?.req_start_time || shift?.start_time;
  const end =
    activeRequest?.req_end_time || shift?.req_end_time || shift?.end_time;
  if (start && end && start !== end) return "partial";
  return "full";
};

export const resolveRequestWindow = (shift, activeRequest) => {
  const startDate =
    activeRequest?.req_start_date ||
    shift?.req_start_date ||
    shift?.start_date ||
    shift?.date;
  const endDate =
    activeRequest?.req_end_date ||
    shift?.req_end_date ||
    shift?.end_date ||
    startDate;
  const startTime =
    activeRequest?.req_start_time ||
    shift?.req_start_time ||
    shift?.start_time ||
    "09:00";
  const endTime =
    activeRequest?.req_end_time ||
    shift?.req_end_time ||
    shift?.end_time ||
    startTime;
  return { startDate, endDate, startTime, endTime };
};

export const buildDateTime = (dateStr, timeStr) => {
  if (!dateStr || !timeStr) return null;
  const dt = new Date(`${dateStr}T${timeStr}`);
  return isNaN(dt.getTime()) ? null : dt;
};

export const normalizeCoverageEntry = (coverage, fallbackWindow) => ({
  ...coverage,
  cover_start_date:
    coverage.cover_start_date ||
    coverage.start_date ||
    fallbackWindow.startDate,
  cover_end_date:
    coverage.cover_end_date || coverage.end_date || fallbackWindow.endDate,
  cover_start_time:
    coverage.cover_start_time ||
    coverage.start_time ||
    fallbackWindow.startTime,
  cover_end_time:
    coverage.cover_end_time || coverage.end_time || fallbackWindow.endTime,
});

export const resolveShiftWindow = (shift, requestWindow) => {
  const startDate =
    shift?.start_date || requestWindow?.startDate || shift?.date;
  const endDate = shift?.end_date || requestWindow?.endDate || startDate;
  const startTime = shift?.start_time || requestWindow?.startTime || "09:00";
  const endTime = shift?.end_time || requestWindow?.endTime || startTime;
  return { startDate, endDate, startTime, endTime };
};

export const calculateMissingSegments = (
  baseStart,
  baseEnd,
  coverageEntries = [],
) => {
  if (
    !baseStart ||
    !baseEnd ||
    isNaN(baseStart.getTime()) ||
    isNaN(baseEnd.getTime())
  )
    return [];

  const orderedCoverages = [...coverageEntries]
    .map((cov) => ({
      ...cov,
      start: buildDateTime(cov.cover_start_date, cov.cover_start_time),
      end: buildDateTime(cov.cover_end_date, cov.cover_end_time),
    }))
    .filter((cov) => cov.start && cov.end && cov.start < cov.end)
    .sort((a, b) => a.start - b.start);

  let gaps = [{ start: baseStart, end: baseEnd }];

  orderedCoverages.forEach((cov) => {
    gaps = gaps.flatMap((seg) => {
      if (cov.end <= seg.start || cov.start >= seg.end) return [seg];
      const pieces = [];
      if (cov.start > seg.start)
        pieces.push({ start: seg.start, end: cov.start });
      if (cov.end < seg.end) pieces.push({ start: cov.end, end: seg.end });
      return pieces;
    });
  });

  return gaps.filter(
    (gap) =>
      gap.end > gap.start &&
      !isNaN(gap.start.getTime()) &&
      !isNaN(gap.end.getTime()),
  );
};

export const computeCoverageSummary = ({
  shift,
  activeRequest,
  coverages = [],
}) => {
  const requestWindow = resolveRequestWindow(shift, activeRequest);
  const shiftWindow = resolveShiftWindow(shift, requestWindow);
  const requestType = resolveSwapType(shift, activeRequest);
  const useRequestWindow = Boolean(activeRequest) || requestType === "partial";
  const coverageWindow = useRequestWindow ? requestWindow : shiftWindow;

  const baseStart = buildDateTime(
    coverageWindow.startDate,
    coverageWindow.startTime,
  );
  let baseEnd = buildDateTime(coverageWindow.endDate, coverageWindow.endTime);
  if (baseEnd && baseStart && baseEnd <= baseStart) {
    baseEnd = addDays(baseEnd, 1);
  }

  const normalizedCoverages = (coverages || []).map((cov) =>
    normalizeCoverageEntry(cov, coverageWindow),
  );
  const approvedCoverages = normalizedCoverages.filter(
    (cov) => cov.status === "Approved" || !cov.status,
  );
  const missingSegments =
    baseStart && baseEnd
      ? calculateMissingSegments(baseStart, baseEnd, approvedCoverages)
      : [];
  const isFullyCovered =
    approvedCoverages.length > 0 && missingSegments.length === 0;

  return {
    requestType,
    requestWindow,
    shiftWindow,
    coverageWindow,
    baseStart,
    baseEnd,
    normalizedCoverages,
    approvedCoverages,
    missingSegments,
    isFullyCovered,
  };
};

export const normalizeShiftContext = (
  shift,
  {
    allUsers = [],
    swapRequests = [],
    coverages = [],
    currentUser,
    activeRequest: activeRequestOverride,
  } = {},
) => {
  if (!shift) return null;

  const activeRequest =
    activeRequestOverride ||
    shift.active_request ||
    swapRequests?.find(
      (sr) =>
        sr.shift_ids?.includes(shift.id) &&
        sr.status !== "Cancelled" &&
        // A request only describes this shift's CURRENT state if it was made
        // by the shift's current owner. Once acceptHeadToHeadRequestMutation
        // reassigns original_user_id to a new owner, the old (now-Closed)
        // request still lists this shift's id in shift_ids forever — without
        // this check it would keep being found and force displayStatus to
        // "covered" permanently, blocking the new owner from ever requesting
        // a swap on their own shift again.
        sr.requesting_user_id === shift.original_user_id,
    );
  const requestType = resolveSwapType(shift, activeRequest);
  const requestWindow = resolveRequestWindow(shift, activeRequest);
  const shiftWindow = resolveShiftWindow(shift, requestWindow);

  const originalUser =
    allUsers?.find((u) => u.serial_id === shift.original_user_id) ||
    shift.original_user_data;
  const shiftCoverages = (coverages || [])
    .filter((c) => c.shift_id === shift.id || !c.shift_id)
    .map((cov) => {
      const coveringUser = allUsers?.find(
        (u) => u.serial_id === cov.covering_user_id,
      );
      return {
        ...cov,
        covering_name: coveringUser?.full_name || cov.covering_name || "מחליף",
        covering_email: coveringUser?.email || cov.covering_email || "",
        covering_department:
          coveringUser?.department || cov.covering_department || "",
      };
    });

  const {
    approvedCoverages,
    missingSegments,
    isFullyCovered,
    normalizedCoverages,
  } = computeCoverageSummary({
    shift: { ...shift, ...shiftWindow },
    activeRequest,
    coverages: shiftCoverages,
  });

  let displayStatus = shift.status || "regular";
  // "Active" and "regular" both mean a plain, unswapped shift — several
  // mutations (addShiftMutation, cancelSwapMutation, the lazy-cleanup
  // reconciliation, acceptHeadToHeadRequestMutation) reset shifts to
  // "Active", so normalize it here once instead of special-casing it in
  // every downstream "is this a normal shift" check.
  if (displayStatus.toLowerCase() === "active") displayStatus = "regular";
  if (activeRequest) {
    if (activeRequest.status === "Closed") displayStatus = "covered";
    else if (
      activeRequest.status === "Partially_Covered" ||
      requestType === "partial"
    )
      displayStatus = "partial";
    else if (
      activeRequest.status === "Open" ||
      shift.status === "Swap_Requested"
    )
      displayStatus = requestType === "partial" ? "partial" : "requested";
  }
  if (isFullyCovered) {
    displayStatus = "covered";
  } else if (
    displayStatus === "regular" &&
    // Only treat leftover approved coverage as an active partial gap while the
    // shift itself is still genuinely mid-swap. Once the lazy-cleanup reconciles
    // an expired request (resets shift.status to "Active"/"regular"), any
    // ShiftCoverage rows are just history — the original owner has reclaimed
    // whatever nobody else took, so the shift should render as a normal shift
    // again instead of getting stuck showing a partial-gap highlight forever.
    ["Swap_Requested", "Partially_Covered"].includes(shift.status) &&
    shiftCoverages.some((cov) => cov.status === "Approved")
  ) {
    displayStatus = requestType === "partial" ? "partial" : "requested";
  }

  const ownerName =
    originalUser?.full_name ||
    shift.original_user_name ||
    shift.user_name ||
    shift.role ||
    "לא שובץ";
  const participantNames = [
    ownerName,
    ...approvedCoverages
      .map(
        (cov) =>
          cov.covering_name || cov.covering_user_name || cov.covering_person,
      )
      .filter(Boolean),
  ];
  const uniqueParticipants = Array.from(
    new Set(participantNames.filter(Boolean)),
  );

  return {
    ...shift,
    date: shift.start_date || shift.date,
    role: ownerName,
    department: originalUser?.department || shift.department || "",
    assigned_email: originalUser?.email || shift.assigned_email || "",
    assigned_person: originalUser?.full_name || shift.assigned_person || "",
    user_name: shift.user_name || ownerName,
    status: displayStatus,
    swap_start_time: requestWindow.startTime,
    swap_end_time: requestWindow.endTime,
    swap_type: requestType,
    coverageType: requestType,
    coverages: normalizedCoverages,
    shiftCoverages: normalizedCoverages,
    active_request: activeRequest,
    request_type:
      activeRequest?.request_type ||
      shift.request_type ||
      (requestType === "partial" ? "Partial" : "Full"),
    original_user_data: originalUser,
    original_user_name: ownerName,
    // Number() guards against original_user_id/covering_user_id occasionally
    // being stored as a string on some records — a strict === would
    // silently misreport ownership for the very same person (this is the
    // same class of bug fixed elsewhere in ShiftDetailsModal/KPIListModal).
    isMine: currentUser
      ? Number(shift.original_user_id) === Number(currentUser.serial_id) ||
        (!!currentUser.email && shift.assigned_email === currentUser.email)
      : false,
    isCovering: currentUser
      ? shiftCoverages.some(
          (cov) => Number(cov.covering_user_id) === Number(currentUser.serial_id),
        )
      : false,
    start_time: shiftWindow.startTime,
    end_time: shiftWindow.endTime,
    start_date: shiftWindow.startDate,
    end_date: shiftWindow.endDate,
    coverage_participants: uniqueParticipants,
    coverage_missing_segments: missingSegments,
  };
};

// Centralized deep link builder so all WhatsApp templates open the same in-app flow
const PRODUCTION_BASE_URL = "https://razar-toran-b555aef5.base44.app";

export const buildShiftDeepLink = (shiftId) => {
  if (!shiftId) return "";
  return `${PRODUCTION_BASE_URL}?openShiftId=${shiftId}`;
};

export const buildHeadToHeadDeepLink = (targetId, offerId) => {
  if (!targetId || !offerId) return "";
  return `${PRODUCTION_BASE_URL}?headToHeadTarget=${targetId}&headToHeadOffer=${offerId}`;
};

export const buildSwapTemplate = ({
  originalOwnerName,
  employeeName,
  startDate,
  startTime,
  endDate,
  endTime,
  approvalUrl,
  shiftId,
}) => {
  const safeStart = startDate
    ? format(new Date(startDate), "dd/MM/yyyy", { locale: he })
    : "";
  const safeEnd = endDate
    ? format(new Date(endDate), "dd/MM/yyyy", { locale: he })
    : safeStart;
  const resolvedLink = approvalUrl || buildShiftDeepLink(shiftId);
  const ownerName = originalOwnerName || employeeName || "";

  return `היי, פתחתי בקשה ב-Razarto להחלפה למשמרת *${ownerName}* 👮‍♂️\nמתאריך ${safeStart} בשעה ${startTime || ""} ועד תאריך ${safeEnd} בשעה ${endTime || ""} ⏰\n\nמי יכול לעזור? 🙏\nאפשר לאשר כאן:\n${resolvedLink || ""}`;
};

export const buildHeadToHeadTemplate = ({
  targetUserName,
  targetShiftOwner,
  targetShiftDate,
  myShiftOwner,
  myShiftDate,
  uniqueApprovalUrl,
}) => {
  return `היי *${targetUserName || ""}*! 👋🏼\nאני מעוניין להחליף איתך משמרת רז״רתו ראש בראש:\n\n🫡 הצעת החלפה:\n🫵🏼 המשמרת שלך: *${targetShiftOwner || ""}* ${targetShiftDate || ""}\n🤞🏼 המשמרת שלי: *${myShiftOwner || ""}* ${myShiftDate || ""}\n\n✅ לחץ כאן לאישור ההחלפה בתוך המערכת:\n${uniqueApprovalUrl || ""}`;
};

// A "gift" is a one-directional takeover: an RR user takes today's shift off
// the person doing it, with nothing expected in return. This message lets the
// giver tell the recipient the good news over WhatsApp.
export const buildGiftTemplate = ({
  recipientName,
  giverName,
  startDate,
  startTime,
  endDate,
  endTime,
}) => {
  const safeStart = startDate
    ? format(new Date(startDate), "dd/MM/yyyy", { locale: he })
    : "";
  const safeEnd = endDate
    ? format(new Date(endDate), "dd/MM/yyyy", { locale: he })
    : safeStart;
  return `היי *${recipientName || ""}*! 🎁\nלקחתי לך את המשמרת במתנה — אין צורך להגיע 🙌\n\n📅 המשמרת: מ-${safeStart} בשעה ${startTime || ""} ועד ${safeEnd} בשעה ${endTime || ""} ⏰\n\nנהנה מהמתנה! ✌️${giverName ? `\n— ${giverName}` : ""}`;
};
