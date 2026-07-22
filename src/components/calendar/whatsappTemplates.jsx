import { format, addDays } from 'date-fns';
import { he } from 'date-fns/locale';

// --- Shared swap helpers (centralized to avoid duplication across modals) ---
export const resolveSwapType = (shift, activeRequest) => {
  const explicit = activeRequest?.request_type || shift?.request_type || shift?.coverageType || shift?.swap_type;
  if (explicit && String(explicit).toLowerCase() === 'partial') return 'partial';
  if (explicit && String(explicit).toLowerCase() === 'full') return 'full';

  const start = activeRequest?.req_start_time || shift?.req_start_time || shift?.start_time;
  const end = activeRequest?.req_end_time || shift?.req_end_time || shift?.end_time;
  if (start && end && start !== end) return 'partial';
  return 'full';
};

export const resolveRequestWindow = (shift, activeRequest) => {
  const startDate = activeRequest?.req_start_date || shift?.req_start_date || shift?.start_date || shift?.date;
  const endDate = activeRequest?.req_end_date || shift?.req_end_date || shift?.end_date || startDate;
  const startTime = activeRequest?.req_start_time || shift?.req_start_time || shift?.start_time || '09:00';
  const endTime = activeRequest?.req_end_time || shift?.req_end_time || shift?.end_time || startTime;
  return { startDate, endDate, startTime, endTime };
};

export const buildDateTime = (dateStr, timeStr) => {
  if (!dateStr || !timeStr) return null;
  const dt = new Date(`${dateStr}T${timeStr}`);
  return isNaN(dt.getTime()) ? null : dt;
};

export const normalizeCoverageEntry = (coverage, fallbackWindow) => ({
  ...coverage,
  cover_start_date: coverage.cover_start_date || coverage.start_date || fallbackWindow.startDate,
  cover_end_date: coverage.cover_end_date || coverage.end_date || fallbackWindow.endDate,
  cover_start_time: coverage.cover_start_time || coverage.start_time || fallbackWindow.startTime,
  cover_end_time: coverage.cover_end_time || coverage.end_time || fallbackWindow.endTime
});

export const resolveShiftWindow = (shift, requestWindow) => {
  const startDate = shift?.start_date || requestWindow?.startDate || shift?.date;
  const endDate = shift?.end_date || requestWindow?.endDate || startDate;
  const startTime = shift?.start_time || requestWindow?.startTime || '09:00';
  const endTime = shift?.end_time || requestWindow?.endTime || startTime;
  return { startDate, endDate, startTime, endTime };
};

export const calculateMissingSegments = (baseStart, baseEnd, coverageEntries = []) => {
  if (!baseStart || !baseEnd || isNaN(baseStart.getTime()) || isNaN(baseEnd.getTime())) return [];

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
      if (cov.start > seg.start) pieces.push({ start: seg.start, end: cov.start });
      if (cov.end < seg.end) pieces.push({ start: cov.end, end: seg.end });
      return pieces;
    });
  });

  return gaps.filter((gap) => gap.end > gap.start && !isNaN(gap.start.getTime()) && !isNaN(gap.end.getTime()));
};

export const computeCoverageSummary = ({ shift, activeRequest, coverages = [] }) => {
  const requestWindow = resolveRequestWindow(shift, activeRequest);
  const shiftWindow = resolveShiftWindow(shift, requestWindow);
  const requestType = resolveSwapType(shift, activeRequest);
  const useRequestWindow = Boolean(activeRequest) || requestType === 'partial';
  const coverageWindow = useRequestWindow ? requestWindow : shiftWindow;

  const baseStart = buildDateTime(coverageWindow.startDate, coverageWindow.startTime);
  let baseEnd = buildDateTime(coverageWindow.endDate, coverageWindow.endTime);
  if (baseEnd && baseStart && baseEnd <= baseStart) {
    baseEnd = addDays(baseEnd, 1);
  }

  const normalizedCoverages = (coverages || []).map(cov => normalizeCoverageEntry(cov, coverageWindow));
  const approvedCoverages = normalizedCoverages.filter(cov => cov.status === 'Approved' || !cov.status);
  const missingSegments = baseStart && baseEnd
    ? calculateMissingSegments(baseStart, baseEnd, approvedCoverages)
    : [];
  const isFullyCovered = approvedCoverages.length > 0 && missingSegments.length === 0;

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
    isFullyCovered
  };
};

