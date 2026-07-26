import React, { useState, useEffect, useMemo, useRef } from 'react';
import { format, addDays, addMinutes, differenceInMinutes } from 'date-fns';
import { he } from 'date-fns/locale';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle, Building2, Clock } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from 'sonner';
import { buildDateTime, resolveSwapType, normalizeShiftContext, computeCoverageSummary, resolveShiftWindow } from './whatsappTemplates';

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
  existingCoverages = []
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

  // --- Derived Request Context (keeps logic aligned with ShiftDetailsModal) ---
  const activeRequest = useMemo(() => normalizedShift?.active_request || normalizedShift?.activeRequest || null, [normalizedShift]);
  const requestType = useMemo(() => resolveSwapType(normalizedShift, activeRequest), [activeRequest, normalizedShift]);
  const coverageSummary = useMemo(
    () => computeCoverageSummary({ shift: normalizedShift, activeRequest, coverages: existingCoverages }),
    [activeRequest, existingCoverages, normalizedShift]
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
    return normalizedShift?.current_user_name || normalizedShift?.covering_user_name || normalizedShift?.covering_name || 'את/ה';
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
  
  // Bands drawn on the slider track: portions already taken by other users
  // (approved coverages) and the portions still remaining with the original
  // owner (the gaps between those coverages), so the picker can see the
  // whole shift's coverage state at a glance while dragging their own range.
  const takenBands = useMemo(() => {
    if (!baseStart || !baseEnd) return [];
    const covered = approvedCoverageSegments.map((seg) => ({ ...seg, variant: 'covered' }));
    const remaining = missingSegments.map((seg) => ({ ...seg, label: originalUserName, variant: 'original' }));
    return [...covered, ...remaining].sort((a, b) => a.start - b.start);
  }, [approvedCoverageSegments, missingSegments, originalUserName, baseStart, baseEnd]);

  const totalMinutes = baseStart && baseEnd ? differenceInMinutes(baseEnd, baseStart) : 0;
  const toPercent = (date) => {
    if (!baseStart || totalMinutes <= 0 || !date) return 0;
    return Math.max(0, Math.min(100, (differenceInMinutes(date, baseStart) / totalMinutes) * 100));
  };

  const selectedStartDT = startDate && startTime ? buildDateTime(startDate, startTime) : null;
  const selectedEndDT = endDate && endTime ? buildDateTime(endDate, endTime) : null;
  const startMinutes = selectedStartDT && baseStart ? differenceInMinutes(selectedStartDT, baseStart) : 0;
  const endMinutes = selectedEndDT && baseStart ? differenceInMinutes(selectedEndDT, baseStart) : totalMinutes;
  const startPercent = totalMinutes > 0 ? Math.max(0, Math.min(100, (startMinutes / totalMinutes) * 100)) : 0;
  const endPercent = totalMinutes > 0 ? Math.max(0, Math.min(100, (endMinutes / totalMinutes) * 100)) : 100;

  const handleSliderDrag = (e, handle) => {
    if (!sliderRef.current || !baseStart || totalMinutes <= 0) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    const distanceFromRight = rect.right - clientX;
    let percentage = distanceFromRight / rect.width;
    percentage = Math.max(0, Math.min(1, percentage));
    let minutes = Math.round(percentage * totalMinutes);
    const step = 15;
    minutes = Math.round(minutes / step) * step;
    minutes = Math.max(0, Math.min(totalMinutes, minutes));

    if (handle === 'start') {
      if (minutes >= endMinutes) minutes = Math.max(0, endMinutes - step);
      const newStart = addMinutes(baseStart, minutes);
      setStartDate(format(newStart, 'yyyy-MM-dd'));
      setStartTime(format(newStart, 'HH:mm'));
    } else {
      if (minutes <= startMinutes) minutes = Math.min(totalMinutes, startMinutes + step);
      const newEnd = addMinutes(baseStart, minutes);
      setEndDate(format(newEnd, 'yyyy-MM-dd'));
      setEndTime(format(newEnd, 'HH:mm'));
    }
  };

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
    } catch (err) {
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

    const defaultSegment = missingSegments[0] || (baseStart && baseEnd ? { start: baseStart, end: baseEnd } : null);
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
    shiftWindow
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
    const wantsFull = !isPartialRequest && coverageChoice === 'full';
    let submissionData = {
        type: wantsFull ? 'Full' : 'Partial',
        // If full, take defaults from shift, else take form inputs
        startTime: wantsFull ? (normalizedShift?.start_time || requestStartTime || '09:00') : startTime,
        endTime: wantsFull ? (normalizedShift?.end_time || requestEndTime || '09:00') : endTime,
        startDate: wantsFull ? (normalizedShift?.start_date || shiftStartDate) : startDate,
        endDate: wantsFull ? (normalizedShift?.end_date || shiftEndDate || shiftStartDate) : endDate
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
    } catch (err) {
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
                  <p className="text-[10px] text-gray-400">התחלה</p>
                  <p className="text-lg font-bold text-gray-800">{normalizedShift?.start_time}</p>
                  <p className="text-[11px] text-gray-500">{shiftStartDate ? format(new Date(shiftStartDate), 'EEEE, dd/MM', { locale: he }) : ''}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-gray-400">סיום</p>
                  <p className="text-lg font-bold text-gray-800">{normalizedShift?.end_time}</p>
                  <p className="text-[11px] text-gray-500">{shiftEndDate ? format(new Date(shiftEndDate), 'EEEE, dd/MM', { locale: he }) : ''}</p>
                </div>
              </div>
            </div>

            {/* Decision UI shown for all cases */}
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-100 p-3 rounded-xl text-right shadow-inner">
                <p className="text-sm sm:text-base text-blue-900 leading-relaxed">
                  עלתה בקשה מהמשתמש/ת <span className="font-bold">{originalUserName}</span> לכיסוי {requestType === 'partial' ? 'חלקי' : 'מלא'} של המשמרת.
                </p>
              </div>

              <div className={`grid grid-cols-1 ${isPartialRequest ? '' : 'sm:grid-cols-2'} gap-3`}>
                {!isPartialRequest && (
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
                  {isPartialRequest ? 'כיסוי חלקי' : 'לא, כיסוי חלקי'}
                </button>
              </div>
            </div>

            {shouldShowMissingBanner && (
              <div className="bg-red-50 border border-red-100 rounded-2xl p-4 space-y-2 text-right shadow-sm">
                <p className="text-sm font-semibold text-red-700">חלונות שלא כוסו עדיין</p>
                <div className="space-y-2 text-[13px] text-red-800">
                  {missingSegments.map((seg, idx) => (
                    <div key={`${seg.start}-${idx}`} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                      <span className="font-bold">חלון #{idx + 1}</span>
                      <span dir="ltr" className="font-mono text-xs bg-white/70 px-2 py-1 rounded-lg border border-red-100">{formatSegmentText(seg)}</span>
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
                  <div className="flex items-center justify-between">
                    <Label className="text-gray-700 font-medium">פרטי הכיסוי שלך</Label>
                    <p className="text-xs text-gray-500">ניתן לבחור רק מתוך החלונות הפנויים</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <div className="rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-700">
                      <p className="font-semibold text-gray-800 mb-1">גבולות המשמרת המלאים</p>
                      <p className="text-[11px]" dir="ltr">{fullRangeLabel}</p>
                    </div>

                    <div className="flex flex-wrap gap-2" role="list" aria-label="חלונות זמינים">
                      {selectableSegments.map((seg, idx) => (
                        <button
                          key={`${seg.start}-${idx}`}
                          type="button"
                          onClick={() => setSelectedSegmentIdx(idx)}
                          className={`flex-1 min-w-[140px] px-3 py-2 rounded-xl border text-xs sm:text-sm transition-all ${selectedSegmentIdx === idx ? 'border-blue-500 bg-white shadow-sm' : 'border-gray-200 bg-white/70 hover:border-blue-200'}`}
                        >
                          <p className="font-semibold text-gray-800">חלון {idx + 1}</p>
                          <p className="text-[11px] text-gray-600" dir="ltr">{formatSegmentText(seg)}</p>
                        </button>
                      ))}
                    </div>

                    {/* --- RANGE SLIDER (mirrors SwapRequestModal) --- */}
                    <div className="px-4 py-10 select-none touch-none bg-gray-50 rounded-2xl border border-gray-100 shadow-sm relative">

                      {/* Top Labels */}
                      <div className="flex justify-between text-xs font-bold text-gray-600 mb-3 px-1">
                          <div className="text-center">
                              <span>התחלה</span>
                              <div className="text-[10px] font-normal text-gray-400 mt-0.5">{startDate ? format(new Date(startDate), 'dd/MM/yyyy') : ''}</div>
                          </div>
                          <div className="text-center">
                              <span>סיום</span>
                              <div className="text-[10px] font-normal text-gray-400 mt-0.5">{endDate ? format(new Date(endDate), 'dd/MM/yyyy') : ''}</div>
                          </div>
                      </div>

                      <div ref={sliderRef} className="relative h-3 bg-gray-200 rounded-full mx-8">

                          {/* Taken windows: other users' approved coverage + what remains with the original owner */}
                          {takenBands.map((band, idx) => {
                            const right = toPercent(band.start);
                            const width = Math.max(0, toPercent(band.end) - right);
                            const isOriginal = band.variant === 'original';
                            return (
                              <div
                                key={idx}
                                className={`absolute h-full rounded-full ${isOriginal ? 'bg-blue-200' : 'bg-purple-200'}`}
                                style={{ right: `${right}%`, width: `${width}%` }}
                                title={`${band.label}: ${format(band.start, 'HH:mm')}–${format(band.end, 'HH:mm')}`}
                              >
                                {width > 12 && (
                                  <span className={`absolute -top-6 right-1/2 translate-x-1/2 text-[10px] font-semibold whitespace-nowrap ${isOriginal ? 'text-blue-700' : 'text-purple-700'}`}>
                                    {band.label}
                                  </span>
                                )}
                              </div>
                            );
                          })}

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

                      {/* Legend */}
                      <div className="flex items-center justify-center flex-wrap gap-3 mt-8 text-[11px] text-gray-500">
                          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-blue-200 inline-block" /> נשאר אצל {originalUserName}</span>
                          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-purple-200 inline-block" /> כבר נלקח</span>
                          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-[#EF5350] inline-block" /> הבחירה שלך</span>
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
                      <div className="flex-1">
                        <Label className="text-xs text-gray-500 mb-1">שעת סיום</Label>
                        <Input type="time" dir="ltr" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="text-center h-10 bg-white" />
                        <p className="text-[11px] text-gray-500 mt-1" dir="ltr">{endTime || ''}</p>
                      </div>
                    </div>

                    <div className="bg-white border border-blue-100 rounded-xl p-3 text-sm text-blue-900 space-y-1">
                      <p className="font-semibold">סיכום בחירה</p>
                      <p className="text-xs" dir="ltr">
                        {startDate && startTime ? format(new Date(`${startDate}T${startTime}`), 'EEEE dd/MM HH:mm', { locale: he }) : ''}
                        {` → `}
                        {endDate && endTime ? format(new Date(`${endDate}T${endTime}`), 'EEEE dd/MM HH:mm', { locale: he }) : ''}
                      </p>
                      <p className="text-[11px] text-blue-800">נא לוודא שהזמנים מתוך החלון שבחרת</p>
                    </div>

                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {coverFull && (
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 shadow-sm space-y-2 text-right">
                <p className="text-sm font-bold text-blue-900">סיכום השינויים</p>
                <p className="text-sm text-blue-800 leading-relaxed">
                  תתבצע החלפה במשמרת זו בין המשתמשים <span className="font-bold">{originalUserName}</span> (מקורי) לבין <span className="font-bold">{coveringUserName}</span> (המחליפ/ה).
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
              {isAccepting ? 'מעבד...' : 'אשר כיסוי'}
            </Button>

          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}