import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Button } from "@/components/ui/button";
import {
  normalizeShiftContext,
  computeCoverageSummary
} from './whatsappTemplates';

// Components
import BackgroundShapes from './BackgroundShapes';
import CalendarHeader from './CalendarHeader';
import CalendarGrid from './CalendarGrid';
import UserNotRegisteredError from '../UserNotRegisteredError'; // מסך חסימה החדש

// Modals
import SwapRequestModal from './SwapRequestModal';
import PendingRequestsModal from './PendingRequestsModal';
import AddShiftModal from './AddShiftModal';
import AcceptSwapModal from './AcceptSwapModal';
import ShiftActionModal from './ShiftActionModal';
import EditRoleModal from './EditRoleModal';
import ShiftDetailsModal from './ShiftDetailsModal';
import OnboardingModal from '../onboarding/OnboardingModal'; // מסך כניסה החדש
import KPIHeader from '../dashboard/KPIHeader';
import KPIListModal from '../dashboard/KPIListModal';
import AdminSettingsModal from '../admin/AdminSettingsModal';
import SwapSuccessModal from './SwapSuccessModal';
import HeadToHeadSelectorModal from './HeadToHeadSelectorModal';
import HeadToHeadApprovalModal from './HeadToHeadApprovalModal';
import HallOfFameModal from '../dashboard/HallOfFameModal';
import HelpSupportModal from '../dashboard/HelpSupportModal';
import LoadingSkeleton from '../LoadingSkeleton';

// --- Summary of swap flow fixes ---
// 1) AcceptSwapModal replaces legacy CoverSegmentModal across all entry points.
// 2) normalizeShiftContext + resolveSwapType/requestWindow standardize swap payloads for UI and WhatsApp deep links.
// 3) Deep links now hydrate the same shape before rendering modals to avoid race conditions.