export const normalizeShiftContext = (
  shift,
  {
    allUsers = [],
    swapRequests = [],
    coverages = [],
    currentUser,
    activeRequest: activeRequestOverride
  } = {}
) => {
  if (!shift) return null;

  const activeRequest = activeRequestOverride
    || shift.active_request
    || swapRequests?.find(sr => sr.shift_ids?.includes(shift.id) && sr.status !== 'Cancelled');
  const requestType = resolveSwapType(shift, activeRequest);
  const requestWindow = resolveRequestWindow(shift, activeRequest);
  const shiftWindow = resolveShiftWindow(shift, requestWindow);

  const originalUser = allUsers?.find(u => u.serial_id === shift.original_user_id) || shift.original_user_data;
  const shiftCoverages = (coverages || [])
    .filter(c => c.shift_id === shift.id || !c.shift_id)
    .map(cov => {
      const coveringUser = allUsers?.find(u => u.serial_id === cov.covering_user_id);
      return {
        ...cov,
        covering_name: coveringUser?.full_name || cov.covering_name || 'מחליף',
        covering_email: coveringUser?.email || cov.covering_email || '',
        covering_department: coveringUser?.department || cov.covering_department || ''
      };
    });

  const {
    approvedCoverages,
    missingSegments,
    isFullyCovered,
    normalizedCoverages
  } = computeCoverageSummary({
    shift: { ...shift, ...shiftWindow },
    activeRequest,
    coverages: shiftCoverages
  });

  let displayStatus = shift.status || 'regular';
  if (activeRequest) {
    if (activeRequest.status === 'Closed') displayStatus = 'covered';
    else if (activeRequest.status === 'Partially_Covered' || requestType === 'partial') displayStatus = 'partial';
    else if (activeRequest.status === 'Open' || shift.status === 'Swap_Requested') displayStatus = requestType === 'partial' ? 'partial' : 'requested';
  }
  if (isFullyCovered) {
    displayStatus = 'covered';
  } else if (displayStatus === 'regular' && shiftCoverages.some(cov => cov.status === 'Approved')) {
    displayStatus = requestType === 'partial' ? 'partial' : 'requested';
  }

  const ownerName = originalUser?.full_name || shift.original_user_name || shift.user_name || shift.role || 'לא שובץ';
  const participantNames = [ownerName, ...approvedCoverages.map(cov => cov.covering_name || cov.covering_user_name || cov.covering_person).filter(Boolean)];
  const uniqueParticipants = Array.from(new Set(participantNames.filter(Boolean)));

  return {
    ...shift,
    date: shift.start_date || shift.date,
    role: ownerName,
    department: originalUser?.department || shift.department || '',
    assigned_email: originalUser?.email || shift.assigned_email || '',
    assigned_person: originalUser?.full_name || shift.assigned_person || '',
    user_name: shift.user_name || ownerName,
    status: displayStatus,
    swap_start_time: requestWindow.startTime,
    swap_end_time: requestWindow.endTime,
    swap_type: requestType,
    coverageType: requestType,
    coverages: normalizedCoverages,
    shiftCoverages: normalizedCoverages,
    active_request: activeRequest,
    request_type: activeRequest?.request_type || shift.request_type || (requestType === 'partial' ? 'Partial' : 'Full'),
    original_user_data: originalUser,
    original_user_name: ownerName,
    isMine: currentUser ? shift.original_user_id === currentUser.serial_id : false,
    isCovering: currentUser ? shiftCoverages.some(cov => cov.covering_user_id === currentUser.serial_id) : false,
    start_time: shiftWindow.startTime,
    end_time: shiftWindow.endTime,
    start_date: shiftWindow.startDate,
    end_date: shiftWindow.endDate,
    coverage_participants: uniqueParticipants,
    coverage_missing_segments: missingSegments
  };
};

// Centralized deep link builder so all WhatsApp templates open the same in-app flow
const PRODUCTION_BASE_URL = 'https://razar-toran-b555aef5.base44.app';

export const buildShiftDeepLink = (shiftId) => {
  if (!shiftId) return '';
  return `${PRODUCTION_BASE_URL}?openShiftId=${shiftId}`;
};

export const buildHeadToHeadDeepLink = (targetId, offerId) => {
  if (!targetId || !offerId) return '';
  return `${PRODUCTION_BASE_URL}?headToHeadTarget=${targetId}&headToHeadOffer=${offerId}`;
};

export const buildSwapTemplate = ({ originalOwnerName, employeeName, startDate, startTime, endDate, endTime, approvalUrl, shiftId }) => {
  const safeStart = startDate ? format(new Date(startDate), 'dd/MM/yyyy', { locale: he }) : '';
  const safeEnd = endDate ? format(new Date(endDate), 'dd/MM/yyyy', { locale: he }) : safeStart;
  const resolvedLink = approvalUrl || buildShiftDeepLink(shiftId);
  const ownerName = originalOwnerName || employeeName || '';

  return `היי, פתחתי בקשה ב-Razarto להחלפה למשמרת *${ownerName}* 👮‍♂️\nמתאריך ${safeStart} בשעה ${startTime || ''} ועד תאריך ${safeEnd} בשעה ${endTime || ''} ⏰\n\nמי יכול לעזור? 🙏\nאפשר לאשר כאן:\n${resolvedLink || ''}`;
};

export const buildHeadToHeadTemplate = ({ targetUserName, targetShiftOwner, targetShiftDate, myShiftOwner, myShiftDate, uniqueApprovalUrl }) => {
  return `היי *${targetUserName || ''}*! 👋🏼\nאני מעוניין להחליף איתך משמרת רז״רתו ראש בראש:\n\n🫡 הצעת החלפה:\n🫵🏼 המשמרת שלך: *${targetShiftOwner || ''}* ${targetShiftDate || ''}\n🤞🏼 המשמרת שלי: *${myShiftOwner || ''}* ${myShiftDate || ''}\n\n✅ לחץ כאן לאישור ההחלפה בתוך המערכת:\n${uniqueApprovalUrl || ''}`;
};