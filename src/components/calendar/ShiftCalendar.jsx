import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useScrollLock } from "@/hooks/useScrollLock";
import {
  normalizeShiftContext,
  computeCoverageSummary,
} from "./whatsappTemplates";

// Components
import BackgroundShapes from "./BackgroundShapes";
import CalendarHeader from "./CalendarHeader";
import CalendarGrid from "./CalendarGrid";
import UserNotRegisteredError from "../UserNotRegisteredError"; // מסך חסימה החדש

// Modals
import SwapRequestModal from "./SwapRequestModal";
import AddShiftModal from "./AddShiftModal";
import AcceptSwapModal from "./AcceptSwapModal";
import ShiftActionModal from "./ShiftActionModal";
import EditRoleModal from "./EditRoleModal";
import ShiftDetailsModal from "./ShiftDetailsModal";
import OnboardingModal from "../onboarding/OnboardingModal"; // מסך כניסה החדש
import KPIHeader from "../dashboard/KPIHeader";
import KPIListModal from "../dashboard/KPIListModal";
import AdminSettingsModal from "../admin/AdminSettingsModal";
import SwapSuccessModal from "./SwapSuccessModal";
import HeadToHeadSelectorModal from "./HeadToHeadSelectorModal";
import HeadToHeadApprovalModal from "./HeadToHeadApprovalModal";
import HallOfFameModal from "../dashboard/HallOfFameModal";
import FairnessMatrixModal from "../dashboard/FairnessMatrixModal";
import HelpSupportModal from "../dashboard/HelpSupportModal";
import LoadingSkeleton from "../LoadingSkeleton";
import SwitchFlowBand from "./SwitchFlowBand";

// --- Summary of swap flow fixes ---
// 1) AcceptSwapModal replaces legacy CoverSegmentModal across all entry points.
// 2) normalizeShiftContext + resolveSwapType/requestWindow standardize swap payloads for UI and WhatsApp deep links.
// 3) Deep links now hydrate the same shape before rendering modals to avoid race conditions.

