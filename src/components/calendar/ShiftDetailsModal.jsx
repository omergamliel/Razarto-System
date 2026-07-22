import React, { useEffect, useMemo, useState } from 'react';
import { format, addDays } from 'date-fns';
import { he } from 'date-fns/locale';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Calendar, Clock, User, Trash2, CheckCircle, AlertCircle, CalendarPlus, Send, UserRoundPen } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { buildShiftDeepLink, buildSwapTemplate, calculateMissingSegments, resolveSwapType, buildDateTime, computeCoverageSummary } from './whatsappTemplates';
import LoadingSkeleton from '../LoadingSkeleton';

export default function ShiftDetailsModal({
  isOpen,
  onClose,
  shift,
  date,
  onOfferCover,
  onHeadToHead,
  onCancelRequest,
  onDelete,
  onApprove,
  onRequestSwap,
  currentUser,
  isAdmin
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');

  const queryClient = useQueryClient();

  // --- Fetch Active Request Info ---
  const { data: activeRequest, isLoading: isActiveRequestLoading } = useQuery({
    queryKey: ['shift-active-request-details', shift?.id],
    queryFn: async () => {
       if (!shift?.id) return null;
       const reqs = await base44.entities.SwapRequest.filter({ status: 'Open' });
       const match = reqs.find(r => r.shift_ids?.includes(shift.id));
       return match || null;
    },
    enabled: !!shift?.id && isOpen
  });

  // --- Fetch Coverages (by shift to respect coverage ownership) ---
  const { data: coverages = [], isLoading: isCoveragesLoading } = useQuery({
    queryKey: ['shift-coverages-details', shift?.id],
    queryFn: async () => {
      if (!shift?.id) return [];
      return await base44.entities.ShiftCoverage.filter({ shift_id: shift.id });
    },
    enabled: !!shift?.id && isOpen
  });

  const { data: authorizedUsers = [] } = useQuery({
    queryKey: ['authorized-users'],
    queryFn: () => base44.entities.AuthorizedPerson.list(),
    enabled: showReassignModal
  });

  const reassignMutation = useMutation({
    mutationFn: async (newUserId) => {
      return base44.entities.Shift.update(shift.id, { original_user_id: parseInt(newUserId, 10) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['shifts']);
      toast.success('המשמרת הועברה למשתמש החדש');
      setShowReassignModal(false);
      setSelectedUserId('');
    },
    onError: () => {
      toast.error('אירעה שגיאה בעת עדכון המשמרת');
    }
  });

  useEffect(() => {
    if (isOpen && shift) {
      setSelectedDepartment(shift.department || '');
      setSelectedUserId('');
    }
  }, [isOpen, shift]);

  const resolvedActiveRequest = useMemo(() => activeRequest || shift?.active_request || null, [activeRequest, shift]);
  const resolvedSwapType = useMemo(
    () => resolveSwapType(shift, resolvedActiveRequest),
    [resolvedActiveRequest, shift]
  );
  const coverageSummary = useMemo(
    () => computeCoverageSummary({ shift, activeRequest: resolvedActiveRequest, coverages }),
    [coverages, resolvedActiveRequest, shift]
  );
  const requestWindow = coverageSummary.requestWindow;
  const shiftWindow = coverageSummary.shiftWindow;

  const departments = useMemo(() => {
    return [...new Set(authorizedUsers.map(u => u.department))].filter(Boolean).sort();
  }, [authorizedUsers]);

  const departmentUsers = useMemo(() => {
    return selectedDepartment ? authorizedUsers.filter(u => u.department === selectedDepartment) : [];
  }, [authorizedUsers, selectedDepartment]);

  // --- Fetch Covering Users Info (to show names) ---
  const { data: coveringUsers = [] } = useQuery({
      queryKey: ['covering-users-info', coverages],
      queryFn: async () => {
          if (coverages.length === 0) return [];
          const userIds = coverages.map(c => c.covering_user_id);
          // Assuming we can fetch multiple or fetch all and filter
          // Optimized: Fetch all authorized (cached)
          const allAuth = await base44.entities.AuthorizedPerson.list();
          return allAuth.filter(u => userIds.includes(u.serial_id));
      },
      enabled: coverages.length > 0
  });

  const handleDelete = () => {
    if (!shift?.id) return;
    onDelete(shift.id);
    setShowDeleteConfirm(false);
  };

  const shiftStartDate = shiftWindow?.startDate || shift?.start_date || date;
  const shiftEndDate = shiftWindow?.endDate || shift?.end_date || shiftStartDate;

  // Determine State
  const isSwapMode = !!resolvedActiveRequest;
  const isPartial = resolvedSwapType === 'partial';
  const isFull = resolvedSwapType === 'full';
  const isPartialLike = isPartial || shift?.status === 'partial' || shift?.coverageType === 'partial';
  const isDetailsLoading = isActiveRequestLoading || isCoveragesLoading;

  const userEmail = currentUser?.email || currentUser?.Email;
  const isOwnShift = Boolean(
    currentUser?.serial_id
      ? shift?.original_user_id === currentUser.serial_id
      : (userEmail && shift?.assigned_email === userEmail) ||
          (currentUser?.full_name && shift?.user_name === currentUser.full_name)
  );
  const ownerDisplayName = shift?.original_user_name || shift?.user_name || shift?.assigned_person || 'לא ידוע';

  const startTime = shiftWindow?.startTime || shift?.start_time || '09:00';
  const endTime = shiftWindow?.endTime || shift?.end_time || '09:00';
  const startDateObj = shiftStartDate ? new Date(shiftStartDate) : new Date(date || new Date());

  let endDateObj;
  if (shiftEndDate) {
    endDateObj = new Date(shiftEndDate);
  } else {
    const sH = parseInt(startTime.split(':')[0]);
    const eH = parseInt(endTime.split(':')[0]);
    if (eH < sH || (sH === 9 && eH === 9)) {
      endDateObj = addDays(startDateObj, 1);
    } else {
      endDateObj = startDateObj;
    }
  }

  const coverageType = shift?.coverageType || shift?.swap_type || (isPartial ? 'partial' : 'full');
  const approvedCoverages = coverageSummary.approvedCoverages;
  const hasCoverages = approvedCoverages.length > 0;
  const isCoveredSwap = (shift?.status === 'covered' || shift?.status === 'Covered') && hasCoverages;
  const statusLabelClasses = isPartial
    ? 'bg-yellow-100 text-yellow-900 border border-yellow-200'
    : 'bg-red-100 text-red-900 border border-red-200';

  const requestStartStr = requestWindow.startTime;
  const requestEndStr = requestWindow.endTime;
  const requestStartDate = requestWindow.startDate || shiftStartDate;
  const requestEndDate = requestWindow.endDate || shiftEndDate || requestStartDate;

  const coverageRows = useMemo(() => {
    return approvedCoverages
      .map((cov, idx) => {
        const user = coveringUsers.find(u => u.serial_id === cov.covering_user_id);
        const start = buildDateTime(cov.cover_start_date || requestStartDate, cov.cover_start_time || requestStartStr);
        let end = buildDateTime(cov.cover_end_date || requestEndDate, cov.cover_end_time || requestEndStr);
        if (!start || !end) return null;
        if (end <= start) end = addDays(end, 1);
        return {
          id: cov.id || idx,
          name: user?.full_name || cov.covering_name || 'מתנדב',
          start,
          end,
          department: user?.department || cov.covering_department
        };
      })
      .filter(Boolean);
  }, [approvedCoverages, coveringUsers, requestEndDate, requestEndStr, requestStartDate, requestStartStr]);

  // FIXED: Identify covering user for full swap view
  const primaryCoverage = useMemo(() => {
    return approvedCoverages.find(cov => cov.type === 'Full') || approvedCoverages[0];
  }, [approvedCoverages]);

  const coveringUserName = useMemo(() => {
    if (!primaryCoverage) return shift?.user_name;
    const user = coveringUsers.find(u => u.serial_id === primaryCoverage.covering_user_id);
    return user?.full_name || shift?.user_name;
  }, [coveringUsers, primaryCoverage, shift?.user_name]);

  const coveringDepartment = useMemo(() => {
    if (!primaryCoverage) return shift?.department;
    const user = coveringUsers.find(u => u.serial_id === primaryCoverage.covering_user_id);
    return user?.department || shift?.department;
  }, [coveringUsers, primaryCoverage, shift?.department]);
  const ownerDepartment = shift?.department || shift?.original_user_data?.department || '';
  const assignedDisplayName = resolvedSwapType === 'full' && primaryCoverage ? coveringUserName : ownerDisplayName;
  const assignedDepartment = resolvedSwapType === 'full' && primaryCoverage ? coveringDepartment : ownerDepartment;

  const missingSegments = useMemo(() => {
    if (!isPartialLike) return [];
    return coverageSummary.missingSegments;
  }, [coverageSummary.missingSegments, isPartialLike]);

  const isRequestFullyCovered = isPartialLike && approvedCoverages.length > 0 && missingSegments.length === 0;
  const derivedStatus = useMemo(() => {
    const rawStatus = String(shift?.status || '').toLowerCase();
    if (isCoveredSwap || rawStatus === 'covered' || isRequestFullyCovered) return 'covered';
    if (coverageType === 'partial') return 'partial';
    if (rawStatus === 'requested' || rawStatus === 'swap_requested') return 'requested';
    return shift?.status || 'regular';
  }, [coverageType, isCoveredSwap, isRequestFullyCovered, missingSegments.length, shift?.status]);

  const isFullyCovered = derivedStatus === 'covered';
  const requestStatus = resolvedActiveRequest?.status;
  const hasAnyRequest = Boolean(resolvedActiveRequest);
  const hasActiveRequest = requestStatus === 'Open';
  const isPartialRequest = hasAnyRequest && resolvedSwapType === 'partial';
  const isFullRequest = hasAnyRequest && resolvedSwapType === 'full';
  const isRequestOwner = Boolean(
    resolvedActiveRequest?.requesting_user_id &&
      currentUser?.serial_id &&
      resolvedActiveRequest.requesting_user_id === currentUser.serial_id
  ) || (hasAnyRequest && !resolvedActiveRequest?.requesting_user_id && isOwnShift);
  const isWhiteShift = !hasAnyRequest;
  const isCoveredOrClosed = isFullyCovered || requestStatus === 'Closed' || String(shift?.status || '').toLowerCase() === 'covered';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isPastShift = startDateObj < today;

  const canOfferCover = hasActiveRequest && !isOwnShift && !isCoveredOrClosed;
  const canHeadToHead = !isOwnShift && !isCoveredOrClosed && !isPartialRequest && !isPastShift && (isWhiteShift || isFullRequest);
  const canRequestSwap = isOwnShift && !hasActiveRequest;
  const canWhatsappShare = hasActiveRequest && isRequestOwner;
  const canAddToCalendarOrEmail = isOwnShift;

  const statusIndicator = useMemo(() => {
    if (derivedStatus === 'covered') return { color: 'bg-green-400', text: 'מאוישת' };
    if (coverageType === 'partial') return { color: 'bg-yellow-400', text: 'דורשת החלפה חלקית' };
    if (derivedStatus === 'requested') return { color: 'bg-red-500', text: 'דורשת החלפה' };
    return { color: 'bg-gray-400', text: 'פתוחה' };
  }, [coverageType, derivedStatus]);

  const shiftStartDateTime = useMemo(
    () => buildDateTime(shiftStartDate, startTime),
    [shiftStartDate, startTime]
  );

  const shiftEndDateTime = useMemo(() => {
    const end = buildDateTime(shiftEndDate, endTime);
    if (!end || !shiftStartDateTime) return end;
    return end <= shiftStartDateTime ? addDays(end, 1) : end;
  }, [endTime, shiftEndDate, shiftStartDateTime]);

  const ownerSegments = useMemo(() => {
    if (!shiftStartDateTime || !shiftEndDateTime) return [];
    return calculateMissingSegments(shiftStartDateTime, shiftEndDateTime, approvedCoverages);
  }, [approvedCoverages, shiftEndDateTime, shiftStartDateTime]);

  const formatSegment = (start, end) => {
    const sameDay = format(start, 'dd/MM') === format(end, 'dd/MM');
    const datePart = sameDay ? format(start, 'dd/MM') : `${format(start, 'dd/MM')} → ${format(end, 'dd/MM')}`;
    return `${format(start, 'HH:mm')} – ${format(end, 'HH:mm')} (${datePart})`;
  };

  const formatSegmentNarrative = (start, end) => {
    const sameDay = format(start, 'dd/MM') === format(end, 'dd/MM');
    if (sameDay) {
      return `מ־${format(start, 'HH:mm')} עד ${format(end, 'HH:mm')} בתאריך ${format(start, 'dd/MM')}`;
    }
    return `מ־${format(start, 'HH:mm')} ${format(start, 'dd/MM')} עד ${format(end, 'HH:mm')} ${format(end, 'dd/MM')}`;
  };

  const handleAddToCalendar = () => {
     // Google Calendar Logic... (Same as before)
     const title = `משמרת - ${shift.user_name}`;
     const gCalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}`;
     window.open(gCalUrl, '_blank');
  };

  const handleWhatsAppShare = () => {
     const approvalUrl = buildShiftDeepLink(shift.id);
     const originalOwnerName = shift?.original_user_data?.full_name || shift?.original_user_name || shift?.assigned_person || shift?.user_name;
     const message = buildSwapTemplate({
       originalOwnerName,
       startDate: requestStartDate,
       startTime: requestStartStr,
       endDate: requestEndDate,
       endTime: requestEndStr,
       approvalUrl,
       shiftId: shift.id
     });
     const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
     window.open(whatsappUrl, '_blank');
  };

  if (!isOpen || !shift) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
        <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
          
          {/* Header */}
          <div className={`${isFullyCovered ? 'bg-green-600' : 'bg-gradient-to-r from-gray-800 to-gray-900'} p-6 text-white flex-shrink-0 relative`}>
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
                    <button onClick={() => setShowDeleteConfirm(true)} className="p-2 rounded-full hover:bg-white/20 transition-colors">
                        <Trash2 className="w-5 h-5 text-red-400" />
                    </button>
                  </>
                )}
                <button onClick={onClose} className="p-2 rounded-full hover:bg-white/20">
                    <X className="w-5 h-5" />
                </button>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="p-3 bg-white/20 rounded-xl"><Calendar className="w-6 h-6" /></div>
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
                  <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-tight backdrop-blur-sm ${statusLabelClasses}`}>
                    {isPartial ? 'בקשה לכיסוי חלקי' : 'בקשה לכיסוי מלא'}
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
                <p className="text-sm text-gray-500 font-medium">משובץ כרגע למשמרת</p>
                <h2 className="text-2xl font-semibold text-gray-900 leading-none">{assignedDisplayName}</h2>
                {assignedDepartment && (
                  <span className="inline-flex items-center justify-center rounded-full bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-700 border border-gray-200">
                    {`מחלקה ${assignedDepartment}`}
                  </span>
                )}
            </div>

            <div className="flex items-center justify-between bg-gray-50 rounded-2xl p-1 border border-gray-100 shadow-sm">
                {/* Start */}
                <div className="flex-1 text-center py-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                        {format(startDateObj, 'EEEE', { locale: he })}
                    </p>
                    <p className="text-xl font-bold text-gray-800 leading-none mb-1 font-mono">{startTime}</p>
                    <p className="text-[11px] text-gray-400">{format(startDateObj, 'dd/MM/yyyy')}</p>
                </div>

                {/* Divider */}
                <div className="flex flex-col items-center justify-center px-2 text-gray-400">
                    <Clock className="w-5 h-5" />
                </div>

                {/* End */}
                <div className="flex-1 text-center py-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                        {format(endDateObj, 'EEEE', { locale: he })}
                    </p>
                    <p className="text-xl font-bold text-gray-800 leading-none mb-1 font-mono">{endTime}</p>
                    <p className="text-[11px] text-gray-400">{format(endDateObj, 'dd/MM/yyyy')}</p>
                </div>
            </div>

            {isPartialLike && (
              <div className="space-y-3">
                <div className="rounded-2xl bg-yellow-50 border border-yellow-200 p-4 text-sm text-yellow-900 leading-relaxed shadow-sm">
                  <p>
                    המשתמש {ownerDisplayName} ביקש סיוע בהחלפה חלקית בטווח השעות <span dir="ltr">{requestStartStr}–{requestEndStr}</span> בתאריך {format(new Date(requestStartDate), 'dd.MM.yyyy')}
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 shadow-sm">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-white text-gray-700 border border-gray-200">
                        <User className="w-4 h-4" />
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-gray-900">{ownerDisplayName}</p>
                          <span className="px-2 py-0.5 rounded-full bg-gray-200 text-[11px] text-gray-700">בעל המשמרת</span>
                        </div>
                        {ownerSegments.length > 0 ? (
                          ownerSegments.map((seg, idx) => (
                            <p key={`owner-seg-${idx}`} className="text-xs text-gray-700">
                              <span className="font-semibold">בעל המשמרת עושה</span>{' '}
                              <span dir="ltr">{formatSegmentNarrative(seg.start, seg.end)}</span>
                            </p>
                          ))
                        ) : (
                          <p className="text-xs text-gray-600">אין חלון כיסוי פעיל לבעל המשמרת</p>
                        )}
                        {shift.department && <p className="text-[11px] text-gray-500">מחלקה {shift.department}</p>}
                      </div>
                    </div>
                  </div>

                  {hasCoverages && (
                    <div className="rounded-2xl border border-green-200 bg-green-50 p-4 shadow-sm space-y-2">
                      <div className="flex items-center gap-2 text-green-800">
                        <CheckCircle className="w-4 h-4" />
                        <p className="text-sm font-semibold">מי מכסה?</p>
                      </div>
                      <div className="space-y-2">
                        {coverageRows.map(row => (
                          <div key={row.id} className="flex gap-3 rounded-xl bg-white border border-green-200 p-3 shadow-sm">
                            <div className="h-10 w-10 rounded-full bg-green-100 text-green-700 font-bold flex items-center justify-center">
                              {row.name?.slice(0, 2) || 'מת'}
                            </div>
                            <div className="flex-1 space-y-1">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <p className="text-sm font-semibold text-green-900">{row.name}</p>
                                <span className="text-xs text-green-700 font-mono" dir="ltr">{format(row.start, 'HH:mm')} - {format(row.end, 'HH:mm')}</span>
                              </div>
                              {row.department && <p className="text-[11px] text-green-700">מחלקה {row.department}</p>}
                              <p className="text-xs text-green-700">
                                <span className="font-semibold">{row.name}</span>{' '}
                                עוזר/ת ל{ownerDisplayName}{' '}
                                <span dir="ltr">{formatSegmentNarrative(row.start, row.end)}</span>
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {isRequestFullyCovered && (
                    <div className="flex items-start gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-2xl text-green-800 shadow-sm">
                      <CheckCircle className="w-5 h-5" />
                      <div className="space-y-1 text-sm">
                        <p className="font-semibold">הבקשה מאוישת במלואה</p>
                        <p className="text-xs">כל חלון ההחלפה כוסה בהצלחה על ידי המתנדבים.</p>
                      </div>
                    </div>
                  )}

                  {missingSegments.map((seg, idx) => (
                    <div key={`${seg.start}-${idx}`} className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-2xl shadow-sm">
                      <AlertCircle className="w-4 h-4 text-red-600" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-red-700">שעות חסרות</p>
                        <p className="text-xs text-red-700" dir="ltr">{formatSegment(seg.start, seg.end)}</p>
                        <p className="text-[11px] text-red-600">בעל המשמרת המקורי ({ownerDisplayName}) יישאר משויך עד שיושלם כיסוי</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* FIXED: History logs */}
            {isCoveredSwap && (
              <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 space-y-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <img src="https://cdn-icons-png.flaticon.com/128/4305/4305578.png" alt="תיעוד" className="w-5 h-5" />
                  <h4 className="text-sm font-bold text-gray-800">תיעוד החלפות</h4>
                </div>
                <div className="space-y-2 text-sm text-gray-700">
                  <div className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
                    המשתמש/ת <span className="font-bold">{shift.user_name}</span> ביקש החלפה מלאה למשמרת
                  </div>
                  <div className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
                    המשתמש <span className="font-bold">{shift.user_name}</span> הוחלף בצורה מלאה ע"י <span className="font-bold">{coveringUserName}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-3 justify-center">
              {hasActiveRequest && isOwnShift && !isCoveredOrClosed && (
                <Button
                  onClick={() => onCancelRequest?.(shift)}
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
                  <img src="https://cdn-icons-png.flaticon.com/128/9363/9363987.png" alt="עזרה" className="w-5 h-5" />
                  אני רוצה לעזור!
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
                  <img src="https://cdn-icons-png.flaticon.com/128/1969/1969142.png" alt="ראש בראש" className="w-5 h-5" />
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
                    onClick={() => onRequestSwap?.('full', shift)}
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

        {/* Delete Modal */}
        <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>מחיקת משמרת</DialogTitle>
              <DialogDescription>האם את/ה בטוח/ה? הפעולה לא ניתנת לביטול.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
               <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>ביטול</Button>
               <Button variant="destructive" onClick={handleDelete}>מחק</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Reassign Modal */}
        <Dialog open={showReassignModal} onOpenChange={setShowReassignModal}>
          <DialogContent className="sm:max-w-lg">
            <div className="rounded-2xl overflow-hidden shadow-lg">
              <div className="bg-gradient-to-r from-[#64B5F6] to-[#42A5F5] p-4 text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/20 rounded-xl"><Calendar className="w-5 h-5" /></div>
                  <div>
                    <h3 className="text-lg font-bold">החלפת משתמש למשמרת</h3>
                    <p className="text-white/80 text-xs">בחר מחלקה ואז את המשתמש החדש</p>
                  </div>
                </div>
                <button onClick={() => setShowReassignModal(false)} className="p-2 rounded-full hover:bg-white/10 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="space-y-2">
                  <Label className="text-gray-700 font-medium flex items-center gap-2">
                    <User className="w-4 h-4 text-[#64B5F6]" />
                    בחר מחלקה
                  </Label>
                  <Select value={selectedDepartment} onValueChange={(val) => { setSelectedDepartment(val); setSelectedUserId(''); }}>
                    <SelectTrigger className="h-12 rounded-xl border-2 border-gray-200 focus:border-[#64B5F6]">
                      <SelectValue placeholder="בחר מחלקה..." />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((dept) => (
                        <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <AnimatePresence>
                  {selectedDepartment && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-2 overflow-hidden"
                    >
                      <Label className="text-gray-700 font-medium flex items-center gap-2">
                        <UserRoundPen className="w-4 h-4 text-[#64B5F6]" />
                        בחר משתמש
                      </Label>
                      <Select value={selectedUserId?.toString()} onValueChange={(val) => setSelectedUserId(val)}>
                        <SelectTrigger className="h-12 rounded-xl border-2 border-gray-200 focus:border-[#64B5F6]">
                          <SelectValue placeholder="בחר משתמש..." />
                        </SelectTrigger>
                        <SelectContent>
                          {departmentUsers.map((user) => (
                            <SelectItem key={user.serial_id} value={user.serial_id.toString()}>
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
                  {reassignMutation.isPending ? 'מעדכן...' : 'שמור והחלף משתמש'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

      </div>
    </AnimatePresence>
  );
}