export default function ShiftCalendar() {
  const queryClient = useQueryClient();
  
  // --- STATES ---
  const [currentDate, setCurrentDate] = useState(new Date());
  const [clickedDate, setClickedDate] = useState(null); // Fix: Store specific clicked date
  const [viewMode, setViewMode] = useState('month');
  
  // Modal Visibilities
  const [selectedShift, setSelectedShift] = useState(null);
  const [showSwapRequestModal, setShowSwapRequestModal] = useState(false);
  const [showPendingRequestsModal, setShowPendingRequestsModal] = useState(false);
  const [showAddShiftModal, setShowAddShiftModal] = useState(false);
  const [showAcceptSwapModal, setShowAcceptSwapModal] = useState(false);
  const [showActionModal, setShowActionModal] = useState(false);
  const [showEditRoleModal, setShowEditRoleModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showAdminSettings, setShowAdminSettings] = useState(false);
  const [showHallOfFame, setShowHallOfFame] = useState(false);
  const [showHelpSupport, setShowHelpSupport] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [deepLinkShiftId, setDeepLinkShiftId] = useState(null);
  
  // KPI & Success Modals
  const [showKPIListModal, setShowKPIListModal] = useState(false);
  const [kpiListType, setKpiListType] = useState('swap_requests');
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [lastUpdatedShift, setLastUpdatedShift] = useState(null);

  // Head-to-Head States
  const [showHeadToHeadSelector, setShowHeadToHeadSelector] = useState(false);
  const [showHeadToHeadApproval, setShowHeadToHeadApproval] = useState(false);
  const [h2hTargetId, setH2hTargetId] = useState(null);
  const [h2hOfferId, setH2hOfferId] = useState(null);

  // --- DEBUG LOGS (Internal Only, Hidden from UI) ---
  const appendSwapLog = (message, data) => {
    const timestamp = new Date().toLocaleTimeString('he-IL', { hour12: false });
    const payloadText = data ? ` | נתונים: ${JSON.stringify(data)}` : '';
    console.debug(`[SWAP-LOG ${timestamp}] ${message}${payloadText}`);
  };

  // --- AUTH & USER IDENTIFICATION LOGIC ---

  // 1. Get Current Base44 User
  const { data: currentUser, isLoading: isUserLoading } = useQuery({
    queryKey: ['current-user'],
    queryFn: async () => {
      const user = await base44.auth.me();
      console.log("👤 [DEBUG] Fetched Current User:", user);
      return user;
    },
  });

  // *** FIX: Handle Case Sensitivity (Email vs email) ***
  const userEmail = currentUser?.email || currentUser?.Email;

  // 2. Check Authorization against AuthorizedPerson table
  const { 
    data: authorizedPerson, 
    isLoading: isAuthCheckLoading,
    refetch: refreshAuthCheck 
  } = useQuery({
    queryKey: ['check-authorization', userEmail],
    queryFn: async () => {
      if (!userEmail) {
        console.log("❌ [DEBUG] No email found to check authorization.");
        return null;
      }
      
      console.log("🔍 [DEBUG] Checking authorization for:", userEmail);

      // Case-insensitive search
      const normalizedUserEmail = userEmail.toLowerCase();
      const match = allPeople.find(person => 
        person.email && person.email.toLowerCase() === normalizedUserEmail
      );

      console.log("🔍 [DEBUG] match:", match);

      // debug is gated on the record we just found, since `authorizedPerson`
      // (and any isAdmin derived from it) doesn't exist until this query resolves
      if (match?.permissions === 'Admin') {
      console.log("📄 [DEBUG] All AuthorizedPerson records:", allPeople);
      console.log("✅ [DEBUG] Final Authorization Result:", match || null);
      }
      
      return match || null; 
    },
    enabled: !!userEmail
  });

  // --- DEBUG: only logs for Admin, silent for everyone else ---
  const isAdminUser = authorizedPerson?.permissions === 'Admin';
  const debugLog = (...args) => {
    if (isAdminUser) {
      console.log(...args);
    }
  };

  // --- MUTATION: Link User (Onboarding Completion) ---
  const linkUserMutation = useMutation({
    mutationFn: async () => {
      if (!authorizedPerson || !currentUser) return;

      debugLog("🔗 [DEBUG] Linking user...", { authId: authorizedPerson.id, serialId: currentUser.serial_id });

      // 1. Update AuthorizedPerson with linked_user_id
      await base44.entities.AuthorizedPerson.update(authorizedPerson.id, {
        linked_user_id: currentUser.serial_id 
      });
      
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['check-authorization']);
      toast.success("החיבור בוצע בהצלחה! ברוכים הבאים.");
    },
    onError: (err) => {
      debugLog("❌ [DEBUG] Link Error:", err);
      toast.error("שגיאה בחיבור המשתמש.");
    }
  });

  // --- MAIN DATA QUERIES (Shifts, Users, Requests, Coverages) ---
  const { data: shifts = [], isLoading: isShiftsLoading } = useQuery({
    queryKey: ['shifts'],
    queryFn: () => base44.entities.Shift.list(),
    enabled: !!authorizedPerson
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['all-users'],
    queryFn: () => base44.entities.AuthorizedPerson.list(),
    enabled: !!authorizedPerson
  });

  const { data: swapRequests = [] } = useQuery({
    queryKey: ['swap-requests'],
    queryFn: () => base44.entities.SwapRequest.list(),
    enabled: !!authorizedPerson
  });

  const { data: coverages = [] } = useQuery({
    queryKey: ['coverages'],
    queryFn: () => base44.entities.ShiftCoverage.list(),
    enabled: !!authorizedPerson
  });

  // Enrich shifts with user data and swap status (shared across UI & deep links)
  const enrichedShifts = shifts.map(shift => normalizeShiftContext(shift, {
    allUsers,
    swapRequests,
    coverages,
    currentUser: authorizedPerson
  }));

  // Fixed: Handle deep link via query params to open shift details or head-to-head approval
  useEffect(() => {
    if (typeof window === 'undefined' || !authorizedPerson) return;

    const params = new URLSearchParams(window.location.search);
    const openShiftId = params.get('openShiftId');
    const headToHeadTarget = params.get('headToHeadTarget');
    const headToHeadOffer = params.get('headToHeadOffer');

    if (headToHeadTarget && headToHeadOffer) {
      setDeepLinkShiftId(null);
      setH2hTargetId(headToHeadTarget);
      setH2hOfferId(headToHeadOffer);
      setShowDetailsModal(false);
      setShowHeadToHeadSelector(false);
      setShowHeadToHeadApproval(true);
    } else if (openShiftId) {
      setDeepLinkShiftId(openShiftId);
    } else {
      return;
    }

    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
  }, [authorizedPerson]);

  useEffect(() => {
    if (!deepLinkShiftId || !authorizedPerson) return;

    const hydratedFromList = enrichedShifts.find((s) => String(s?.id) === String(deepLinkShiftId));
    if (hydratedFromList) {
      setSelectedShift(hydratedFromList);
      setShowDetailsModal(true);
      return;
    }

    const fetchAndHydrate = async () => {
      try {
        const shiftData = await base44.entities.Shift.get(deepLinkShiftId);
        if (!shiftData) {
          toast.error('המשמרת לא נמצאה');
          return;
        }

        const hydratedShift = normalizeShiftContext(shiftData, {
          allUsers,
          swapRequests,
          coverages,
          currentUser: authorizedPerson
        });

        setSelectedShift(hydratedShift);
        setShowDetailsModal(true);
      } catch (error) {
        console.error('❌ [ShiftCalendar] Failed to open shift from deep link', error);
        toast.error('המשמרת לא נמצאה');
      }
    };

    fetchAndHydrate();
  }, [allUsers, authorizedPerson, coverages, deepLinkShiftId, enrichedShifts, swapRequests]);

  // --- MUTATIONS (Shift Operations) ---

  const requestSwapMutation = useMutation({
    mutationFn: async ({ shiftId, type, dates }) => {
      const shift = shifts.find(s => s.id === shiftId);
      if (!shift) throw new Error('Shift not found');

      const isFull = type === 'full';
      const req_start_date = isFull ? shift.start_date : (dates.startDate || shift.start_date);
      const req_end_date = isFull ? (shift.end_date || shift.start_date) : (dates.endDate || shift.end_date || dates.startDate);
      const req_start_time = isFull ? (shift.start_time || '09:00') : (dates.startTime || shift.start_time || '09:00');
      const req_end_time = isFull ? (shift.end_time || req_start_time) : (dates.endTime || shift.end_time || req_start_time);

      const payload = {
        shift_id: shiftId,
        requesting_user_id: authorizedPerson.serial_id,
        request_type: isFull ? 'Full' : 'Partial',
        req_start_date,
        req_end_date,
        req_start_time,
        req_end_time,
        status: 'Open'
      };

      appendSwapLog('📨 שולח בקשה למסד', payload);
      debugLog('📨 [ShiftCalendar] Creating SwapRequest with payload:', payload);

      await base44.entities.SwapRequest.create(payload);

      appendSwapLog('🔄 מעדכן סטטוס משמרת ל-Swap_Requested', { shiftId });
      return await base44.entities.Shift.update(shiftId, {
        status: 'Swap_Requested'
      });
    },
    onMutate: (variables) => {
      appendSwapLog('🚀 התחלת שליחה', variables);
    },
    onSuccess: (data) => {
      appendSwapLog('✅ הבקשה נשמרה והמשמרת עודכנה');
      queryClient.invalidateQueries(['shifts']);
      queryClient.invalidateQueries(['swap-requests']);
      toast.success('בקשת ההחלפה נשלחה בהצלחה!');
      setLastUpdatedShift(data);
      setShowSwapRequestModal(false);
      setShowActionModal(false);
      setShowSuccessModal(true);
    },
    onError: (error) => {
      appendSwapLog('❌ שגיאה בשליחת הבקשה', { error: error?.message || String(error) });
      debugLog('❌ [ShiftCalendar] Swap request failed:', error);
      toast.error('שליחת בקשת ההחלפה נכשלה. נסו שוב.');
    }
  });

  const cancelSwapMutation = useMutation({
    mutationFn: async (shiftId) => {
      // Find and cancel the swap request
      const activeRequest = swapRequests.find(sr => sr.shift_id === shiftId && sr.status === 'Open');
      if (activeRequest) {
        await base44.entities.SwapRequest.update(activeRequest.id, { status: 'Cancelled' });
      }
      
      // Update shift status
      return await base44.entities.Shift.update(shiftId, { status: 'Active' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['shifts']);
      queryClient.invalidateQueries(['swap-requests']);
      toast.success('הבקשה בוטלה והמשמרת חזרה לסטטוס רגיל');
      setShowDetailsModal(false);
    }
  });

  const offerCoverMutation = useMutation({
    mutationFn: async ({ shift, coverData }) => {
      const normalizedShift = normalizeShiftContext(shift, { allUsers, swapRequests, coverages, currentUser: authorizedPerson });

      // Find active swap request
      const activeRequest = normalizedShift?.active_request || swapRequests.find(sr => sr.shift_id === shift.id && sr.status === 'Open');
      if (!activeRequest) throw new Error('No active swap request found');

      const payload = {
        request_id: activeRequest.id,
        shift_id: shift.id,
        covering_user_id: authorizedPerson.serial_id,
        cover_start_date: coverData.startDate || coverData.coverDate || normalizedShift.start_date,
        cover_end_date: coverData.endDate || coverData.coverDate || normalizedShift.end_date,
        cover_start_time: coverData.startTime || normalizedShift.start_time,
        cover_end_time: coverData.endTime || normalizedShift.end_time,
        type: coverData.type || (coverData.coverFull ? 'Full' : 'Partial'),
        status: 'Approved'
      };

      await base44.entities.ShiftCoverage.create(payload);

      // Evaluate remaining gaps after this coverage to decide status updates
      const shiftCoverages = [
        ...coverages
          .filter(c => c.shift_id === shift.id && c.status !== 'Cancelled'),
        payload
      ];

      const { missingSegments } = computeCoverageSummary({
        shift: normalizedShift,
        activeRequest,
        coverages: shiftCoverages
      });

      if (missingSegments.length === 0) {
        await base44.entities.SwapRequest.update(activeRequest.id, { status: 'Closed' });
        await base44.entities.Shift.update(shift.id, { status: 'Covered' });
      } else {
        await base44.entities.SwapRequest.update(activeRequest.id, { status: 'Partially_Covered' });
        await base44.entities.Shift.update(shift.id, { status: 'Swap_Requested' });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['shifts']);
      queryClient.invalidateQueries(['swap-requests']);
      queryClient.invalidateQueries(['coverages']);
      toast.success('הצעת הכיסוי נשלחה בהצלחה!');
      setShowAcceptSwapModal(false);
      setShowDetailsModal(false);
    }
  });

  const headToHeadSwapMutation = useMutation({
    mutationFn: async () => {
      if (!h2hTargetId || !h2hOfferId) return;

      // 1. Get Shifts
      const targetShift = shifts.find(s => s.id === h2hTargetId);
      const offerShift = shifts.find(s => s.id === h2hOfferId);

      // 2. Swap Assignees
      await base44.entities.Shift.update(h2hTargetId, {
        assigned_person: offerShift.assigned_person,
        assigned_email: offerShift.assigned_email,
        role: offerShift.role,
        department: offerShift.department,
        status: 'regular'
      });

      await base44.entities.Shift.update(h2hOfferId, {
        assigned_person: targetShift.assigned_person,
        assigned_email: targetShift.assigned_email,
        role: targetShift.role,
        department: targetShift.department,
        status: 'regular'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['shifts']);
      toast.success('החלפה ראש בראש בוצעה בהצלחה!');
      setShowHeadToHeadApproval(false);
      setH2hTargetId(null);
      setH2hOfferId(null);
    }
  });

  const approveSwapMutation = useMutation({
    mutationFn: async (shift) => {
      // Find the pending coverage
      const coverages = await base44.entities.ShiftCoverage.filter({ shift_id: shift.id });
      const pendingCoverage = coverages[0]; // Assuming one pending for simplicity

      if (!pendingCoverage) return;

      // Update Shift with new assignee
      await base44.entities.Shift.update(shift.id, {
        assigned_person: pendingCoverage.covering_person,
        assigned_email: pendingCoverage.covering_email,
        role: pendingCoverage.covering_role, // Or keep original role name if preferred
        status: 'regular',
        swap_start_time: null,
        swap_end_time: null
      });
      
      // Update Coverage status (optional if you have status field on coverage)
      // await base44.entities.ShiftCoverage.update(pendingCoverage.id, { status: 'approved' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['shifts']);
      toast.success('ההחלפה אושרה והלוח עודכן!');
      setShowDetailsModal(false);
    }
  });

  const addShiftMutation = useMutation({
    mutationFn: async (newShiftData) => {
      return await base44.entities.Shift.create({
        start_date: newShiftData.start_date,
        end_date: newShiftData.end_date,
        start_time: newShiftData.start_time || '09:00',
        end_time: newShiftData.end_time || '09:00',
        original_user_id: newShiftData.original_user_id,
        status: 'Active'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['shifts']);
      toast.success('המשמרת נוספה בהצלחה');
      setShowAddShiftModal(false);
    }
  });

  const editRoleMutation = useMutation({
    mutationFn: async ({ id, ...data }) => {
      return await base44.entities.Shift.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['shifts']);
      toast.success('התפקיד עודכן בהצלחה');
      setShowEditRoleModal(false);
      setShowActionModal(false);
    }
  });

  const deleteShiftMutation = useMutation({
    mutationFn: async (id) => {
      return await base44.entities.Shift.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['shifts']);
      toast.success('המשמרת נמחקה');
      setShowActionModal(false);
      setShowDetailsModal(false);
    }
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await base44.auth.logout();
    },
    onSuccess: () => {
      window.location.href = '/';
    },
    onError: () => {
      toast.error('אירעה שגיאה בעת ההתנתקות');
    }
  });

  // --- HANDLERS ---
  const closeAllModals = () => {
    setShowSwapRequestModal(false);
    setShowPendingRequestsModal(false);
    setShowAddShiftModal(false);
    setShowAcceptSwapModal(false);
    setShowActionModal(false);
    setShowEditRoleModal(false);
    setShowDetailsModal(false);
    setShowAdminSettings(false);
    setShowHallOfFame(false);
    setShowHelpSupport(false);
    setShowLogoutConfirm(false);
    setShowSuccessModal(false);
    setShowHeadToHeadSelector(false);
    setShowHeadToHeadApproval(false);
    setH2hTargetId(null);
    setH2hOfferId(null);
    setShowKPIListModal(false);
  };

  const handleCellClick = (date, shift) => {
    setClickedDate(date); // Fix: Save the clicked date for Add Modal

    // Check Date Validity (Prevent editing past)
    const clickedDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    clickedDate.setHours(0, 0, 0, 0);
    const isPast = clickedDate < today;

    if (!shift) {
        if (isAdmin && !isPast) {
            setShowAddShiftModal(true);
        }
        return;
    }

    // Permissions & ownership
    const permissionLevel = authorizedPerson.permissions;
    const isViewOnly = permissionLevel === 'View';
    const isRR = permissionLevel === 'RR';
    const isMyShift = shift.original_user_id === authorizedPerson.serial_id || shift.assigned_email === authorizedPerson.email;
    const isCoveredShift = shift.status === 'covered' || shift.status === 'Covered' || shift.status === 'approved';
    const isCoveringUser = (shift.coverages || []).some(cov => cov.covering_user_id === authorizedPerson.serial_id);

    // View-only users cannot open shifts at all
    if (isViewOnly) {
      return;
    }

    // Access rules for RR level
    if (isRR && !isAdmin) {
      if (shift.status === 'regular' && !isMyShift) {
        return;
      }

      if (isCoveredShift && !(isMyShift || isCoveringUser)) {
        return;
      }

      // Swap requests are always viewable for RR (covered by default fallthrough)
    }

    setSelectedShift(shift);

    // Determine if it's my shift
    if (shift.status === 'regular') {
        if (isMyShift && !isPast) {
            setShowActionModal(true);
        } else {
            setShowDetailsModal(true); // View details for others
        }
    } else {
        // Swap requested, Pending, etc.
        setShowDetailsModal(true);
    }
  };

  const handleOfferCover = (shift) => {
    const normalized = normalizeShiftContext(shift, { allUsers, swapRequests, coverages, currentUser: authorizedPerson });
    setSelectedShift(normalized);
    setShowAcceptSwapModal(true);
  };

  const handleOpenSwapRequest = (shift) => {
    setSelectedShift(shift);
    setShowSwapRequestModal(true);
  };

  const handleSwapSubmit = (data) => {
    if (!selectedShift) {
      debugLog('❌ [ShiftCalendar] No shift selected for swap request submission');
      appendSwapLog('❌ לא נבחרה משמרת לשליחה');
      return;
    }

    appendSwapLog('📝 נתוני בקשה מהמודל', data);
    debugLog('📤 [ShiftCalendar] Submitting swap request from modal:', data);

    requestSwapMutation.mutate({
      shiftId: selectedShift.id,
      type: data.type,
      dates: data
    });
  };

  // --- RENDER LOGIC ---

  // 1. Loading State
  if (isUserLoading || isAuthCheckLoading) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center" dir="rtl">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
          <p className="text-gray-500 font-medium">מאמת נתונים...</p>
        </div>
      </div>
    );
  }

  // 2. Access Denied (User not in AuthorizedPerson table)
  if (!authorizedPerson) {
    return <UserNotRegisteredError onRefresh={refreshAuthCheck} />;
  }

  // 3. First Time Onboarding (User authorized but not linked)
  if (!authorizedPerson.linked_user_id) {
    return (
      <OnboardingModal 
        isOpen={true} 
        authorizedData={authorizedPerson}
        onConfirm={() => linkUserMutation.mutate()}
        isLoading={linkUserMutation.isPending}
      />
    );
  }

  // 4. Main App (User authorized and linked)
  const permissionLevel = authorizedPerson.permissions;
  const isAdmin = permissionLevel === 'Admin' || permissionLevel === 'Manager';
  const isViewOnly = permissionLevel === 'View';
  const isLoadingApp = isUserLoading || isAuthCheckLoading || isShiftsLoading;

  if (isLoadingApp) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] text-gray-900" dir="rtl">
        <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
          <LoadingSkeleton className="h-14 w-full" ariaLabel="טוען כותרת" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, idx) => (
              <LoadingSkeleton key={idx} className="h-16" ariaLabel="טעינת KPI" />
            ))}
          </div>
          <LoadingSkeleton className="h-[420px] w-full" ariaLabel="טעינת לוח משמרות" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] text-gray-900 font-sans selection:bg-blue-100 overflow-x-hidden relative" dir="rtl">
      <BackgroundShapes />

      <div className="max-w-7xl mx-auto px-4 py-4 md:py-8 relative z-10 flex flex-col min-h-screen">
        
        {/* Header */}
        <CalendarHeader 
          currentDate={currentDate}
          setCurrentDate={setCurrentDate}
          viewMode={viewMode}
          setViewMode={setViewMode}
          isAdmin={isAdmin}
          onOpenAdminSettings={() => setShowAdminSettings(true)}
          onOpenHallOfFame={() => setShowHallOfFame(true)}
          onOpenHelp={() => setShowHelpSupport(true)}
          onLogout={() => setShowLogoutConfirm(true)}
          currentUser={authorizedPerson}
        />

        {/* KPI Header */}
        <div className="mt-6 mb-2">
           <KPIHeader 
             shifts={enrichedShifts} 
             currentUser={authorizedPerson}
             onKPIClick={(type) => {
               setKpiListType(type);
               setShowKPIListModal(true);
             }}
           />
        </div>

        {/* Calendar Grid */}
        <div className="flex-1 bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl border border-white/50 p-2 md:p-6 mt-4 relative overflow-hidden">
          <CalendarGrid 
            currentDate={currentDate}
            viewMode={viewMode}
            shifts={enrichedShifts}
            onCellClick={handleCellClick}
            currentUserEmail={authorizedPerson.email}
            currentUserRole={authorizedPerson.full_name}
            isAdmin={isAdmin}
          />
        </div>
      </div>

      {/* --- MODALS --- */}
      
      <AdminSettingsModal 
        isOpen={showAdminSettings}
        onClose={closeAllModals}
      />

      <ShiftActionModal
        isOpen={showActionModal}
        onClose={closeAllModals}
        shift={selectedShift}
        date={currentDate}
        onRequestSwap={() => {
            closeAllModals();
            setShowSwapRequestModal(true);
        }}
        onEditRole={() => {
            closeAllModals();
            setShowEditRoleModal(true);
        }}
        onDelete={deleteShiftMutation.mutate}
        isAdmin={isAdmin}
      />

      <SwapRequestModal
        isOpen={showSwapRequestModal}
        onClose={closeAllModals}
        date={currentDate}
        shift={selectedShift}
        onSubmit={handleSwapSubmit}
        isSubmitting={requestSwapMutation.isPending}
      />

      <AddShiftModal
        isOpen={showAddShiftModal}
        onClose={closeAllModals}
        date={clickedDate || currentDate}
        onSubmit={(data) => addShiftMutation.mutate({
            ...data,
            date: format(currentDate, 'yyyy-MM-dd') // Needs refinement if specific day clicked
        })}
        isSubmitting={addShiftMutation.isPending}
      />

      <EditRoleModal
        isOpen={showEditRoleModal}
        onClose={closeAllModals}
        shift={selectedShift}
        date={currentDate}
        onSubmit={(data) => editRoleMutation.mutate({ id: selectedShift.id, ...data })}
        isSubmitting={editRoleMutation.isPending}
      />

      <ShiftDetailsModal
        isOpen={showDetailsModal}
        onClose={closeAllModals}
        shift={selectedShift}
        date={currentDate}
        onOfferCover={handleOfferCover}
        onHeadToHead={(shift) => {
            setSelectedShift(shift);
            setShowHeadToHeadSelector(true);
        }}
        onCancelRequest={(shift) => cancelSwapMutation.mutate(shift.id)}
        onDelete={deleteShiftMutation.mutate}
        onApprove={() => approveSwapMutation.mutate(selectedShift)}
        onRequestSwap={() => {
          closeAllModals();
          setShowSwapRequestModal(true);
        }}
        currentUser={authorizedPerson}
        isAdmin={isAdmin}
      />

      <AcceptSwapModal
        isOpen={showAcceptSwapModal && !!selectedShift}
        onClose={closeAllModals}
        shift={selectedShift}
        existingCoverages={selectedShift?.shiftCoverages || selectedShift?.coverages || []}
        onAccept={(segmentData) => offerCoverMutation.mutate({ shift: selectedShift, coverData: segmentData })}
        isAccepting={offerCoverMutation.isPending}
      />

      <SwapSuccessModal
        isOpen={showSuccessModal}
        onClose={closeAllModals}
        shift={lastUpdatedShift}
      />

      <HeadToHeadSelectorModal
        isOpen={showHeadToHeadSelector}
        onClose={closeAllModals}
        targetShift={selectedShift}
        currentUser={authorizedPerson}
      />

      <HeadToHeadApprovalModal
        isOpen={showHeadToHeadApproval}
        onClose={closeAllModals}
        targetShiftId={h2hTargetId}
        offerShiftId={h2hOfferId}
        onApprove={() => headToHeadSwapMutation.mutate()}
        onDecline={closeAllModals}
      />

      <HallOfFameModal 
        isOpen={showHallOfFame}
        onClose={closeAllModals}
      />

      <HelpSupportModal
        isOpen={showHelpSupport}
        onClose={closeAllModals}
      />

      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" dir="rtl">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowLogoutConfirm(false)}
          />
          <div
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-title"
            aria-describedby="logout-desc"
          >
            <h3 id="logout-title" className="text-2xl font-bold text-center text-gray-900 mb-2">האם אתה בטוח שברצונך להתנתק?</h3>
            <p id="logout-desc" className="text-center text-gray-600 text-sm">תוכל להתחבר שוב בכל רגע באמצעות פרטי הגישה שלך.</p>
            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <Button
                variant="outline"
                className="flex-1 rounded-xl"
                onClick={() => setShowLogoutConfirm(false)}
              >
                לא
              </Button>
              <Button
                className="flex-1 rounded-xl bg-red-500 hover:bg-red-600 text-white"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
              >
                כן
              </Button>
            </div>
          </div>
        </div>
      )}

      <KPIListModal
        key={kpiListType}
        isOpen={showKPIListModal}
        onClose={closeAllModals}
        type={kpiListType}
        currentUser={authorizedPerson}
        onOfferCover={handleOfferCover}
        onRequestSwap={handleOpenSwapRequest}
        actionsDisabled={isViewOnly}
      />

    </div>
  );
}