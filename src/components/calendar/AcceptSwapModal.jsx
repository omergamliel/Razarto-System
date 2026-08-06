import React, { useState, useEffect, useMemo, useRef } from 'react';
import { format, addDays, addMinutes, differenceInMinutes } from 'date-fns';
import { he } from 'date-fns/locale';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle, Building2, Clock } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from 'sonner';
import { buildDateTime, resolveSwapType, normalizeShiftContext, computeCoverageSummary, resolveShiftWindow, getCoverageColor, subtractSegments } from './whatsappTemplates';

const formatSegmentText = (segment) => {
  const sameDay = format(segment.start, 'dd/MM') === format(segment.end, 'dd/MM');
  const datePart = sameDay
    ? `${format(segment.start, 'EEEE', { locale: he })} • ${format(segment.start, 'dd/MM', { locale: he })}`
    : `${format(segment.start, 'dd/MM')} → ${format(segment.end, 'dd/MM')}`;
  return `${format(segment.start, 'HH:mm')} – ${format(segment.end, 'HH:mm')} | ${datePart}`;
};

export default function AcceptSwapModal({
  isOpen,
  onClose,
  shift,
  onAccept,
  isAccepting,
  existingCoverages = [],
  currentUserId
}) {
  const normalizedShift = useMemo(
    () =>
      normalizeShiftContext(shift, {
        coverages: existingCoverages,
        activeRequest: shift?.active_request || shift?.activeRequest
      }),
    [existingCoverages, shift]
  );
  const [coverFull, setCoverFull] = useState(true);
  const [coverageChoice, setCoverageChoice] = useState('full');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [selectedSegmentIdx, setSelectedSegmentIdx] = useState(0);
  const sliderRef = useRef(null);

  // The current user's own already-approved coverage on this shift, if any —
  // when present, its window is excluded from "taken" so they can drag back
  // into it and adjust what they previously chose instead of being locked out.
  const myCoverage = useMemo(
    () =>
      existingCoverages.find(
        (c) =>
          c.covering_user_id === currentUserId &&
          (c.status === 'Approved' || !c.status)
      ) || null,
    [existingCoverages, currentUserId]
  );
  const otherCoverages = useMemo(
    () => existingCoverages.filter((c) => c.id !== myCoverage?.id),
    [existingCoverages, myCoverage]
  );

  // --- Derived Request Context (keeps logic aligned with ShiftDetailsModal) ---
  const activeRequest = useMemo(() => normalizedShift?.active_request || normalizedShift?.activeRequest || null, [normalizedShift]);
  const requestType = useMemo(() => resolveSwapType(normalizedShift, activeRequest), [activeRequest, normalizedShift]);
  const coverageSummary = useMemo(
    () => computeCoverageSummary({ shift: normalizedShift, activeRequest, coverages: otherCoverages }),
    [activeRequest, otherCoverages, normalizedShift]
  );
  const requestWindow = coverageSummary.requestWindow;
  const requestStartDate = requestWindow.startDate;
  const requestEndDate = requestWindow.endDate;
  const requestStartTime = requestWindow.startTime;
  const requestEndTime = requestWindow.endTime;

  const isPartialRequest = requestType === 'partial';
  const isFullSwapRequest = requestType === 'full';

  // --- Display helpers ---
  const originalUserName = useMemo(() => {
    return (
      normalizedShift?.original_user_name ||
      normalizedShift?.assigned_person ||
      normalizedShift?.role ||
      normalizedShift?.user_name ||
      'לא ידוע'
    );
  }, [normalizedShift]);

  const coveringUserName = useMemo(() => {
    return normalizedShift?.current_user_name || normalizedShift?.covering_user_name || normalizedShift?.covering_name || 'המשתמש הנוכחי';
  }, [normalizedShift]);

  const shiftDepartment = normalizedShift?.department || normalizedShift?.assigned_department || '';
  const shiftWindow = useMemo(
    () => resolveShiftWindow(normalizedShift, requestWindow),
    [normalizedShift, requestWindow]
  );
  const shiftStartDate = shiftWindow.startDate;
  const shiftEndDate = shiftWindow.endDate;
  const baseStart = coverageSummary.baseStart;
  const baseEnd = coverageSummary.baseEnd;

  // The full shift's own bounds (as opposed to baseStart/baseEnd, which are
  // the narrower *requested* coverage window) — the slider track always
  // spans the whole shift so every taken/free portion is visible to scale,
  // even when the active request only covers part of it.
  const fullShiftStart = useMemo(
    () => buildDateTime(shiftStartDate, shiftWindow.startTime),
    [shiftStartDate, shiftWindow.startTime]
  );
  const fullShiftEnd = useMemo(() => {
    const endDateValue = shiftEndDate || shiftStartDate;
    let end = buildDateTime(endDateValue, shiftWindow.endTime);
    if (end && fullShiftStart && end <= fullShiftStart) end = addDays(end, 1);
    return end;
  }, [shiftEndDate, shiftStartDate, shiftWindow.endTime, fullShiftStart]);

  const coverageRows = coverageSummary.approvedCoverages;
  const missingSegments = coverageSummary.missingSegments;

  const selectableSegments = useMemo(
    () => {
      if (!baseStart || !baseEnd) return [];
      return missingSegments.length ? missingSegments : [{ start: baseStart, end: baseEnd }];
    },
    [baseEnd, baseStart, missingSegments]
  );

  const approvedCoverageSegments = useMemo(
    () =>
      coverageRows
        .map((cov) => {
          const start = buildDateTime(cov.cover_start_date, cov.cover_start_time);
          let end = buildDateTime(cov.cover_end_date, cov.cover_end_time);
          if (!start || !end) return null;
          if (end <= start) end = addDays(end, 1);
          return { start, end, label: cov.covering_name || cov.covering_user_name || 'מחליף' };
        })
        .filter(Boolean),
    [coverageRows]
  );

  // Assigns each distinct helper a stable, distinguishable color (by order
  // of first appearance) so multiple people covering different windows of
  // the same shift can be told apart on the slider and in the legend.
  const coveringColorMap = useMemo(() => {
    const map = new Map();
    approvedCoverageSegments.forEach((seg) => {
      if (!map.has(seg.label)) map.set(seg.label, map.size);
    });
    return map;
  }, [approvedCoverageSegments]);

  // The current user's own existing pick, as a date range, shown as its own
  // band on the slider (distinct from "still with the original owner").
  const myCoverageSegment = useMemo(() => {
    if (!myCoverage) return null;
    const start = buildDateTime(myCoverage.cover_start_date, myCoverage.cover_start_time);
    let end = buildDateTime(myCoverage.cover_end_date, myCoverage.cover_end_time);
    if (!start || !end) return null;
    if (end <= start) end = addDays(end, 1);
    return { start, end, label: 'הבחירה הקודמת שלך' };
  }, [myCoverage]);

  // Bands drawn on the slider track: portions already taken by other users
  // (approved coverages), your own existing pick (if you're editing one),
  // and everything else across the FULL shift that still remains with the
  // original owner — including any part outside the narrower requested
  // window — so the picker can see the whole shift's coverage state to
  // scale while dragging their own range.
  const takenBands = useMemo(() => {
    if (!fullShiftStart || !fullShiftEnd) return [];
    const covered = approvedCoverageSegments.map((seg) => ({ ...seg, variant: 'covered' }));
    const mine = myCoverageSegment ? [{ ...myCoverageSegment, variant: 'mine' }] : [];
    // The requested-but-still-uncovered gaps (missingSegments) get their own
    // grey band, distinct from the blue "still with the original owner"
    // band — this is the range someone actually asked for help with and
    // nobody has claimed yet, as opposed to the rest of the shift that was
    // never part of the request in the first place.
    const needsHelp = missingSegments.map((seg) => ({
      start: seg.start,
      end: seg.end,
      label: 'טרם נתפס',
      variant: 'needsHelp'
    }));
    const exclusions = myCoverageSegment
      ? [...approvedCoverageSegments, myCoverageSegment, ...missingSegments]
      : [...approvedCoverageSegments, ...missingSegments];
    const remaining = subtractSegments(fullShiftStart, fullShiftEnd, exclusions).map((seg) => ({
      ...seg,
      label: originalUserName,
      variant: 'original'
    }));
    return [...covered, ...mine, ...needsHelp, ...remaining].sort((a, b) => a.start - b.start);
  }, [approvedCoverageSegments, myCoverageSegment, missingSegments, originalUserName, fullShiftStart, fullShiftEnd]);

  const totalMinutes = fullShiftStart && fullShiftEnd ? differenceInMinutes(fullShiftEnd, fullShiftStart) : 0;
  const toPercent = (date) => {
    if (!fullShiftStart || totalMinutes <= 0 || !date) return 0;
    return Math.max(0, Math.min(100, (differenceInMinutes(date, fullShiftStart) / totalMinutes) * 100));
  };

  // The requestable window (baseStart/baseEnd), expressed in minutes from the
  // full shift's start, is where drag handles are allowed to actually land —
  // the track is wider (the whole shift) but only this slice is coverable.
  const requestMinMinutes = baseStart && fullShiftStart ? differenceInMinutes(baseStart, fullShiftStart) : 0;
  const requestMaxMinutes = baseEnd && fullShiftStart ? differenceInMinutes(baseEnd, fullShiftStart) : totalMinutes;
  const requestMinPercent = totalMinutes > 0 ? Math.max(0, Math.min(100, (requestMinMinutes / totalMinutes) * 100)) : 0;
  const requestMaxPercent = totalMinutes > 0 ? Math.max(0, Math.min(100, (requestMaxMinutes / totalMinutes) * 100)) : 100;

  const selectedStartDT = startDate && startTime ? buildDateTime(startDate, startTime) : null;
  const selectedEndDT = endDate && endTime ? buildDateTime(endDate, endTime) : null;
  const startMinutes = selectedStartDT && fullShiftStart ? differenceInMinutes(selectedStartDT, fullShiftStart) : requestMinMinutes;
  const endMinutes = selectedEndDT && fullShiftStart ? differenceInMinutes(selectedEndDT, fullShiftStart) : requestMaxMinutes;
  const startPercent = totalMinutes > 0 ? Math.max(0, Math.min(100, (startMinutes / totalMinutes) * 100)) : 0;
  const endPercent = totalMinutes > 0 ? Math.max(0, Math.min(100, (endMinutes / totalMinutes) * 100)) : 100;

  // Free windows (missingSegments), expressed in minutes from the full
  // shift's start — used to stop a handle from being dragged into/through a
  // window someone else already has approved coverage on.
  const missingSegmentsInMinutes = fullShiftStart
    ? missingSegments.map((seg) => ({
        start: differenceInMinutes(seg.start, fullShiftStart),
        end: differenceInMinutes(seg.end, fullShiftStart)
      }))
    : [];

  const handleSliderDrag = (e, handle) => {
    if (!sliderRef.current || !fullShiftStart || totalMinutes <= 0) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const distanceFromRight = rect.right - clientX;
    let percentage = distanceFromRight / rect.width;
    percentage = Math.max(0, Math.min(1, percentage));
    let minutes = Math.round(percentage * totalMinutes);
    const step = 15;
    minutes = Math.round(minutes / step) * step;
    minutes = Math.max(requestMinMinutes, Math.min(requestMaxMinutes, minutes));

    // The handle being dragged can't cross past the free window the OTHER
    // (anchored) handle currently sits in — that window's bounds are the
    // hard limit, so the selection can never overlap an already-taken slice.
    const anchorMinutes = handle === 'start' ? endMinutes : startMinutes;
    const activeSegment =
      missingSegmentsInMinutes.find(
        (seg) => anchorMinutes >= seg.start && anchorMinutes <= seg.end
      ) || { start: requestMinMinutes, end: requestMaxMinutes };

    if (handle === 'start') {
      minutes = Math.max(activeSegment.start, minutes);
      if (minutes >= endMinutes) minutes = Math.max(activeSegment.start, endMinutes - step);
      const newStart = addMinutes(fullShiftStart, minutes);
      setStartDate(format(newStart, 'yyyy-MM-dd'));
      setStartTime(format(newStart, 'HH:mm'));
    } else {
      minutes = Math.min(activeSegment.end, minutes);
      if (minutes <= startMinutes) minutes = Math.min(activeSegment.end, startMinutes + step);
      const newEnd = addMinutes(fullShiftStart, minutes);
      setEndDate(format(newEnd, 'yyyy-MM-dd'));
      setEndTime(format(newEnd, 'HH:mm'));
    }
  };

  // Once anyone (other than the person currently editing) already holds an
  // approved slice of this shift, claiming "24 hours full" would silently
  // swallow their slice too — so that option must no longer be offered, and
  // must never be honored even if it somehow gets submitted anyway.
  const hasExistingApprovedCoverage = coverageRows.length > 0;

  const shouldShowMissingBanner = !coverFull && missingSegments.length > 0;

  const fullRangeLabel = useMemo(() => {
    const start = buildDateTime(shiftStartDate, shiftWindow.startTime || requestStartTime || '09:00');
    const endDateValue = shiftEndDate || shiftStartDate;
    const end = buildDateTime(endDateValue, shiftWindow.endTime || requestEndTime || '09:00');
    if (!start || !end) return '';
    const sameDay = shiftEndDate === shiftStartDate || !shiftEndDate;

    try {
      const startText = format(start, "EEEE, d בMMMM HH:mm", { locale: he });
      const endText = format(end, sameDay ? 'HH:mm' : "EEEE, d בMMMM HH:mm", { locale: he });
      return `${startText} - ${endText}`;
    } catch {
      return '';
    }
  }, [requestEndTime, requestStartTime, shift?.end_time, shift?.start_time, shiftEndDate, shiftStartDate]);

  // Initialize and update values when modal opens or shift changes
  useEffect(() => {
    if (!normalizedShift || !isOpen) return;

    // Default Dates
    const defaultStartDate = shiftStartDate ? shiftStartDate : format(new Date(), 'yyyy-MM-dd');
    const defaultEndDate = shiftEndDate ? shiftEndDate : format(addDays(new Date(defaultStartDate), 1), 'yyyy-MM-dd');

    // Get original request times (aligned with ShiftDetailsModal logic)
    const originalStartTime = requestStartTime || normalizedShift?.start_time || '09:00';
    const originalEndTime = requestEndTime || normalizedShift?.end_time || '09:00';

    // Prefer re-showing the user's own previous pick (if they're editing one)
    // over defaulting to the first free gap, so they see exactly what they
    // chose last time and can adjust it from there.
    const defaultSegment =
      myCoverageSegment ||
      missingSegments[0] ||
      (baseStart && baseEnd ? { start: baseStart, end: baseEnd } : null);
    const shouldForcePartial = isPartialRequest || (existingCoverages && existingCoverages.length > 0);

    if (shouldForcePartial) {
      setStartDate(defaultSegment ? format(defaultSegment.start, 'yyyy-MM-dd') : (requestStartDate || defaultStartDate));
      setStartTime(defaultSegment ? format(defaultSegment.start, 'HH:mm') : originalStartTime);
      setEndDate(defaultSegment ? format(defaultSegment.end, 'yyyy-MM-dd') : (requestEndDate || defaultEndDate));
      setEndTime(defaultSegment ? format(defaultSegment.end, 'HH:mm') : originalEndTime);
      setCoverFull(false);
      setCoverageChoice('partial');
      setSelectedSegmentIdx(0);
      return;
    }

    if (isFullSwapRequest) {
      setStartDate(shiftWindow.startDate || defaultStartDate);
      setStartTime(shiftWindow.startTime || originalStartTime);
      setEndDate(shiftWindow.endDate || defaultEndDate);
      setEndTime(shiftWindow.endTime || originalEndTime);
      setCoverFull(true);
      setCoverageChoice('full');
      setSelectedSegmentIdx(0);
    }

  }, [
    existingCoverages,
    isFullSwapRequest,
    isOpen,
    requestEndDate,
    requestEndTime,
    requestStartDate,
    requestStartTime,
    requestType,
    normalizedShift,
    shiftEndDate,
    shiftStartDate,
    baseEnd,
    baseStart,
    missingSegments,
    isPartialRequest,
    shiftWindow,
    myCoverageSegment
  ]);

  // When a user switches segment tabs, snap the inputs to the selected gap
  useEffect(() => {
    if (!selectableSegments[selectedSegmentIdx] || coverFull) return;
    const segment = selectableSegments[selectedSegmentIdx];
    setStartDate(format(segment.start, 'yyyy-MM-dd'));
    setStartTime(format(segment.start, 'HH:mm'));
    setEndDate(format(segment.end, 'yyyy-MM-dd'));
    setEndTime(format(segment.end, 'HH:mm'));
  }, [coverFull, selectableSegments, selectedSegmentIdx]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Prepare Submission Data
    const wantsFull = !isPartialRequest && coverageChoice === 'full' && !hasExistingApprovedCoverage;
    let submissionData = {
        type: wantsFull ? 'Full' : 'Partial',
        // If full, take defaults from shift, else take form inputs
        startTime: wantsFull ? (normalizedShift?.start_time || requestStartTime || '09:00') : startTime,
        endTime: wantsFull ? (normalizedShift?.end_time || requestEndTime || '09:00') : endTime,
        startDate: wantsFull ? (normalizedShift?.start_date || shiftStartDate) : startDate,
        endDate: wantsFull ? (normalizedShift?.end_date || shiftEndDate || shiftStartDate) : endDate,
        // When set, the parent mutation updates this existing coverage instead
        // of creating a new one — lets a user edit what they already chose.
        coverageId: myCoverage?.id || null
    };

    // Validation for Partial
    if (!wantsFull) {
      if (!startDate || !startTime || !endDate || !endTime) {
        toast.error('נא למלא את כל השדות');
        return;
      }
      const start = buildDateTime(startDate, startTime);
      const end = buildDateTime(endDate, endTime);

      if (!start || !end || start >= end) {
        toast.error('שעת הסיום חייבת להיות אחרי שעת ההתחלה');
        return;
      }

      if (!baseStart || !baseEnd) {
        toast.error('אירעה שגיאה בטעינת גבולות המשמרת');
        return;
      }

      if (missingSegments.length === 0) {
        toast.error('כל חלונות הכיסוי כבר מאוישים');
        return;
      }

      if (start < baseStart || end > baseEnd) {
        toast.error('יש לבחור שעות בתוך טווח המשמרת');
        return;
      }

      const selectedWindow = missingSegments.find(
        (segment) => start >= segment.start && end <= segment.end
      );

      if (!selectedWindow) {
        toast.error('יש לבחור טווח בתוך אחד החלונות הפנויים');
        return;
      }

      const overlapsCoverage = approvedCoverageSegments.some(
        (segment) => start < segment.end && end > segment.start
      );

      if (overlapsCoverage) {
        toast.error('הטווח שבחרת חופף לכיסוי שכבר אושר');
        return;
      }
    }

    try {
      await onAccept(submissionData);
      if (wantsFull) {
        toast.success('ההחלפה בוצעה בהצלחה!');
      }
    } catch {
      toast.error('אירעה שגיאה בעת שליחת הכיסוי');
    }
  };

  if (!isOpen || !normalizedShift) return null;

  const statusLabelClasses = requestType === 'partial'
    ? 'bg-yellow-100 text-yellow-900 border border-yellow-200'
    : 'bg-red-100 text-red-900 border border-red-200';

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

        <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col">

          <div className="bg-gradient-to-r from-[#64B5F6] to-[#42A5F5] p-6 text-white">
            <button onClick={onClose} className="absolute top-4 left-4 p-2 rounded-full hover:bg-white/20 transition-colors"><X className="w-5 h-5" /></button>
            <div className="flex items-center gap-3">
              <div className="p-3 bg-white/20 rounded-xl"><CheckCircle className="w-6 h-6" /></div>
              <div className="space-y-1">
                <h2 className="text-xl font-bold">כיסוי משמרת</h2>
                <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold tracking-tight ${statusLabelClasses}`}>
                  {requestType === 'partial' ? 'בקשה לכיסוי חלקי' : 'בקשה לכיסוי מלא'}
                </span>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1" dir="rtl">

            {/* Top context box: original user, department and range */}
            <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm space-y-4 text-right">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-blue-50 text-blue-600"><Building2 className="w-5 h-5" /></div>
                <div className="flex flex-col">
                  <span className="text-sm text-gray-500">משמרת של</span>
                  <span className="text-lg font-bold text-gray-900">{originalUserName}</span>
                  {shiftDepartment && <span className="text-xs text-gray-600">{shiftDepartment}</span>}
                </div>
              </div>

              <div className="bg-gray-50 rounded-2xl border border-gray-100 px-4 py-3 shadow-inner grid grid-cols-2 gap-4 text-center">
                <div className="space-y-1">
                  <p className="text-xs text-gray-500">התחלה</p>
                  <p className="text-xl font-bold text-gray-800">{normalizedShift?.start_time}</p>
                  <p className="text-sm text-gray-500">{shiftStartDate ? format(new Date(shiftStartDate), 'EEEE, dd/MM', { locale: he }) : ''}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-gray-500">סיום</p>
                  <p className="text-xl font-bold text-gray-800">{normalizedShift?.end_time}</p>
                  <p className="text-sm text-gray-500">{shiftEndDate ? format(new Date(shiftEndDate), 'EEEE, dd/MM', { locale: he }) : ''}</p>
                </div>
              </div>
            </div>

            {/* Decision UI shown for all cases */}
            <div className="space-y-4">
              <div className={`grid grid-cols-1 ${isPartialRequest || hasExistingApprovedCoverage ? '' : 'sm:grid-cols-2'} gap-3`}>
                {!isPartialRequest && !hasExistingApprovedCoverage && (
                  <button
                    type="button"
                    onClick={() => { setCoverFull(true); setCoverageChoice('full'); }}
                    className={`w-full p-4 sm:p-5 rounded-2xl text-white font-bold text-lg transition-all shadow-md ${coverFull ? 'bg-green-600 ring-4 ring-green-200 scale-[1.02]' : 'bg-green-500 hover:bg-green-600'}`}
                  >
                    כן, 24 שעות
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setCoverFull(false); setCoverageChoice('partial'); }}
                  className={`w-full p-4 sm:p-5 rounded-2xl text-white font-bold text-lg transition-all shadow-md ${!coverFull ? 'bg-red-600 ring-4 ring-red-200 scale-[1.02]' : 'bg-red-500 hover:bg-red-600'}`}
                >
                  {isPartialRequest || hasExistingApprovedCoverage ? 'כיסוי חלקי' : 'לא, כיסוי חלקי'}
                </button>
              </div>
              {hasExistingApprovedCoverage && !isPartialRequest && (
                <p className="text-xs text-gray-500 text-center -mt-2">
                  חלק מהמשמרת כבר מכוסה על ידי משתמש אחר, לכן ניתן לכסות רק את מה שנותר.
                </p>
              )}
            </div>

            {shouldShowMissingBanner && (
              <div className="bg-red-50 border border-red-100 rounded-2xl p-4 space-y-2 text-right shadow-sm">
                <p className="text-sm font-semibold text-red-700">חלונות שלא כוסו עדיין</p>
                <div className="space-y-2 text-[13px] text-red-800">
                  {missingSegments.map((seg, idx) => (
                    <div key={`${seg.start}-${idx}`} className="flex items-center justify-center">
                      <span dir="ltr" className="font-mono text-sm bg-white/70 px-2 py-1 rounded-lg border border-red-100">{formatSegmentText(seg)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <AnimatePresence>
              {!coverFull && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-4 overflow-hidden"
                >
                  <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <div className="rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-700">
                      <p className="font-semibold text-gray-800 mb-1">גבולות המשמרת המלאים</p>
                      <p className="text-sm" dir="ltr">{fullRangeLabel}</p>
                    </div>

                    <div className="flex flex-wrap gap-2" role="list" aria-label="חלונות זמינים">
                      {selectableSegments.map((seg, idx) => (
                        <button
                          key={`${seg.start}-${idx}`}
                          type="button"
                          onClick={() => setSelectedSegmentIdx(idx)}
                          className={`flex-1 min-w-[140px] px-3 py-2 rounded-xl border text-xs sm:text-sm transition-all ${selectedSegmentIdx === idx ? 'border-blue-500 bg-white shadow-sm' : 'border-gray-200 bg-white/70 hover:border-blue-200'}`}
                        >
                          <p className="text-sm text-gray-600" dir="ltr">{formatSegmentText(seg)}</p>
                        </button>
                      ))}
                    </div>

                    {/* --- RANGE SLIDER (mirrors SwapRequestModal) --- */}
                    <div className="px-4 pt-4 pb-4 select-none touch-none bg-gray-50 rounded-2xl border border-gray-100 shadow-sm relative">

                      {/* Top Labels */}
                      <div className="flex justify-between text-xs font-bold text-gray-600 px-1">
                          <div className="text-center">
                              <span>התחלה</span>
                              <div className="text-xs font-normal text-gray-500 mt-0.5">{startDate ? format(new Date(startDate), 'dd/MM/yyyy') : ''}</div>
                          </div>
                          <div className="text-center">
                              <span>סיום</span>
                              <div className="text-xs font-normal text-gray-500 mt-0.5">{endDate ? format(new Date(endDate), 'dd/MM/yyyy') : ''}</div>
                          </div>
                      </div>

                      {/* Track wrapper: generous clearance above (stacked band labels) and below (handle time tooltips) so nothing overlaps the top date labels or the legend */}
                      <div className="relative mx-8 mt-16 mb-20">
                      <div ref={sliderRef} className="relative h-3 bg-gray-200 rounded-full">

                          {/* Taken windows: other users' approved coverage + what remains with the original owner, spanning the FULL shift */}
                          {takenBands.map((band, idx) => {
                            const right = toPercent(band.start);
                            const width = Math.max(0, toPercent(band.end) - right);
                            const bandColors =
                              band.variant === 'original'
                                ? { bg: 'bg-blue-200', text: 'text-blue-700' }
                                : band.variant === 'mine'
                                ? { bg: 'bg-green-200', text: 'text-green-700' }
                                : band.variant === 'needsHelp'
                                ? { bg: 'bg-gray-300', text: 'text-gray-600' }
                                : getCoverageColor(coveringColorMap.get(band.label) ?? 0);
                            return (
                              <div
                                key={idx}
                                className={`absolute h-full rounded-full ${bandColors.bg}`}
                                style={{ right: `${right}%`, width: `${width}%` }}
                                title={`${band.label}: ${format(band.start, 'HH:mm')}–${format(band.end, 'HH:mm')}`}
                              >
                                {width > 8 && (
                                  <span
                                    className={`absolute right-1/2 translate-x-1/2 text-[10px] font-semibold whitespace-nowrap ${idx % 2 === 0 ? '-top-6' : '-top-11'} ${bandColors.text}`}
                                  >
                                    {band.label}
                                  </span>
                                )}
                              </div>
                            );
                          })}

                          {/* Boundary ticks: edges of the requestable/coverable window within the full shift */}
                          {requestMinPercent > 0.5 && (
                            <div
                              className="absolute w-[2px] h-5 -top-1 bg-gray-500/60 rounded-full"
                              style={{ right: `${requestMinPercent}%` }}
                              title="תחילת החלון הניתן לכיסוי"
                            />
                          )}
                          {requestMaxPercent < 99.5 && (
                            <div
                              className="absolute w-[2px] h-5 -top-1 bg-gray-500/60 rounded-full"
                              style={{ right: `${requestMaxPercent}%` }}
                              title="סוף החלון הניתן לכיסוי"
                            />
                          )}

                          {/* Selected Range Bar */}
                          <div
                              className="absolute h-full bg-[#EF5350] rounded-full opacity-90 shadow-sm ring-2 ring-white"
                              style={{
                                  right: `${startPercent}%`,
                                  width: `${Math.max(0, endPercent - startPercent)}%`
                              }}
                          />

                          {/* Start Handle */}
                          <div
                              className="absolute w-7 h-7 bg-white border-[3px] border-[#EF5350] rounded-full -top-2 shadow-md cursor-grab active:cursor-grabbing flex items-center justify-center z-10 hover:scale-110 transition-transform outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#EF5350]"
                              style={{ right: `${startPercent}%`, transform: 'translateX(50%)' }}
                              tabIndex={0}
                              onMouseDown={() => {
                                  const moveHandler = (moveEvent) => handleSliderDrag(moveEvent, 'start');
                                  const upHandler = () => {
                                      window.removeEventListener('mousemove', moveHandler);
                                      window.removeEventListener('mouseup', upHandler);
                                  };
                                  window.addEventListener('mousemove', moveHandler);
                                  window.addEventListener('mouseup', upHandler);
                              }}
                              onTouchStart={() => {
                                  const moveHandler = (moveEvent) => handleSliderDrag(moveEvent, 'start');
                                  const upHandler = () => {
                                      window.removeEventListener('touchmove', moveHandler);
                                      window.removeEventListener('touchend', upHandler);
                                  };
                                  window.addEventListener('touchmove', moveHandler);
                                  window.addEventListener('touchend', upHandler);
                              }}
                          >
                              <div className="absolute top-9 bg-[#EF5350] text-white text-xs font-bold py-1 px-2 rounded-md shadow-sm whitespace-nowrap after:content-[''] after:absolute after:bottom-full after:left-1/2 after:-translate-x-1/2 after:border-4 after:border-transparent after:border-b-[#EF5350]">
                                  {startTime}
                              </div>
                          </div>

                          {/* End Handle */}
                          <div
                              className="absolute w-7 h-7 bg-white border-[3px] border-[#EF5350] rounded-full -top-2 shadow-md cursor-grab active:cursor-grabbing flex items-center justify-center z-10 hover:scale-110 transition-transform outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#EF5350]"
                              style={{ right: `${endPercent}%`, transform: 'translateX(50%)' }}
                              tabIndex={0}
                              onMouseDown={() => {
                                  const moveHandler = (moveEvent) => handleSliderDrag(moveEvent, 'end');
                                  const upHandler = () => {
                                      window.removeEventListener('mousemove', moveHandler);
                                      window.removeEventListener('mouseup', upHandler);
                                  };
                                  window.addEventListener('mousemove', moveHandler);
                                  window.addEventListener('mouseup', upHandler);
                              }}
                              onTouchStart={() => {
                                  const moveHandler = (moveEvent) => handleSliderDrag(moveEvent, 'end');
                                  const upHandler = () => {
                                      window.removeEventListener('touchmove', moveHandler);
                                      window.removeEventListener('touchend', upHandler);
                                  };
                                  window.addEventListener('touchmove', moveHandler);
                                  window.addEventListener('touchend', upHandler);
                              }}
                          >
                              <div className="absolute top-9 bg-[#EF5350] text-white text-xs font-bold py-1 px-2 rounded-md shadow-sm whitespace-nowrap after:content-[''] after:absolute after:bottom-full after:left-1/2 after:-translate-x-1/2 after:border-4 after:border-transparent after:border-b-[#EF5350]">
                                  {endTime}
                              </div>
                          </div>
                      </div>
                      </div>

                      {/* Legend */}
                      <div className="flex items-center justify-center flex-wrap gap-3 text-[11px] text-gray-500">
                          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-blue-200 inline-block" /> נשאר אצל {originalUserName}</span>
                          {missingSegments.length > 0 && (
                            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-gray-300 inline-block" /> טרם נתפס</span>
                          )}
                          {Array.from(coveringColorMap.entries()).map(([name, colorIdx]) => (
                            <span key={name} className="flex items-center gap-1">
                              <span className={`w-3 h-3 rounded-full inline-block ${getCoverageColor(colorIdx).dot}`} /> {name}
                            </span>
                          ))}
                          {myCoverageSegment && (
                            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-200 inline-block" /> הבחירה הקודמת שלך</span>
                          )}
                          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-[#EF5350] inline-block" /> הבחירה הנוכחית שלך</span>
                      </div>
                    </div>

                    {/* Manual Inputs */}
                    <div className="bg-white rounded-2xl p-5 grid grid-cols-2 gap-4 border border-gray-100 shadow-sm">
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                            <Clock className="w-4 h-4 text-gray-400" /> התחלה
                        </Label>
                        <Input type="time" dir="ltr" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="text-center h-12 font-mono text-lg border-gray-200 focus:border-[#EF5350] focus:ring-[#EF5350]" />
                        <Input type="date" dir="ltr" value={startDate} min={shiftWindow.startDate} max={shiftWindow.endDate} onChange={(e) => setStartDate(e.target.value)} className="text-center h-9 text-xs bg-gray-50" />
                        <p className="text-[11px] text-gray-500 text-center" dir="rtl">
                          {startDate ? format(new Date(startDate), 'EEEE, dd/MM', { locale: he }) : ''}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                            <Clock className="w-4 h-4 text-gray-400" /> סיום
                        </Label>
                        <Input type="time" dir="ltr" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="text-center h-12 font-mono text-lg border-gray-200 focus:border-[#EF5350] focus:ring-[#EF5350]" />
                        <Input type="date" dir="ltr" value={endDate} min={shiftWindow.startDate} max={shiftWindow.endDate} onChange={(e) => setEndDate(e.target.value)} className="text-center h-9 text-xs bg-gray-50" />
                        <p className="text-[11px] text-gray-500 text-center" dir="rtl">
                          {endDate ? format(new Date(endDate), 'EEEE, dd/MM', { locale: he }) : ''}
                        </p>
                      </div>
                    </div>

                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {coverFull && (
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 shadow-sm space-y-2 text-right">
                <p className="text-sm font-bold text-blue-900">סיכום השינויים</p>
                <p className="text-sm text-blue-800 leading-relaxed">
                  תתבצע החלפה במשמרת זו בין המשתמשים <span className="font-bold">{originalUserName}</span> (מקורי) לבין <span className="font-bold">{coveringUserName}</span> (מחליף).
                </p>
                {missingSegments.length > 0 && (
                  <p className="text-xs text-blue-900/80 leading-relaxed">
                    כיסוי מלא יתפוס את כל החלונות החסרים המופיעים למעלה ויעדכן את המשמרת כמאוישת.
                  </p>
                )}
              </div>
            )}

            <Button
              type="submit"
              disabled={isAccepting}
              className="w-full bg-gradient-to-r from-[#64B5F6] to-[#42A5F5] hover:from-[#42A5F5] hover:to-[#2196F3] text-white py-6 rounded-xl text-lg font-medium shadow-lg mt-2"
            >
              {isAccepting ? 'מעבד...' : (myCoverage ? 'עדכן את הכיסוי שלך' : 'אשר כיסוי')}
            </Button>

          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}