export default function ShiftCalendar() {
  const queryClient = useQueryClient();

  // --- STATES ---
  const [currentDate, setCurrentDate] = useState(new Date());
  const [clickedDate, setClickedDate] = useState(null); // Fix: Store specific clicked date
  const [viewMode, setViewMode] = useState("month");

  // Modal Visibilities
  const [selectedShift, setSelectedShift] = useState(null);
  const [showSwapRequestModal, setShowSwapRequestModal] = useState(false);
  const [swapRequestInitialType, setSwapRequestInitialType] = useState("full");
  const [showAddShiftModal, setShowAddShiftModal] = useState(false);
  const [showAcceptSwapModal, setShowAcceptSwapModal] = useState(false);
  const [showActionModal, setShowActionModal] = useState(false);
  const [showEditRoleModal, setShowEditRoleModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showAdminSettings, setShowAdminSettings] = useState(false);
  const [showHallOfFame, setShowHallOfFame] = useState(false);
  const [showFairnessMatrix, setShowFairnessMatrix] = useState(false);
  const [showHelpSupport, setShowHelpSupport] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [deepLinkShiftId, setDeepLinkShiftId] = useState(null);

  // KPI & Success Modals
  const [showKPIListModal, setShowKPIListModal] = useState(false);
  const [kpiListType, setKpiListType] = useState("swap_requests");
  // Which tab KPIListModal should start on, and a counter bumped on every
  // open so its `key` changes even when re-opening the same `type` with a
  // different tab (e.g. from a notification popup) — otherwise React would
  // keep the old mounted instance and its local tab state.
  const [kpiInitialTab, setKpiInitialTab] = useState("all");
  const [kpiOpenSeq, setKpiOpenSeq] = useState(0);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [lastUpdatedShift, setLastUpdatedShift] = useState(null);

  // Head-to-Head States
  const [showHeadToHeadSelector, setShowHeadToHeadSelector] = useState(false);
  const [showHeadToHeadApproval, setShowHeadToHeadApproval] = useState(false);
  const [h2hTargetId, setH2hTargetId] = useState(null);
  const [h2hOfferId, setH2hOfferId] = useState(null);

  // Switch Request Flow State (multi-shift swap)
  // null = inactive; otherwise { step: 'own' | 'target', ownShiftIds: string[], targetShiftIds: string[] }
  const [switchFlow, setSwitchFlow] = useState(null);
  // A Head2Head request can only target shifts belonging to one other person
  // at a time (see switchRequestMutation); this surfaces a red warning when
  // the user tries to pick a target shift belonging to someone else.
  const [switchFlowWarning, setSwitchFlowWarning] = useState(null);
  const switchFlowWarningTimeoutRef = useRef(null);

  // Shown at the bottom of the page for 3s whenever a user with role 'None'
  // (AuthorizedPerson.role — separate from permissions) tries to take a
  // shift in any way (offer to cover, accept a general/head-to-head
  // request, propose/approve a head-to-head swap, or select a target shift
  // in the multi-shift switch flow). Giving away one's OWN shifts is never
  // blocked by this — only acquiring someone else's is.
  const [roleError, setRoleError] = useState(null);
  const roleErrorTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (switchFlowWarningTimeoutRef.current)
        clearTimeout(switchFlowWarningTimeoutRef.current);
      if (roleErrorTimeoutRef.current)
        clearTimeout(roleErrorTimeoutRef.current);
    };
  }, []);

  const showRoleError = () => {
    if (roleErrorTimeoutRef.current) clearTimeout(roleErrorTimeoutRef.current);
    setRoleError("אין לך הרשאה לקחת משמרות");
    roleErrorTimeoutRef.current = setTimeout(() => setRoleError(null), 3000);
  };

  // Listens for the notification sidebar's action-button clicks
  // (messageStore.js's dispatchAction) so a popup can open KPIListModal
  // directly on the tab relevant to it. `detail.target` is "kpi:<type>" or
  // "kpi:<type>:<tab>" — see src/components/sidebar/notificationEvents.js.
  useEffect(() => {
    const handleSidebarAction = (e) => {
      const target = e.detail?.target;
      if (typeof target !== "string" || !target.startsWith("kpi:")) return;
      const [, type, tab] = target.split(":");
      if (!type) return;
      setKpiListType(type);
      setKpiInitialTab(tab || "all");
      setKpiOpenSeq((n) => n + 1);
      setShowKPIListModal(true);
    };
    window.addEventListener("razarto:sidebar-action", handleSidebarAction);
    return () =>
      window.removeEventListener("razarto:sidebar-action", handleSidebarAction);
  }, []);

  // Lock background scrolling while any modal/menu is open, so only the
  // open overlay scrolls — not the calendar behind it.
  const anyModalOpen =
    showSwapRequestModal ||
    showAddShiftModal ||
    showAcceptSwapModal ||
    showActionModal ||
    showEditRoleModal ||
    showDetailsModal ||
    showAdminSettings ||
    showHallOfFame ||
    showFairnessMatrix ||
    showHelpSupport ||
    showLogoutConfirm ||
    showSuccessModal ||
    showHeadToHeadSelector ||
    showHeadToHeadApproval ||
    showKPIListModal;
  useScrollLock(anyModalOpen);

  // --- DEBUG LOGS (Internal Only, Hidden from UI) ---
  const appendSwapLog = (message, data) => {
    const timestamp = new Date().toLocaleTimeString("he-IL", { hour12: false });
    const payloadText = data ? ` | נתונים: ${JSON.stringify(data)}` : "";
    console.debug(`[SWAP-LOG ${timestamp}] ${message}${payloadText}`);
  };

  // --- AUTH & USER IDENTIFICATION LOGIC ---

  // 1. Get Current Base44 User
  const { data: currentUser, isLoading: isUserLoading } = useQuery({
    queryKey: ["current-user"],
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
    refetch: refreshAuthCheck,
  } = useQuery({
    queryKey: ["check-authorization", userEmail],
    queryFn: async () => {
      if (!userEmail) {
        console.log("❌ [DEBUG] No email found to check authorization.");
        return null;
      }

      console.log("🔍 [DEBUG] Checking authorization for:", userEmail);
      // Fetch all authorized people and search case-insensitive on client-side
      const allPeople = await base44.entities.AuthorizedPerson.list();

      // Case-insensitive search
      const normalizedUserEmail = userEmail.toLowerCase();
      console.log("🔍 [DEBUG] normalizedUserEmail:", normalizedUserEmail);
      const match = allPeople.find(
        (person) =>
          person.email && person.email.toLowerCase() === normalizedUserEmail,
      );

      console.log("🔍 [DEBUG] match:", match);

      // debug is gated on the record we just found, since `authorizedPerson`
      // (and any isAdmin derived from it) doesn't exist until this query resolves
      if (match?.permissions === "Admin") {
        console.log("📄 [DEBUG] All AuthorizedPerson records:", allPeople);
        console.log("✅ [DEBUG] Final Authorization Result:", match || null);
      }

      return match || null;
    },
    enabled: !!userEmail,
  });

  // AuthorizedPerson.role is separate from permissions — 'None' means this
  // person may not take shifts in any way (offer to cover, accept a
  // general/head-to-head request, propose/approve a head-to-head swap, or
  // pick target shifts in the switch flow), even though they can still
  // freely give their OWN shifts away.
  const canTakeShifts = (authorizedPerson?.role || "RR") !== "None";

  // --- DEBUG: only logs for Admin, silent for everyone else ---
  const isAdminUser = authorizedPerson?.permissions === "Admin";
  const debugLog = (...args) => {
    if (isAdminUser) {
      console.log(...args);
    }
  };

  // --- MUTATION: Link User (Onboarding Completion) ---
  const linkUserMutation = useMutation({
    mutationFn: async () => {
      if (!authorizedPerson || !currentUser) return;
      // Server-side onboarding: the backend function verifies the user's
      // email is in the AuthorizedPerson whitelist (bypassing RLS with the
      // service role), sets is_authorized: true on the platform User, and
      // links the AuthorizedPerson record. This cannot be bypassed by
      // client-side code changes — the verification happens on the server.
      const res = await base44.functions.invoke("completeOnboarding", {});
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success("החיבור בוצע בהצלחה! ברוכים הבאים.");
    },
    onError: (err) => {
      debugLog("❌ [DEBUG] Link Error:", err);
      toast.error("שגיאה בחיבור המשתמש.");
    },
  });

  // --- MAIN DATA QUERIES (Shifts, Users, Requests, Coverages) ---
  const { data: shifts = [], isLoading: isShiftsLoading } = useQuery({
    queryKey: ["shifts"],
    queryFn: () => base44.entities.Shift.list(),
    enabled: !!authorizedPerson,
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ["all-users"],
    queryFn: () => base44.entities.AuthorizedPerson.list(),
    enabled: !!authorizedPerson,
  });

  const { data: swapRequests = [] } = useQuery({
    queryKey: ["swap-requests"],
    queryFn: () => base44.entities.SwapRequest.list(),
    enabled: !!authorizedPerson,
  });

  const { data: coverages = [] } = useQuery({
    queryKey: ["coverages"],
    queryFn: () => base44.entities.ShiftCoverage.list(),
    enabled: !!authorizedPerson,
  });

  // --- LAZY CLEANUP: remove SwapRequests whose date has already passed, and ---
  // reconcile shifts left stuck in a swap-related status with no live request
  // backing them (e.g. after the SwapRequest table was cleared out-of-band).
  // Closed/Cancelled/Completed requests are left alone as history.
  useEffect(() => {
    if (!authorizedPerson || shifts.length === 0) return;

    const today = format(new Date(), "yyyy-MM-dd");
    const activeStatuses = ["Open", "Partially_Covered"];

    const staleRequests = swapRequests.filter(
      (sr) =>
        activeStatuses.includes(sr.status) &&
        (sr.req_end_date || sr.req_start_date) < today,
    );
    const staleRequestIds = new Set(staleRequests.map((sr) => sr.id));

    // Shifts marked as mid-swap that no longer have a live (non-stale) active request.
    const liveShiftIds = new Set(
      swapRequests
        .filter(
          (sr) =>
            activeStatuses.includes(sr.status) && !staleRequestIds.has(sr.id),
        )
        .flatMap((sr) => sr.shift_ids || []),
    );
    const orphanedShifts = shifts.filter(
      (s) =>
        ["Swap_Requested", "Partially_Covered"].includes(s.status) &&
        !liveShiftIds.has(s.id),
    );

    if (staleRequests.length === 0 && orphanedShifts.length === 0) return;

    Promise.all([
      ...staleRequests.map((sr) => base44.entities.SwapRequest.delete(sr.id)),
      ...orphanedShifts.map((s) =>
        base44.entities.Shift.update(s.id, { status: "Active" }),
      ),
    ])
      .then(() => {
        debugLog(
          "🧹 [ShiftCalendar] Cleaned up expired swap requests & orphaned shift statuses:",
          {
            requestIds: staleRequests.map((sr) => sr.id),
            shiftIds: orphanedShifts.map((s) => s.id),
          },
        );
        queryClient.invalidateQueries(["swap-requests"]);
        queryClient.invalidateQueries(["shifts"]);
      })
      .catch((error) => {
        debugLog(
          "❌ [ShiftCalendar] Failed to clean up expired swap requests:",
          error,
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorizedPerson, shifts, swapRequests]);

  // Enrich shifts with user data and swap status (shared across UI & deep links)
  const enrichedShifts = shifts.map((shift) =>
    normalizeShiftContext(shift, {
      allUsers,
      swapRequests,
      coverages,
      currentUser: authorizedPerson,
    }),
  );

  // Fixed: Handle deep link via query params to open shift details or head-to-head approval
  useEffect(() => {
    if (typeof window === "undefined" || !authorizedPerson) return;

    const params = new URLSearchParams(window.location.search);
    const openShiftId = params.get("openShiftId");
    const headToHeadTarget = params.get("headToHeadTarget");
    const headToHeadOffer = params.get("headToHeadOffer");

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

    window.history.replaceState(
      {},
      document.title,
      `${window.location.pathname}${window.location.hash}`,
    );
  }, [authorizedPerson]);

  useEffect(() => {
    if (!deepLinkShiftId || !authorizedPerson) return;

    const hydratedFromList = enrichedShifts.find(
      (s) => String(s?.id) === String(deepLinkShiftId),
    );
    if (hydratedFromList) {
      setSelectedShift(hydratedFromList);
      setShowDetailsModal(true);
      return;
    }

    const fetchAndHydrate = async () => {
      try {
        const shiftData = await base44.entities.Shift.get(deepLinkShiftId);
        if (!shiftData) {
          toast.error("המשמרת לא נמצאה");
          return;
        }

        const hydratedShift = normalizeShiftContext(shiftData, {
          allUsers,
          swapRequests,
          coverages,
          currentUser: authorizedPerson,
        });

        setSelectedShift(hydratedShift);
        setShowDetailsModal(true);
      } catch (error) {
        console.error(
          "❌ [ShiftCalendar] Failed to open shift from deep link",
          error,
        );
        toast.error("המשמרת לא נמצאה");
      }
    };

    fetchAndHydrate();
  }, [
    allUsers,
    authorizedPerson,
    coverages,
    deepLinkShiftId,
    enrichedShifts,
    swapRequests,
  ]);

  // --- MUTATIONS (Shift Operations) ---

  const requestSwapMutation = useMutation({
    mutationFn: async ({ shiftId, type, dates }) => {
      const shift = shifts.find((s) => s.id === shiftId);
      if (!shift) throw new Error("Shift not found");

      const isFull = type === "full";
      const req_start_date = isFull
        ? shift.start_date
        : dates.startDate || shift.start_date;
      const req_end_date = isFull
        ? shift.end_date || shift.start_date
        : dates.endDate || shift.end_date || dates.startDate;
      const req_start_time = isFull
        ? shift.start_time || "09:00"
        : dates.startTime || shift.start_time || "09:00";
      const req_end_time = isFull
        ? shift.end_time || req_start_time
        : dates.endTime || shift.end_time || req_start_time;

      const payload = {
        shift_ids: [shiftId],
        requesting_user_id: authorizedPerson.serial_id,
        request_type: isFull ? "Full" : "Partial",
        req_start_date,
        req_end_date,
        req_start_time,
        req_end_time,
        status: "Open",
      };

      appendSwapLog("📨 שולח בקשה למסד", payload);
      debugLog(
        "📨 [ShiftCalendar] Creating SwapRequest with payload:",
        payload,
      );

      await base44.entities.SwapRequest.create(payload);

      appendSwapLog("🔄 מעדכן סטטוס משמרת ל-Swap_Requested", { shiftId });
      return await base44.entities.Shift.update(shiftId, {
        status: "Swap_Requested",
      });
    },
    onMutate: (variables) => {
      appendSwapLog("🚀 התחלת שליחה", variables);
    },
    onSuccess: (data) => {
      appendSwapLog("✅ הבקשה נשמרה והמשמרת עודכנה");
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);
      toast.success("בקשת ההחלפה נשלחה בהצלחה!");
      setLastUpdatedShift(data);
      setShowSwapRequestModal(false);
      setShowActionModal(false);
      setShowSuccessModal(true);
    },
    onError: (error) => {
      appendSwapLog("❌ שגיאה בשליחת הבקשה", {
        error: error?.message || String(error),
      });
      debugLog("❌ [ShiftCalendar] Swap request failed:", error);
      toast.error("שליחת בקשת ההחלפה נכשלה. נסו שוב.");
    },
  });

  const switchRequestMutation = useMutation({
    mutationFn: async ({ ownShiftIds, targetShiftIds }) => {
      const ownShifts = shifts.filter((s) => ownShiftIds.includes(s.id));
      const req_start_date = ownShifts.map((s) => s.start_date).sort()[0];
      const req_end_date = ownShifts
        .map((s) => s.end_date || s.start_date)
        .sort()
        .slice(-1)[0];
      const req_start_time = ownShifts[0]?.start_time || "09:00";
      const req_end_time = ownShifts[0]?.end_time || req_start_time;

      // Group target shifts by their owner: multiple target shifts belonging
      // to the SAME other person become one request (offered_shift_ids holds
      // all of them). Only targets belonging to different people produce
      // separate requests.
      const targetShifts = shifts.filter((s) => targetShiftIds.includes(s.id));
      const targetIdsByOwner = new Map();
      targetShifts.forEach((s) => {
        const ownerId = s.original_user_id;
        if (!targetIdsByOwner.has(ownerId)) targetIdsByOwner.set(ownerId, []);
        targetIdsByOwner.get(ownerId).push(s.id);
      });

      await Promise.all(
        Array.from(targetIdsByOwner.values()).map((offeredIdsForOwner) =>
          base44.entities.SwapRequest.create({
            shift_ids: ownShiftIds,
            offered_shift_ids: offeredIdsForOwner,
            requesting_user_id: authorizedPerson.serial_id,
            request_type: "Head2Head",
            req_start_date,
            req_end_date,
            req_start_time,
            req_end_time,
            status: "Open",
          }),
        ),
      );

      await Promise.all(
        ownShiftIds.map((id) =>
          base44.entities.Shift.update(id, { status: "Swap_Requested" }),
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);
      toast.success("בקשות ההחלפה נשלחו בהצלחה!");
      if (switchFlowWarningTimeoutRef.current)
        clearTimeout(switchFlowWarningTimeoutRef.current);
      setSwitchFlowWarning(null);
      setSwitchFlow(null);
    },
    onError: (error) => {
      debugLog("❌ [ShiftCalendar] Switch request failed:", error);
      toast.error("שליחת בקשות ההחלפה נכשלה. נסו שוב.");
    },
  });

  // "Skip" path of the switch flow: send the selected own shifts as an open,
  // general swap request (request_type 'General', empty offered_shift_ids) so
  // ANY other user can either take them outright ("accept without terms") or
  // reply with a head-to-head counter-offer by picking their own shifts.
  const generalSwitchRequestMutation = useMutation({
    mutationFn: async ({ ownShiftIds }) => {
      const ownShifts = shifts.filter((s) => ownShiftIds.includes(s.id));
      if (ownShifts.length === 0) throw new Error("No shifts selected");
      const req_start_date = ownShifts.map((s) => s.start_date).sort()[0];
      const req_end_date = ownShifts
        .map((s) => s.end_date || s.start_date)
        .sort()
        .slice(-1)[0];
      const req_start_time = ownShifts[0]?.start_time || "09:00";
      const req_end_time = ownShifts[0]?.end_time || req_start_time;

      await base44.entities.SwapRequest.create({
        shift_ids: ownShiftIds,
        offered_shift_ids: [],
        requesting_user_id: authorizedPerson.serial_id,
        request_type: "General",
        req_start_date,
        req_end_date,
        req_start_time,
        req_end_time,
        status: "Open",
      });

      await Promise.all(
        ownShiftIds.map((id) =>
          base44.entities.Shift.update(id, { status: "Swap_Requested" }),
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);
      toast.success("בקשת ההחלפה הכללית נשלחה!");
      if (switchFlowWarningTimeoutRef.current)
        clearTimeout(switchFlowWarningTimeoutRef.current);
      setSwitchFlowWarning(null);
      setSwitchFlow(null);
    },
    onError: (error) => {
      debugLog("❌ [ShiftCalendar] General switch request failed:", error);
      toast.error("שליחת בקשת ההחלפה נכשלה. נסו שוב.");
    },
  });

  // Accepting a general/open request "without terms": the accepting user
  // simply takes every shift the requester offered (nothing offered back),
  // the request closes, and any other open request referencing those shifts
  // (e.g. a pending counter-offer) is cancelled as no longer valid.
  const acceptGeneralRequestMutation = useMutation({
    mutationFn: async (request) => {
      const theirShiftIds = request.shift_ids || [];
      if (theirShiftIds.length === 0) return;

      await Promise.all(
        theirShiftIds.map((id) =>
          base44.entities.Shift.update(id, {
            original_user_id: authorizedPerson.serial_id,
            status: "Active",
          }),
        ),
      );

      await base44.entities.SwapRequest.update(request.id, {
        status: "Closed",
      });

      const staleSiblings = swapRequests.filter(
        (sr) =>
          sr.id !== request.id &&
          ["Open", "Partially_Covered"].includes(sr.status) &&
          (sr.shift_ids?.some((id) => theirShiftIds.includes(id)) ||
            sr.offered_shift_ids?.some((id) => theirShiftIds.includes(id))),
      );
      await Promise.all(
        staleSiblings.map((sr) =>
          base44.entities.SwapRequest.update(sr.id, { status: "Cancelled" }),
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);
      toast.success("המשמרות נלקחו בהצלחה!");
    },
    onError: (error) => {
      console.error("❌ [ShiftCalendar] Accept general request failed:", error);
      toast.error(`ביצוע ההחלפה נכשל: ${error?.message || "שגיאה לא ידועה"}`);
    },
  });

  // Start a head-to-head counter-offer against someone else's general/open
  // request: the target (the requester's offered shifts) is pre-filled, and
  // the user only picks their OWN shifts to offer in exchange. Reuses
  // switchRequestMutation, which builds a Head2Head request from the current
  // user to the target owner; the original requester then accepts it from
  // their incoming requests (acceptHeadToHeadRequestMutation).
  const handleStartCounterOffer = (request) => {
    if (!canTakeShifts) {
      showRoleError();
      return;
    }
    const targetShiftIds = request.shift_ids || [];
    if (targetShiftIds.length === 0) return;
    const targetShift = shifts.find((s) => s.id === targetShiftIds[0]);
    const targetOwner = allUsers.find(
      (u) => u.serial_id === targetShift?.original_user_id,
    );
    setShowKPIListModal(false);
    if (switchFlowWarningTimeoutRef.current)
      clearTimeout(switchFlowWarningTimeoutRef.current);
    setSwitchFlowWarning(null);
    setSwitchFlow({
      step: "own",
      ownShiftIds: [],
      targetShiftIds,
      isCounterOffer: true,
      targetOwnerName: targetOwner?.full_name || "",
    });
  };

  const cancelSwapMutation = useMutation({
    mutationFn: async (shiftId) => {
      // Find and cancel the swap request — including ones already fully
      // "Closed" (fully covered by helpers), not just Open/Partially_Covered.
      // The owner can undo a fully-accepted partial swap too, and leaving a
      // Closed request in place would keep matching normalizeShiftContext's
      // activeRequest lookup (same requesting_user_id/owner) forever,
      // making the reverted shift look "covered" again even after everyone's
      // coverage was just cancelled below.
      const activeRequest = swapRequests.find(
        (sr) =>
          sr.shift_ids?.includes(shiftId) &&
          ["Open", "Partially_Covered", "Closed"].includes(sr.status),
      );
      if (activeRequest) {
        await base44.entities.SwapRequest.update(activeRequest.id, {
          status: "Cancelled",
        });
      }

      // Cancelling the owner's own partial/full swap request means the whole
      // shift just returns to them as a normal shift — any coverage other
      // people had already been granted no longer applies.
      await Promise.all(
        coverages
          .filter(
            (c) =>
              c.shift_id === shiftId && (c.status === "Approved" || !c.status),
          )
          .map((c) =>
            base44.entities.ShiftCoverage.update(c.id, {
              status: "Cancelled",
            }),
          ),
      );

      // Update shift status
      return await base44.entities.Shift.update(shiftId, { status: "Active" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);
      queryClient.invalidateQueries(["coverages"]);
      toast.success("הבקשה בוטלה והמשמרת חזרה לסטטוס רגיל");
      setShowDetailsModal(false);
    },
  });

  // Lets a user who joined a partial swap back out of the window they took —
  // it's removed and, by default, the original owner simply keeps that time
  // (missingSegments already treats anything nobody covers as theirs), so no
  // separate "give it back" step is needed beyond cancelling this coverage.
  const cancelMyCoverageMutation = useMutation({
    mutationFn: async (shift) => {
      const myCoverage = coverages.find(
        (c) =>
          c.shift_id === shift.id &&
          Number(c.covering_user_id) === Number(authorizedPerson.serial_id) &&
          (c.status === "Approved" || !c.status),
      );
      if (!myCoverage) throw new Error("No coverage found to cancel");

      await base44.entities.ShiftCoverage.update(myCoverage.id, {
        status: "Cancelled",
      });

      const activeRequest = swapRequests.find(
        (sr) => sr.shift_ids?.includes(shift.id) && sr.status !== "Cancelled",
      );
      if (activeRequest) {
        const remainingCoverages = coverages.filter(
          (c) =>
            c.shift_id === shift.id &&
            c.id !== myCoverage.id &&
            (c.status === "Approved" || !c.status),
        );
        await base44.entities.SwapRequest.update(activeRequest.id, {
          status: remainingCoverages.length > 0 ? "Partially_Covered" : "Open",
        });
      }

      // The shift is no longer fully covered once a coverage is pulled back —
      // it goes back to (or stays) an in-progress partial swap.
      await base44.entities.Shift.update(shift.id, {
        status: "Swap_Requested",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);
      queryClient.invalidateQueries(["coverages"]);
      toast.success("ביטלת את השתתפותך במשמרת");
      setShowDetailsModal(false);
    },
    onError: (error) => {
      toast.error(`ביטול ההשתתפות נכשל: ${error?.message || "שגיאה לא ידועה"}`);
    },
  });

  // Cancels a SwapRequest directly by its own id (used by KPIListModal, where
  // we already have the request object in hand instead of a single shiftId).
  // Unlike cancelSwapMutation this handles requests bundling multiple
  // shift_ids, and avoids resetting a shift to Active if another open request
  // still references it.
  const cancelSwapRequestMutation = useMutation({
    mutationFn: async (request) => {
      await base44.entities.SwapRequest.update(request.id, {
        status: "Cancelled",
      });

      const shiftIds = request.shift_ids || [];
      const shiftsToReset = shiftIds.filter(
        (id) =>
          !swapRequests.some(
            (sr) =>
              sr.id !== request.id &&
              ["Open", "Partially_Covered"].includes(sr.status) &&
              sr.shift_ids?.includes(id),
          ),
      );

      // As with cancelSwapMutation: any coverage already granted on these
      // shifts no longer applies once the request itself is cancelled.
      await Promise.all(
        coverages
          .filter(
            (c) =>
              shiftsToReset.includes(c.shift_id) &&
              (c.status === "Approved" || !c.status),
          )
          .map((c) =>
            base44.entities.ShiftCoverage.update(c.id, {
              status: "Cancelled",
            }),
          ),
      );

      await Promise.all(
        shiftsToReset.map((id) =>
          base44.entities.Shift.update(id, { status: "Active" }),
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);
      queryClient.invalidateQueries(["coverages"]);
      toast.success("הבקשה בוטלה והמשמרת חזרה לסטטוס רגיל");
    },
    onError: (error) => {
      console.error("❌ [ShiftCalendar] Cancel swap request failed:", error);
      toast.error(`ביטול הבקשה נכשל: ${error?.message || "שגיאה לא ידועה"}`);
    },
  });

  // Accepts an incoming Head2Head request: the accepting user gives up every
  // shift in offered_shift_ids (their own shifts this request is asking for)
  // in exchange for every shift in shift_ids (the requester's offered pool) —
  // a full trade of both lists, matching how the request was created.
  // Reassignment is done via original_user_id, the same field EditRoleModal
  // uses; assigned_person/email/role/department are display-only and get
  // re-derived from original_user_id when shifts render.
  const acceptHeadToHeadRequestMutation = useMutation({
    mutationFn: async (request) => {
      const theirShiftIds = request.shift_ids || [];
      const myShiftIds = request.offered_shift_ids || [];

      await Promise.all([
        ...myShiftIds.map((id) =>
          base44.entities.Shift.update(id, {
            original_user_id: request.requesting_user_id,
            status: "Active",
          }),
        ),
        ...theirShiftIds.map((id) =>
          base44.entities.Shift.update(id, {
            original_user_id: authorizedPerson.serial_id,
            status: "Active",
          }),
        ),
      ]);

      await base44.entities.SwapRequest.update(request.id, {
        status: "Closed",
      });

      // Any other open request still trading one of these shifts (on either
      // side) assumed an ownership that no longer holds — cancel it too.
      const swappedIds = [...theirShiftIds, ...myShiftIds];
      const staleSiblings = swapRequests.filter(
        (sr) =>
          sr.id !== request.id &&
          ["Open", "Partially_Covered"].includes(sr.status) &&
          (sr.shift_ids?.some((id) => swappedIds.includes(id)) ||
            sr.offered_shift_ids?.some((id) => swappedIds.includes(id))),
      );
      await Promise.all(
        staleSiblings.map((sr) =>
          base44.entities.SwapRequest.update(sr.id, { status: "Cancelled" }),
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);
      toast.success("ההחלפה בוצעה בהצלחה!");
    },
    onError: (error) => {
      console.error(
        "❌ [ShiftCalendar] Accept head-to-head request failed:",
        error,
      );
      toast.error(`ביצוע ההחלפה נכשל: ${error?.message || "שגיאה לא ידועה"}`);
    },
  });

  const offerCoverMutation = useMutation({
    mutationFn: async ({ shift, coverData }) => {
      const normalizedShift = normalizeShiftContext(shift, {
        allUsers,
        swapRequests,
        coverages,
        currentUser: authorizedPerson,
      });

      // Find active swap request. Once one person partially covers a shift,
      // the request's status flips to "Partially_Covered" (not "Open") so
      // other people can keep taking the remaining windows — the lookup must
      // accept that status too, or it'll wrongly report no active request.
      const activeRequest =
        normalizedShift?.active_request ||
        swapRequests.find(
          (sr) => sr.shift_ids?.includes(shift.id) && sr.status !== "Cancelled",
        );
      if (!activeRequest) throw new Error("No active swap request found");

      const payload = {
        request_id: activeRequest.id,
        shift_id: shift.id,
        covering_user_id: authorizedPerson.serial_id,
        cover_start_date:
          coverData.startDate ||
          coverData.coverDate ||
          normalizedShift.start_date,
        cover_end_date:
          coverData.endDate || coverData.coverDate || normalizedShift.end_date,
        cover_start_time: coverData.startTime || normalizedShift.start_time,
        cover_end_time: coverData.endTime || normalizedShift.end_time,
        type: coverData.type || (coverData.coverFull ? "Full" : "Partial"),
        status: "Approved",
      };

      // If the user already has a coverage on this shift, update it in place
      // instead of creating a second row, so they can edit what they chose.
      if (coverData.coverageId) {
        await base44.entities.ShiftCoverage.update(
          coverData.coverageId,
          payload,
        );
      } else {
        await base44.entities.ShiftCoverage.create(payload);
      }

      // Evaluate remaining gaps after this coverage to decide status updates
      const shiftCoverages = [
        ...coverages.filter(
          (c) =>
            c.shift_id === shift.id &&
            c.status !== "Cancelled" &&
            c.id !== coverData.coverageId,
        ),
        { ...payload, id: coverData.coverageId },
      ];

      const { missingSegments } = computeCoverageSummary({
        shift: normalizedShift,
        activeRequest,
        coverages: shiftCoverages,
      });

      if (missingSegments.length === 0) {
        await base44.entities.SwapRequest.update(activeRequest.id, {
          status: "Closed",
        });
        await base44.entities.Shift.update(shift.id, { status: "Covered" });
      } else {
        await base44.entities.SwapRequest.update(activeRequest.id, {
          status: "Partially_Covered",
        });
        await base44.entities.Shift.update(shift.id, {
          status: "Swap_Requested",
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shifts"]);
      queryClient.invalidateQueries(["swap-requests"]);
      queryClient.invalidateQueries(["coverages"]);
      toast.success("הצעת הכיסוי נשלחה בהצלחה!");
      setShowAcceptSwapModal(false);
      setShowDetailsModal(false);
    },
  });

  const headToHeadSwapMutation = useMutation({
    mutationFn: async () => {
      if (!h2hTargetId || !h2hOfferId) return;

      // 1. Get Shifts
      const targetShift = shifts.find((s) => s.id === h2hTargetId);
      const offerShift = shifts.find((s) => s.id === h2hOfferId);

      // 2. Swap Assignees
      await base44.entities.Shift.update(h2hTargetId, {
        assigned_person: offerShift.assigned_person,
        assigned_email: offerShift.assigned_email,
        role: offerShift.role,
        department: offerShift.department,
        status: "regular",
      });

      await base44.entities.Shift.update(h2hOfferId, {
        assigned_person: targetShift.assigned_person,
        assigned_email: targetShift.assigned_email,
        role: targetShift.role,
        department: targetShift.department,
        status: "regular",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shifts"]);
      toast.success("החלפה ראש בראש בוצעה בהצלחה!");
      setShowHeadToHeadApproval(false);
      setH2hTargetId(null);
      setH2hOfferId(null);
    },
  });

  const approveSwapMutation = useMutation({
    mutationFn: async (shift) => {
      // Find the pending coverage
      const coverages = await base44.entities.ShiftCoverage.filter({
        shift_id: shift.id,
      });
      const pendingCoverage = coverages[0]; // Assuming one pending for simplicity

      if (!pendingCoverage) return;

      // Update Shift with new assignee
      await base44.entities.Shift.update(shift.id, {
        assigned_person: pendingCoverage.covering_person,
        assigned_email: pendingCoverage.covering_email,
        role: pendingCoverage.covering_role, // Or keep original role name if preferred
        status: "regular",
        swap_start_time: null,
        swap_end_time: null,
      });

      // Update Coverage status (optional if you have status field on coverage)
      // await base44.entities.ShiftCoverage.update(pendingCoverage.id, { status: 'approved' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shifts"]);
      toast.success("ההחלפה אושרה והלוח עודכן!");
      setShowDetailsModal(false);
    },
  });

  const addShiftMutation = useMutation({
    mutationFn: async (newShiftData) => {
      return await base44.entities.Shift.create({
        start_date: newShiftData.start_date,
        end_date: newShiftData.end_date,
        start_time: newShiftData.start_time || "09:00",
        end_time: newShiftData.end_time || "09:00",
        original_user_id: newShiftData.original_user_id,
        status: "Active",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shifts"]);
      toast.success("המשמרת נוספה בהצלחה");
      setShowAddShiftModal(false);
    },
  });

  const editRoleMutation = useMutation({
    mutationFn: async ({ id, ...data }) => {
      return await base44.entities.Shift.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shifts"]);
      toast.success("התפקיד עודכן בהצלחה");
      setShowEditRoleModal(false);
      setShowActionModal(false);
    },
  });

  const deleteShiftMutation = useMutation({
    mutationFn: async (id) => {
      return await base44.entities.Shift.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shifts"]);
      toast.success("המשמרת נמחקה");
      setShowActionModal(false);
      setShowDetailsModal(false);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await base44.auth.logout();
    },
    onSuccess: () => {
      window.location.href = "/";
    },
    onError: () => {
      toast.error("אירעה שגיאה בעת ההתנתקות");
    },
  });

  // --- HANDLERS ---
  const closeAllModals = () => {
    setShowSwapRequestModal(false);
    setShowAddShiftModal(false);
    setShowAcceptSwapModal(false);
    setShowActionModal(false);
    setShowEditRoleModal(false);
    setShowDetailsModal(false);
    setShowAdminSettings(false);
    setShowHallOfFame(false);
    setShowFairnessMatrix(false);
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

    if (switchFlow) {
      // "Active"/"regular" both mean a plain, unswapped shift (see HeadToHeadSelectorModal's isWhiteShift check).
      const isPlainShiftStatus =
        shift &&
        ["active", "regular"].includes(
          String(shift.status || "Active").toLowerCase(),
        );
      const isEligible =
        !!shift && (switchFlow.step === "own" ? shift.isMine : !shift.isMine);

      if (!isPlainShiftStatus || isPast || !isEligible) return;

      // Picking a TARGET shift means taking someone else's shift — blocked
      // for role 'None'. Picking an OWN shift (giving it away) is always
      // allowed regardless of role.
      if (switchFlow.step === "target" && !canTakeShifts) {
        showRoleError();
        return;
      }

      // Target shifts can only belong to one other person per request (see
      // switchRequestMutation, which groups offered_shift_ids by owner) — block
      // adding a shift owned by someone else once a target owner is set.
      if (
        switchFlow.step === "target" &&
        shift &&
        !switchFlow.targetShiftIds.includes(shift.id) &&
        switchFlow.targetShiftIds.length > 0
      ) {
        const firstTargetShift = shifts.find(
          (s) => s.id === switchFlow.targetShiftIds[0],
        );
        if (
          firstTargetShift &&
          firstTargetShift.original_user_id !== shift.original_user_id
        ) {
          if (switchFlowWarningTimeoutRef.current)
            clearTimeout(switchFlowWarningTimeoutRef.current);
          setSwitchFlowWarning(
            "אי אפשר לבחור משמרות של יותר מאדם אחד בבקשת ראש בראש אחת",
          );
          switchFlowWarningTimeoutRef.current = setTimeout(
            () => setSwitchFlowWarning(null),
            3000,
          );
          return;
        }
      }

      const listKey =
        switchFlow.step === "own" ? "ownShiftIds" : "targetShiftIds";
      setSwitchFlow((prev) => {
        const list = prev[listKey];
        const nextList = list.includes(shift.id)
          ? list.filter((id) => id !== shift.id)
          : [...list, shift.id];
        return { ...prev, [listKey]: nextList };
      });
      return;
    }

    if (!shift) {
      if (isAdmin && !isPast) {
        setShowAddShiftModal(true);
      }
      return;
    }

    // Permissions & ownership
    const permissionLevel = authorizedPerson.permissions;
    const isViewOnly = permissionLevel === "View";
    const isRR = permissionLevel === "RR";
    const isMyShift =
      shift.original_user_id === authorizedPerson.serial_id ||
      shift.assigned_email === authorizedPerson.email;
    const isCoveredShift =
      shift.status === "covered" ||
      shift.status === "Covered" ||
      shift.status === "approved";
    const isCoveringUser = (shift.coverages || []).some(
      (cov) => cov.covering_user_id === authorizedPerson.serial_id,
    );

    // View-only users cannot open shifts at all
    if (isViewOnly) {
      return;
    }

    // Access rules for RR level
    if (isRR && !isAdmin) {
      if (shift.status === "regular" && !isMyShift) {
        return;
      }

      if (isCoveredShift && !(isMyShift || isCoveringUser)) {
        return;
      }

      // Swap requests are always viewable for RR (covered by default fallthrough)
    }

    setSelectedShift(shift);

    // Determine if it's my shift
    if (shift.status === "regular") {
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
    if (!canTakeShifts) {
      showRoleError();
      return;
    }
    const normalized = normalizeShiftContext(shift, {
      allUsers,
      swapRequests,
      coverages,
      currentUser: authorizedPerson,
    });
    setSelectedShift(normalized);
    setShowAcceptSwapModal(true);
  };

  const handleOpenSwapRequest = (shift) => {
    setSelectedShift(shift);
    setSwapRequestInitialType("full");
    setShowSwapRequestModal(true);
  };

  const handleSwapSubmit = (data) => {
    if (!selectedShift) {
      debugLog(
        "❌ [ShiftCalendar] No shift selected for swap request submission",
      );
      appendSwapLog("❌ לא נבחרה משמרת לשליחה");
      return;
    }

    appendSwapLog("📝 נתוני בקשה מהמודל", data);
    debugLog("📤 [ShiftCalendar] Submitting swap request from modal:", data);

    requestSwapMutation.mutate({
      shiftId: selectedShift.id,
      type: data.type,
      dates: data,
    });
  };

  // --- RENDER LOGIC ---

  // 1. Loading State
  if (isUserLoading || isAuthCheckLoading) {
    return (
      <div
        className="min-h-screen bg-[#F9FAFB] flex items-center justify-center"
        dir="rtl"
      >
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
  const isAdmin = permissionLevel === "Admin" || permissionLevel === "Manager";
  const isViewOnly = permissionLevel === "View";
  const isLoadingApp = isUserLoading || isAuthCheckLoading || isShiftsLoading;

  if (isLoadingApp) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] text-gray-900" dir="rtl">
        <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
          <LoadingSkeleton className="h-14 w-full" ariaLabel="טוען כותרת" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, idx) => (
              <LoadingSkeleton
                key={idx}
                className="h-16"
                ariaLabel="טעינת KPI"
              />
            ))}
          </div>
          <LoadingSkeleton
            className="h-[420px] w-full"
            ariaLabel="טעינת לוח משמרות"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-[#F9FAFB] text-gray-900 font-sans selection:bg-blue-100 overflow-x-hidden relative"
      dir="rtl"
    >
      <BackgroundShapes />

      <div className="max-w-7xl mx-auto px-4 py-4 md:py-8 relative z-10 flex flex-col min-h-screen">
        {/* Header (top bar + branding only, navigation rendered below the KPI band) */}
        <CalendarHeader
          currentDate={currentDate}
          setCurrentDate={setCurrentDate}
          viewMode={viewMode}
          setViewMode={setViewMode}
          isAdmin={isAdmin}
          onOpenAdminSettings={() => setShowAdminSettings(true)}
          onOpenHallOfFame={() => setShowHallOfFame(true)}
          onOpenFairnessMatrix={() => setShowFairnessMatrix(true)}
          onOpenHelp={() => setShowHelpSupport(true)}
          onLogout={() => setShowLogoutConfirm(true)}
          currentUser={authorizedPerson}
          hideNavigation={true}
        />

        {/* KPI Header */}
        <div className="mb-2">
          <KPIHeader
            shifts={enrichedShifts}
            currentUser={authorizedPerson}
            onKPIClick={(type) => {
              setKpiListType(type);
              setKpiInitialTab("all");
              setKpiOpenSeq((n) => n + 1);
              setShowKPIListModal(true);
            }}
            onStartSwitchFlow={() => {
              // Jump to the first month where the user actually has a future
              // shift they can offer. Otherwise the switch-flow band shows
              // every cell dimmed (the current month's own shifts may all be
              // in the past) and it looks like nothing is selectable.
              const todayStr = format(new Date(), "yyyy-MM-dd");
              const myFutureShifts = enrichedShifts.filter(
                (s) =>
                  s.isMine &&
                  s.start_date &&
                  s.start_date >= todayStr &&
                  ["active", "regular"].includes(
                    String(s.status || "Active").toLowerCase(),
                  ),
              );
              if (myFutureShifts.length > 0) {
                const earliest = myFutureShifts
                  .map((s) => s.start_date)
                  .sort()[0];
                setCurrentDate(new Date(earliest + "T00:00:00"));
              }
              setSwitchFlow({
                step: "own",
                ownShiftIds: [],
                targetShiftIds: [],
              });
            }}
          />
        </div>

        {/* Navigation (view mode + prev/next month) */}
        <CalendarHeader
          currentDate={currentDate}
          setCurrentDate={setCurrentDate}
          viewMode={viewMode}
          setViewMode={setViewMode}
          isAdmin={isAdmin}
          currentUser={authorizedPerson}
          hideHeader={true}
        />

        {/* Calendar Grid */}
        <div className="flex-1 bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl border border-white/50 p-2 md:p-6 mt-1 relative overflow-hidden">
          <CalendarGrid
            currentDate={currentDate}
            viewMode={viewMode}
            shifts={enrichedShifts}
            onCellClick={handleCellClick}
            currentUserEmail={authorizedPerson.email}
            currentUserRole={authorizedPerson.full_name}
            isAdmin={isAdmin}
            switchFlow={switchFlow}
          />
        </div>
      </div>

      {switchFlow && (
        <SwitchFlowBand
          step={switchFlow.step}
          ownCount={switchFlow.ownShiftIds.length}
          targetCount={switchFlow.targetShiftIds.length}
          isSubmitting={
            switchRequestMutation.isPending ||
            generalSwitchRequestMutation.isPending
          }
          warning={switchFlowWarning}
          isCounterOffer={switchFlow.isCounterOffer}
          targetOwnerName={switchFlow.targetOwnerName}
          onCancel={() => {
            if (switchFlowWarningTimeoutRef.current)
              clearTimeout(switchFlowWarningTimeoutRef.current);
            setSwitchFlowWarning(null);
            setSwitchFlow(null);
          }}
          onNext={() => setSwitchFlow((prev) => ({ ...prev, step: "target" }))}
          onSkip={() =>
            generalSwitchRequestMutation.mutate({
              ownShiftIds: switchFlow.ownShiftIds,
            })
          }
          onConfirm={() => {
            if (!canTakeShifts) {
              showRoleError();
              return;
            }
            switchRequestMutation.mutate({
              ownShiftIds: switchFlow.ownShiftIds,
              targetShiftIds: switchFlow.targetShiftIds,
            });
          }}
        />
      )}

      {roleError && (
        <div
          className={`fixed inset-x-0 z-[60] ${switchFlow ? "bottom-20" : "bottom-0"}`}
        >
          <div className="bg-red-600 text-white text-center text-sm font-bold py-2 px-4 shadow-lg">
            {roleError}
          </div>
        </div>
      )}

      {/* --- MODALS --- */}

      <AdminSettingsModal isOpen={showAdminSettings} onClose={closeAllModals} />

      <ShiftActionModal
        isOpen={showActionModal}
        onClose={closeAllModals}
        shift={selectedShift}
        date={currentDate}
        onRequestSwap={(type) => {
          closeAllModals();
          setSwapRequestInitialType(type || "full");
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
        initialSwapType={swapRequestInitialType}
      />

      <AddShiftModal
        isOpen={showAddShiftModal}
        onClose={closeAllModals}
        date={clickedDate || currentDate}
        onSubmit={(data) =>
          addShiftMutation.mutate({
            ...data,
            date: format(currentDate, "yyyy-MM-dd"), // Needs refinement if specific day clicked
          })
        }
        isSubmitting={addShiftMutation.isPending}
      />

      <EditRoleModal
        isOpen={showEditRoleModal}
        onClose={closeAllModals}
        shift={selectedShift}
        date={currentDate}
        onSubmit={(data) =>
          editRoleMutation.mutate({ id: selectedShift.id, ...data })
        }
        isSubmitting={editRoleMutation.isPending}
      />

      <ShiftDetailsModal
        isOpen={showDetailsModal}
        onClose={closeAllModals}
        shift={selectedShift}
        date={currentDate}
        onOfferCover={handleOfferCover}
        onHeadToHead={(shift) => {
          if (!canTakeShifts) {
            showRoleError();
            return;
          }
          setSelectedShift(shift);
          setShowHeadToHeadSelector(true);
        }}
        onCancelRequest={(shift) => cancelSwapMutation.mutate(shift.id)}
        onCancelCoverage={(shift) => cancelMyCoverageMutation.mutate(shift)}
        onDelete={deleteShiftMutation.mutate}
        onApprove={() => approveSwapMutation.mutate(selectedShift)}
        onRequestSwap={() => {
          closeAllModals();
          setSwapRequestInitialType("full");
          setShowSwapRequestModal(true);
        }}
        currentUser={authorizedPerson}
        isAdmin={isAdmin}
      />

      <AcceptSwapModal
        isOpen={showAcceptSwapModal && !!selectedShift}
        onClose={closeAllModals}
        shift={selectedShift}
        existingCoverages={
          selectedShift?.shiftCoverages || selectedShift?.coverages || []
        }
        currentUserId={authorizedPerson?.serial_id}
        onAccept={(segmentData) => {
          if (!canTakeShifts) {
            showRoleError();
            return;
          }
          offerCoverMutation.mutate({
            shift: selectedShift,
            coverData: segmentData,
          });
        }}
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
        onRoleBlocked={showRoleError}
      />

      <HeadToHeadApprovalModal
        isOpen={showHeadToHeadApproval}
        onClose={closeAllModals}
        targetShiftId={h2hTargetId}
        offerShiftId={h2hOfferId}
        onApprove={() => {
          if (!canTakeShifts) {
            showRoleError();
            return;
          }
          headToHeadSwapMutation.mutate();
        }}
        onDecline={closeAllModals}
      />

      <HallOfFameModal isOpen={showHallOfFame} onClose={closeAllModals} />

      <FairnessMatrixModal
        isOpen={showFairnessMatrix}
        onClose={closeAllModals}
        currentUser={authorizedPerson}
      />

      <HelpSupportModal isOpen={showHelpSupport} onClose={closeAllModals} />

      {showLogoutConfirm && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          dir="rtl"
        >
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
            <h3
              id="logout-title"
              className="text-2xl font-bold text-center text-gray-900 mb-2"
            >
              האם אתה בטוח שברצונך להתנתק?
            </h3>
            <p id="logout-desc" className="text-center text-gray-600 text-sm">
              תוכל להתחבר שוב בכל רגע באמצעות פרטי הגישה שלך.
            </p>
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
        key={`${kpiListType}-${kpiOpenSeq}`}
        isOpen={showKPIListModal}
        onClose={closeAllModals}
        type={kpiListType}
        initialTab={kpiInitialTab}
        currentUser={authorizedPerson}
        onOfferCover={handleOfferCover}
        onRequestSwap={handleOpenSwapRequest}
        onCancelRequest={(item) => cancelSwapRequestMutation.mutate(item)}
        onAcceptHeadToHead={(item) => {
          if (!canTakeShifts) {
            showRoleError();
            return;
          }
          acceptHeadToHeadRequestMutation.mutate(item);
        }}
        onAcceptGeneralRequest={(item) => {
          if (!canTakeShifts) {
            showRoleError();
            return;
          }
          acceptGeneralRequestMutation.mutate(item);
        }}
        onStartCounterOffer={(item) => handleStartCounterOffer(item)}
        actionsDisabled={isViewOnly}
      />
    </div>
  );
}