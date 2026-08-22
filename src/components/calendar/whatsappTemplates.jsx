import { format, addDays } from "date-fns";
import { he } from "date-fns/locale";
import { base44 } from "@/api/base44Client";

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
    // Base "assignment" rows record ownership, not a coverage band — exclude
    // them so the owner's own row is never counted as phantom coverage. Cancel
    // now DELETES a cover row, so any present cover row is active; we must NOT
    // gate on status === "Approved" (Phase 4 covers are created with no status,
    // and base44's old default would stamp them "Pending"). The only status that
    // still means "not active" is a leftover pre-Phase-4 "Cancelled" row, kept
    // out here until the Phase 5 cleanup deletes them.
    (cov) => cov.type !== "assignment" && cov.status !== "Cancelled",
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

// The serial_id of whoever currently owns a shift, read from the base
// "assignment" ShiftCoverage row (the ownership ledger introduced in the schema
// refactor), falling back to the legacy shift.original_user_id while that column
// still exists (Phase 3 dual-read; the field is removed in Phase 4). `coverages`
// may be the full ShiftCoverage list or a subset — only the assignment row for
// this shift is consulted. Returns undefined for a null shift.
export const resolveOwnerId = (shift, coverages = []) => {
  if (!shift) return undefined;
  // Ownership is the base "assignment" ShiftCoverage row's covering_user_id.
  // Shift.original_user_id was removed in Phase 4, so there is no fallback — a
  // shift with no assignment row simply has no resolvable owner (undefined).
  const assignment = (coverages || []).find(
    (c) => c.type === "assignment" && c.shift_id === shift.id,
  );
  return assignment?.covering_user_id;
};

// The base "assignment" ShiftCoverage row for a shift, if present in the given
// list. Pure lookup (no I/O).
export const findAssignmentCoverage = (shiftId, coverages = []) =>
  (coverages || []).find(
    (c) => c.type === "assignment" && c.shift_id === shiftId,
  );

// The full field set for a base assignment row covering a WHOLE shift. It
// records ownership (type:"assignment"), not a coverage band; every coverage
// reader excludes type:"assignment" rows. The cover_* window mirrors the shift.
export const buildAssignmentCoverageFields = (shift, ownerId) => ({
  shift_id: shift.id,
  covering_user_id: Number(ownerId),
  type: "assignment",
  cover_start_date: shift.start_date,
  cover_end_date: shift.end_date,
  cover_start_time: shift.start_time || "09:00",
  cover_end_time: shift.end_time || "09:00",
});

// Phase 3 dual-write: after a shift's owner changes, bring its base assignment
// row in step. Prefers the row from an already-loaded `coverages` list; falls
// back to a targeted fetch; creates the row if the shift somehow has none
// (e.g. it predates the migration). Callers still write Shift.original_user_id
// too, until Phase 4 removes that column.
export const syncAssignmentOwner = async (shiftId, newOwnerId, coverages) => {
  let existing = coverages && findAssignmentCoverage(shiftId, coverages);
  if (!existing) {
    const rows = await base44.entities.ShiftCoverage.filter({
      shift_id: shiftId,
      type: "assignment",
    });
    existing = rows[0];
  }
  if (existing) {
    return base44.entities.ShiftCoverage.update(existing.id, {
      covering_user_id: Number(newOwnerId),
    });
  }
  const shift = await base44.entities.Shift.get(shiftId);
  return base44.entities.ShiftCoverage.create(
    buildAssignmentCoverageFields(shift, newOwnerId),
  );
};

// Phase 3 dual-write: create the base assignment row for a newly created shift.
export const createAssignmentForShift = (shift, ownerId) =>
  base44.entities.ShiftCoverage.create(
    buildAssignmentCoverageFields(shift, ownerId),
  );

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

  // --- Ownership from the coverage ledger ---
  // The base "assignment" ShiftCoverage row is the single source of truth for
  // who owns the slot (Shift.original_user_id was removed in Phase 4). The
  // assignment row records ownership, not a coverage band, so it's pulled out
  // here and excluded from the covers below.
  const rawShiftCoverages = (coverages || []).filter(
    (c) => c.shift_id === shift.id || !c.shift_id,
  );
  const assignmentCoverage = rawShiftCoverages.find(
    (c) => c.type === "assignment",
  );
  const ownerId = assignmentCoverage?.covering_user_id;

  const activeRequest =
    activeRequestOverride ||
    shift.active_request ||
    swapRequests?.find(
      (sr) =>
        sr.shift_ids?.includes(shift.id) &&
        sr.status !== "Cancelled" &&
        // A request only describes this shift's CURRENT state if it was made
        // by the shift's current owner. Once ownership is reassigned (head-to-
        // head / gift accept), the old (now-Closed) request still lists this
        // shift's id in shift_ids forever — without this check it would keep
        // being found and force displayStatus to "covered" permanently,
        // blocking the new owner from ever requesting a swap on their own shift.
        Number(sr.requesting_user_id) === Number(ownerId),
    );
  const requestType = resolveSwapType(shift, activeRequest);
  const requestWindow = resolveRequestWindow(shift, activeRequest);
  const shiftWindow = resolveShiftWindow(shift, requestWindow);

  const originalUser =
    allUsers?.find((u) => Number(u.serial_id) === Number(ownerId)) ||
    shift.original_user_data;
  const shiftCoverages = rawShiftCoverages
    .filter((c) => c.type !== "assignment")
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

  // Status is derived purely from the active request + coverage — Shift.status
  // no longer exists (Phase 4). A shift with no active request and no full
  // coverage is a plain, unswapped shift ("regular"). Once a request is
  // cancelled or force-deleted (so activeRequest no longer resolves), the shift
  // returns to "regular" on its own — no leftover shift.status can pin it to a
  // stale swap state, which is exactly the orphan-coverage bug this refactor kills.
  let displayStatus = "regular";
  if (activeRequest) {
    if (activeRequest.status === "Closed") displayStatus = "covered";
    else if (
      activeRequest.status === "Partially_Covered" ||
      requestType === "partial"
    )
      displayStatus = "partial";
    else if (activeRequest.status === "Open")
      displayStatus = requestType === "partial" ? "partial" : "requested";
  }
  if (isFullyCovered) {
    displayStatus = "covered";
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
    // Derived owner from the assignment coverage row, exposed under the familiar
    // `original_user_id` key so every consumer of the normalized shift reads the
    // ledger. (The Shift column of the same name was removed in Phase 4; this is
    // a computed field on the normalized object, not the raw column.)
    original_user_id: ownerId != null ? Number(ownerId) : undefined,
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
      ? Number(ownerId) === Number(currentUser.serial_id) ||
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

// A "gift" is a one-directional takeover: an RR user offers to take today's
// shift off the person doing it, with nothing expected in return. The offer is
// sent as a request the recipient accepts in-app; this message lets the giver
// nudge them over WhatsApp to go approve it.
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
  return `היי *${recipientName || ""}*! 🎁\nרוצה לתת לך מתנה — לקחת על עצמי את המשמרת שלך, בלי תמורה 🙌\n\n📅 המשמרת: מ-${safeStart} בשעה ${startTime || ""} ועד ${safeEnd} בשעה ${endTime || ""} ⏰\n\nכל מה שצריך זה לאשר את ההצעה באפליקציה (בקשות אליי) ✅${giverName ? `\n— ${giverName}` : ""}`;
};
